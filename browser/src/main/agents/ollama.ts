/**
 * Local Ollama adapter - `POST {baseUrl}/api/chat`, streaming via newline-
 * delimited JSON (Ollama's default, unlike the SSE the three cloud
 * providers use). Images are only attached for models we can reasonably
 * guess are vision-capable, and tools are only offered to models that
 * actually support them - both checked against Ollama's own `/api/show`
 * capability list (see getCapabilities), not just the model's name.
 *
 * Also runs a bounded tool-calling loop: Ollama's `/api/chat` `tools`
 * field is OpenAI-shaped, but unlike raw OpenAI, Ollama delivers each
 * `message.tool_calls` entry already whole (arguments as a parsed object,
 * not a streamed string) - so each chunk's tool_calls array is treated as
 * the authoritative, complete picture rather than something to merge
 * fragments into.
 */
import type { SendFn } from './types';
import { MAX_TOOL_CALL_ROUNDS } from './types';
import { splitDataUrl } from './types';
import { callTool } from '../mcp/client';
import type { MessageAttachment } from '../../shared/types';

const DEFAULT_BASE_URL = 'http://localhost:11434';

// Fallback only, used when /api/show can't tell us (older Ollama, model
// not pulled yet, network hiccup) - Ollama's own reported capabilities are
// authoritative whenever they're available. Deliberately loose (substring
// match) since it only has to catch obviously-vision-named models.
const VISION_MODEL_HINTS = [
  'llava',
  'vision',
  'bakllava',
  'moondream',
  'minicpm-v',
  'qwen2-vl',
  'qwen2.5vl',
  'qwen2.5-vl',
  'qwen3-vl',
  'pixtral',
  'gemma3',
  'gemma4',
];

function looksVisionCapable(model: string): boolean {
  const lower = model.toLowerCase();
  return VISION_MODEL_HINTS.some((hint) => lower.includes(hint));
}

interface OllamaCapabilities {
  vision: boolean;
  tools: boolean;
}

// Keyed by `${base}::${model}` - capabilities can't change mid-session, so
// this saves a round trip to /api/show on every single message send.
// Failures aren't cached (deleted after use) so a transient network hiccup
// doesn't wedge a model into "no tools" for the rest of the app's lifetime.
const capabilityCache = new Map<string, Promise<OllamaCapabilities | null>>();

async function fetchCapabilities(base: string, model: string): Promise<OllamaCapabilities | null> {
  try {
    const response = await fetch(`${base}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { capabilities?: string[] };
    if (!Array.isArray(data.capabilities)) return null;
    return { vision: data.capabilities.includes('vision'), tools: data.capabilities.includes('tools') };
  } catch {
    return null;
  }
}

async function getCapabilities(base: string, model: string): Promise<OllamaCapabilities | null> {
  const key = `${base}::${model}`;
  let pending = capabilityCache.get(key);
  if (!pending) {
    pending = fetchCapabilities(base, model);
    capabilityCache.set(key, pending);
  }
  const result = await pending;
  if (!result) capabilityCache.delete(key);
  return result;
}

interface OllamaToolCall {
  function: { name: string; arguments: unknown };
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
}

interface StreamEvent {
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
  error?: string;
}

function buildUserTurn(text: string, vision: boolean, screenshot?: MessageAttachment): OllamaMessage {
  if (!screenshot) return { role: 'user', content: text };
  const { base64 } = splitDataUrl(screenshot.dataUrl);
  const content = vision
    ? `[Current page: ${screenshot.url}]\n\n${text}`
    : `[Current page: ${screenshot.url} - screenshot omitted, this model isn't vision-capable]\n\n${text}`;
  return { role: 'user', content, ...(vision ? { images: [base64] } : {}) };
}

/** Ollama's error bodies are raw JSON (`{"error":"..."}`) or plain text
 * depending on the failure - this turns either into one clean sentence
 * instead of a JSON dump landing in the chat UI. */
function friendlyOllamaError(status: number, detail: string, model: string): string {
  const parsed = (() => {
    try {
      const obj = JSON.parse(detail) as { error?: string };
      return typeof obj.error === 'string' ? obj.error : null;
    } catch {
      return null;
    }
  })();
  const message = parsed ?? detail.slice(0, 300);

  if (status === 404 || /not found/i.test(message)) {
    return `Model "${model}" isn't pulled in Ollama yet - run \`ollama pull ${model}\`.`;
  }
  return `Ollama error (${status}): ${message || 'unknown error'}`;
}

const TOOLS_UNSUPPORTED_PATTERN = /does not support tools/i;

async function postChat(base: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${base}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error(`Can't reach Ollama at ${base} - make sure it's running (\`ollama serve\`).`);
  }
}

export const sendToOllama: SendFn = async ({ baseUrl, model, systemPrompt, history, newText, screenshot, tools, onToolCall, onChunk, signal }) => {
  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const capabilities = await getCapabilities(base, model);
  const vision = capabilities?.vision ?? looksVisionCapable(model);
  // Known-unsupported -> never offer tools. Unknown (capability probe
  // failed) -> optimistically try; a live rejection below turns it off and
  // retries in plain-chat mode instead of failing the whole message, so an
  // unrecognized model still degrades gracefully rather than hard-failing.
  let toolsEnabled = capabilities ? capabilities.tools : tools.length > 0;
  let noticedUnsupported = false;

  const noteToolsUnsupported = () => {
    if (noticedUnsupported) return;
    noticedUnsupported = true;
    onChunk(`_${model} doesn't support tool calling - continuing without MCP tools for this message._\n\n`);
  };

  if (tools.length > 0 && !toolsEnabled) noteToolsUnsupported();

  const ollamaTools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));

  const messages: OllamaMessage[] = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt } as OllamaMessage] : []),
    ...history.map((turn): OllamaMessage => ({ role: turn.role, content: turn.text })),
    buildUserTurn(newText, vision, screenshot),
  ];

  for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
    const activeTools = toolsEnabled ? ollamaTools : [];
    let response = await postChat(base, { model, stream: true, messages, ...(activeTools.length > 0 ? { tools: activeTools } : {}) }, signal);

    if (!response.ok && activeTools.length > 0) {
      const detail = await response
        .clone()
        .text()
        .catch(() => '');
      if (TOOLS_UNSUPPORTED_PATTERN.test(detail)) {
        // This model rejects tools outright despite capabilities being
        // unknown up front - drop them and retry this round in plain-chat
        // mode rather than failing the whole message.
        toolsEnabled = false;
        noteToolsUnsupported();
        response = await postChat(base, { model, stream: true, messages }, signal);
      }
    }

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new Error(friendlyOllamaError(response.status, detail, model));
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let toolCalls: OllamaToolCall[] | null = null;

    // undici's ReadableStream (Electron's main-process fetch) supports
    // async iteration directly - no manual getReader()/read() loop needed.
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = JSON.parse(trimmed) as StreamEvent;
        if (event.error) throw new Error(event.error);
        if (event.message?.content) onChunk(event.message.content);
        if (event.message?.tool_calls && event.message.tool_calls.length > 0) toolCalls = event.message.tool_calls;
      }
    }

    if (!toolCalls || toolCalls.length === 0) return;

    messages.push({ role: 'assistant', content: '', tool_calls: toolCalls });

    for (const call of toolCalls) {
      const tool = tools.find((t) => t.name === call.function.name);
      onToolCall(tool?.serverName ?? 'MCP server', tool?.toolName ?? call.function.name);
      const args =
        typeof call.function.arguments === 'string'
          ? (JSON.parse(call.function.arguments || '{}') as Record<string, unknown>)
          : ((call.function.arguments as Record<string, unknown>) ?? {});
      const resultText = await callTool(call.function.name, args);
      messages.push({ role: 'tool', content: resultText });
    }
  }
};
