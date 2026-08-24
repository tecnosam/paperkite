/**
 * Common shape every provider adapter implements, so main/ipc.ts can call
 * whichever one matches an agent's provider without a provider-specific
 * branch beyond the dispatch itself - see agents/index.ts.
 */
import type { MessageAttachment } from '../../shared/types';
import type { McpTool } from '../mcp/client';

export interface AgentHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface SendParams {
  apiKey: string | null;
  baseUrl?: string;
  model: string;
  /** This agent's configured custom instruction, sent as a system prompt
   * on every message - not part of `history`, since every provider has
   * its own dedicated slot for it (Claude's `system`, Gemini's
   * `systemInstruction`, a leading `role: 'system'` message for the
   * other two). */
  systemPrompt?: string;
  /** Prior turns, oldest first - text only, no re-sent images. */
  history: AgentHistoryTurn[];
  newText: string;
  /** Only set if the user explicitly captured one via the camera button -
   * no longer sent on every message. */
  screenshot?: MessageAttachment;
  /** Every tool from every connected MCP server, already namespaced
   * (mcp__<serverId>__<toolName>) - see main/mcp/client.ts. Empty if no
   * servers are configured or none connected successfully. */
  tools: McpTool[];
  /** Fired right before executing a tool call the model requested - drives
   * the chat panel's "Working…" status. Each adapter's tool-calling loop
   * (bounded to MAX_TOOL_CALL_ROUNDS iterations) calls this once per call. */
  onToolCall: (serverName: string, toolName: string) => void;
  /** Only ever real text - tool-call JSON fragments never reach this. */
  onChunk: (textDelta: string) => void;
  signal: AbortSignal;
}

/** How many sequential tool-call round trips a single message can trigger
 * before the adapter gives up and returns whatever text it has - bounds
 * worst-case latency/cost against a model stuck in a tool-call loop. */
export const MAX_TOOL_CALL_ROUNDS = 4;

export type SendFn = (params: SendParams) => Promise<void>;

/** Strips the `data:image/jpeg;base64,` prefix off a MessageAttachment's
 * dataUrl - most providers want the mime type and the base64 payload as
 * separate fields. */
export function splitDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return { mimeType: 'image/jpeg', base64: dataUrl };
  return { mimeType: match[1], base64: match[2] };
}
