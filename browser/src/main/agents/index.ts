/** Dispatches to the right provider adapter by `provider` - the only thing
 * main/ipc.ts needs to know about the four providers. */
import type { AgentProvider } from '../../shared/types';
import type { SendFn } from './types';
import { sendToClaude } from './claude';
import { sendToOpenAI } from './openai';
import { sendToGemini } from './gemini';
import { sendToOllama } from './ollama';

const ADAPTERS: Record<AgentProvider, SendFn> = {
  claude: sendToClaude,
  openai: sendToOpenAI,
  gemini: sendToGemini,
  ollama: sendToOllama,
};

export function getAdapter(provider: AgentProvider): SendFn {
  return ADAPTERS[provider];
}

export type { SendParams, AgentHistoryTurn } from './types';
