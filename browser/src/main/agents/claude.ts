/**
 * Anthropic Messages API adapter - streaming via SSE `content_block_delta`
 * events, with a bounded tool-calling loop layered on top: if a turn ends
 * with `stop_reason: "tool_use"`, every pending tool_use block is executed
 * via main/mcp/client.ts and the results are fed back in a follow-up
 * request, up to MAX_TOOL_CALL_ROUNDS times.
 */
import type { SendFn } from './types';
import { MAX_TOOL_CALL_ROUNDS } from './types';
import { splitDataUrl } from './types';
import { readSseLines } from './sse';
import { callTool } from '../mcp/client';
import type { MessageAttachment } from '../../shared/types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

interface StreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
}

function buildUserTurn(text: string, screenshot?: MessageAttachment): ClaudeMessage {
  if (!screenshot) return { role: 'user', content: text };
  const { mimeType, base64 } = splitDataUrl(screenshot.dataUrl);
  return {
    role: 'user',
    content: [
      { type: 'text', text: `[Current page: ${screenshot.url}]\n\n${text}` },
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
    ],
  };
}

export const sendToClaude: SendFn = async ({ apiKey, model, systemPrompt, history, newText, screenshot, tools, onToolCall, onChunk, signal }) => {
  if (!apiKey) throw new Error('No API key configured for this agent.');

  const claudeTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));

  const messages: ClaudeMessage[] = [
    ...history.map((turn): ClaudeMessage => ({ role: turn.role, content: turn.text })),
    buildUserTurn(newText, screenshot),
  ];

  for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        messages,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        ...(claudeTools.length > 0 ? { tools: claudeTools } : {}),
      }),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Claude API error (${response.status}): ${detail.slice(0, 300) || response.statusText}`);
    }

    // Blocks are streamed by index, in order - a text block accumulates
    // its own text (already forwarded live via onChunk), a tool_use block
    // accumulates its `input` as a raw JSON string until content_block_stop.
    const blocks = new Map<number, { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; jsonBuf: string }>();
    let stopReason: string | undefined;

    for await (const payload of readSseLines(response.body, signal)) {
      const event = JSON.parse(payload) as StreamEvent;
      if (event.type === 'content_block_start' && event.index !== undefined && event.content_block) {
        const cb = event.content_block;
        if (cb.type === 'text') blocks.set(event.index, { type: 'text', text: '' });
        else if (cb.type === 'tool_use' && cb.id && cb.name) blocks.set(event.index, { type: 'tool_use', id: cb.id, name: cb.name, jsonBuf: '' });
      } else if (event.type === 'content_block_delta' && event.index !== undefined && event.delta) {
        const block = blocks.get(event.index);
        if (block?.type === 'text' && event.delta.type === 'text_delta' && event.delta.text) {
          block.text += event.delta.text;
          onChunk(event.delta.text);
        } else if (block?.type === 'tool_use' && event.delta.type === 'input_json_delta' && event.delta.partial_json) {
          block.jsonBuf += event.delta.partial_json;
        }
      } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
        stopReason = event.delta.stop_reason;
      }
    }

    const ordered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block);
    const toolUseBlocks = ordered.filter((b) => b.type === 'tool_use');

    if (stopReason !== 'tool_use' || toolUseBlocks.length === 0) return;

    messages.push({
      role: 'assistant',
      content: ordered.map((block): ContentBlock =>
        block.type === 'text'
          ? { type: 'text', text: block.text }
          : { type: 'tool_use', id: block.id, name: block.name, input: JSON.parse(block.jsonBuf || '{}') },
      ),
    });

    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
    for (const block of toolUseBlocks) {
      const tool = tools.find((t) => t.name === block.name);
      onToolCall(tool?.serverName ?? 'MCP server', tool?.toolName ?? block.name);
      const args = JSON.parse(block.jsonBuf || '{}') as Record<string, unknown>;
      const resultText = await callTool(block.name, args);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultText });
    }
    messages.push({ role: 'user', content: toolResults });
  }
};
