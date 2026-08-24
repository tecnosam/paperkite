/**
 * OpenAI Chat Completions API adapter - streaming via SSE `delta.content`
 * chunks, with a bounded tool-calling loop: if a turn ends with
 * `finish_reason: "tool_calls"`, every pending call is executed via
 * main/mcp/client.ts and the results are fed back in a follow-up request,
 * up to MAX_TOOL_CALL_ROUNDS times.
 */
import type { SendFn } from './types';
import { MAX_TOOL_CALL_ROUNDS } from './types';
import { readSseLines } from './sse';
import { callTool } from '../mcp/client';
import type { MessageAttachment } from '../../shared/types';

const API_URL = 'https://api.openai.com/v1/chat/completions';

interface ToolCallPart {
  type: 'function';
  id: string;
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null;
  tool_calls?: ToolCallPart[];
  tool_call_id?: string;
}

interface StreamEvent {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
}

function buildUserTurn(text: string, screenshot?: MessageAttachment): OpenAiMessage {
  if (!screenshot) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [
      { type: 'text', text: `[Current page: ${screenshot.url}]\n\n${text}` },
      { type: 'image_url', image_url: { url: screenshot.dataUrl } },
    ],
  };
}

export const sendToOpenAI: SendFn = async ({ apiKey, model, systemPrompt, history, newText, screenshot, tools, onToolCall, onChunk, signal }) => {
  if (!apiKey) throw new Error('No API key configured for this agent.');

  const openAiTools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));

  const messages: OpenAiMessage[] = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt } as OpenAiMessage] : []),
    ...history.map((turn): OpenAiMessage => ({ role: turn.role, content: turn.text })),
    buildUserTurn(newText, screenshot),
  ];

  for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, stream: true, messages, ...(openAiTools.length > 0 ? { tools: openAiTools } : {}) }),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI API error (${response.status}): ${detail.slice(0, 300) || response.statusText}`);
    }

    // Tool-call fragments stream in by index - id/name usually arrive on
    // the first chunk for that index, `arguments` accumulates as a string
    // across many chunks until finish_reason confirms the turn is done.
    const calls = new Map<number, { id: string; name: string; argsBuf: string }>();
    let finishReason: string | null | undefined;
    let assistantText = '';

    for await (const payload of readSseLines(response.body, signal)) {
      const event = JSON.parse(payload) as StreamEvent;
      const choice = event.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) {
        assistantText += choice.delta.content;
        onChunk(choice.delta.content);
      }
      for (const part of choice.delta?.tool_calls ?? []) {
        const existing = calls.get(part.index) ?? { id: '', name: '', argsBuf: '' };
        if (part.id) existing.id = part.id;
        if (part.function?.name) existing.name += part.function.name;
        if (part.function?.arguments) existing.argsBuf += part.function.arguments;
        calls.set(part.index, existing);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    if (finishReason !== 'tool_calls' || calls.size === 0) return;

    const orderedCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    messages.push({
      role: 'assistant',
      content: assistantText || null,
      tool_calls: orderedCalls.map((call): ToolCallPart => ({ type: 'function', id: call.id, function: { name: call.name, arguments: call.argsBuf } })),
    });

    for (const call of orderedCalls) {
      const tool = tools.find((t) => t.name === call.name);
      onToolCall(tool?.serverName ?? 'MCP server', tool?.toolName ?? call.name);
      const args = JSON.parse(call.argsBuf || '{}') as Record<string, unknown>;
      const resultText = await callTool(call.name, args);
      messages.push({ role: 'tool', tool_call_id: call.id, content: resultText });
    }
  }
};
