/**
 * Google Gemini generateContent adapter - streaming via `alt=sse`, with a
 * bounded tool-calling loop: unlike Claude/OpenAI, Gemini emits a
 * `functionCall` whole (not fragmented across chunks), so no incremental
 * JSON accumulation is needed - just collect whichever calls show up in
 * this turn's stream and, if any did, execute them via main/mcp/client.ts
 * and feed the results back, up to MAX_TOOL_CALL_ROUNDS times.
 */
import type { SendFn } from './types';
import { MAX_TOOL_CALL_ROUNDS } from './types';
import { splitDataUrl } from './types';
import { readSseLines } from './sse';
import { callTool } from '../mcp/client';
import type { MessageAttachment } from '../../shared/types';

type GeminiPart =
  | { text: string; thoughtSignature?: string }
  | { inline_data: { mime_type: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: { result: string } } };

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface StreamEvent {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }>;
    };
    finishReason?: string;
    finishMessage?: string;
  }>;
}

/** finishReasons that mean "this candidate is done, nothing more to read" -
 * anything else (a safety block, a malformed tool call, an unknown future
 * value) should surface as an error rather than silently completing with
 * whatever text/calls happened to be collected (which may be none at all). */
const NORMAL_FINISH_REASONS = new Set(['STOP', 'MAX_TOKENS']);

/** Gemini's function-calling schema is a constrained OpenAPI-3.0 subset -
 * strip keys it doesn't understand rather than passing an MCP tool's raw
 * JSON Schema through as-is. */
const UNSUPPORTED_SCHEMA_KEYS = new Set(['$schema', 'additionalProperties']);
function toGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toGeminiSchema);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
      result[key] = toGeminiSchema(val);
    }
    return result;
  }
  return value;
}

function buildUserTurn(text: string, screenshot?: MessageAttachment): GeminiContent {
  if (!screenshot) return { role: 'user', parts: [{ text }] };
  const { mimeType, base64 } = splitDataUrl(screenshot.dataUrl);
  return {
    role: 'user',
    parts: [{ text: `[Current page: ${screenshot.url}]\n\n${text}` }, { inline_data: { mime_type: mimeType, data: base64 } }],
  };
}

export const sendToGemini: SendFn = async ({ apiKey, model, systemPrompt, history, newText, screenshot, tools, onToolCall, onChunk, signal }) => {
  if (!apiKey) throw new Error('No API key configured for this agent.');

  const systemInstruction = systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined;

  const geminiTools =
    tools.length > 0
      ? [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.inputSchema) })) }]
      : undefined;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const contents: GeminiContent[] = [
    // Gemini calls the assistant role "model", not "assistant".
    ...history.map((turn): GeminiContent => ({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.text }] })),
    buildUserTurn(newText, screenshot),
  ];

  for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
    const response = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents, ...(systemInstruction ? { systemInstruction } : {}), ...(geminiTools ? { tools: geminiTools } : {}) }),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Gemini API error (${response.status}): ${detail.slice(0, 300) || response.statusText}`);
    }

    const turnParts: GeminiPart[] = [];
    const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let finishReason: string | undefined;
    let finishMessage: string | undefined;

    for await (const payload of readSseLines(response.body, signal)) {
      const event = JSON.parse(payload) as StreamEvent;
      const candidate = event.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        // Thinking models (mandatory as of Gemini 3, optional but supported
        // on 2.5) attach an opaque `thoughtSignature` to a part - Gemini
        // needs that exact value echoed back on this same part when it's
        // resent as conversation history, or the next request 400s with
        // "missing a thought_signature in functionCall parts". Preserved
        // on both text and functionCall parts since the docs describe it
        // as living on either (function calls, or a response's final part).
        if (part.text) {
          turnParts.push({ text: part.text, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) });
          onChunk(part.text);
        } else if (part.functionCall) {
          turnParts.push({ functionCall: part.functionCall, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) });
          functionCalls.push(part.functionCall);
        }
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      if (candidate?.finishMessage) finishMessage = candidate.finishMessage;
    }

    // A finishReason outside the normal set (a safety block, a malformed
    // tool call the model itself botched, etc.) with nothing usable to show
    // for it - surface it rather than silently completing empty.
    if (finishReason && !NORMAL_FINISH_REASONS.has(finishReason) && functionCalls.length === 0 && turnParts.length === 0) {
      throw new Error(finishMessage || `Gemini stopped unexpectedly (${finishReason}).`);
    }

    if (functionCalls.length === 0) return;

    contents.push({ role: 'model', parts: turnParts });

    const responseParts: GeminiPart[] = [];
    for (const call of functionCalls) {
      const tool = tools.find((t) => t.name === call.name);
      onToolCall(tool?.serverName ?? 'MCP server', tool?.toolName ?? call.name);
      const resultText = await callTool(call.name, call.args);
      responseParts.push({ functionResponse: { name: call.name, response: { result: resultText } } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }
};
