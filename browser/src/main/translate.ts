/**
 * A single-shot "translate this text" call, reusing the same provider
 * adapters the chat/thread pipeline uses (main/agents/*) rather than a
 * separate client per provider. Not a chat turn - no history, no tools,
 * no screenshot, and the agent's own configured systemPrompt (its custom
 * personality/instructions) is deliberately overridden, not appended to,
 * since "reply in pirate speak" would corrupt a subtitle line that's
 * supposed to be a clean translation.
 */
import { getAdapter } from './agents';
import { getAgentForRequest } from './agentStore';
import type { AgentHistoryTurn } from './agents/types';

// Generous on purpose - a local Ollama model that isn't already resident
// in memory (e.g. it got evicted after switching to a different one, or
// this is the first call in a while) can easily take 15-20s just to load
// before it generates a single token. 15s was cutting that close enough to
// abort real, in-progress work under normal local-model conditions, not
// just genuinely-stuck requests.
const TRANSLATE_TIMEOUT_MS = 30_000;

export async function translateText(
  agentId: string,
  text: string,
  targetLanguage: string,
  // Prior (transcript, translation) turns, oldest first - reused as regular
  // chat history via the same AgentHistoryTurn shape the main agent-chat
  // pipeline uses, rather than inventing a second context mechanism. Gives
  // the model continuity across chunk boundaries (pronouns, dropped
  // subjects, terminology set a few lines ago) that it otherwise has no way
  // to see, since each chunk is translated as if nothing came before it.
  history: AgentHistoryTurn[] = [],
): Promise<string> {
  const agentEntry = getAgentForRequest(agentId);
  if (!agentEntry) throw new Error('This agent no longer exists - it may have been removed in Settings.');

  const send = getAdapter(agentEntry.config.provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);

  let result = '';
  try {
    await send({
      apiKey: agentEntry.apiKey,
      baseUrl: agentEntry.config.baseUrl,
      model: agentEntry.config.model,
      systemPrompt:
        `You are a live subtitle translator. Translate the given text to ${targetLanguage}. ` +
        'Reply with ONLY the translation - no quotes, no notes, no explanation, nothing but the translated line. ' +
        'Translate directly and literally - preserve the original meaning, wording, and sentence structure as ' +
        'closely as the target language allows. Do NOT paraphrase, summarize, simplify, embellish, or rephrase ' +
        'into more natural-sounding prose. This is a hard rule: a direct translation that reads slightly awkward ' +
        'is correct; a smooth paraphrase that drifts from the source wording is not. ' +
        'The conversation history below is prior lines of the SAME ongoing speech, given only for context ' +
        '(continuity of names, pronouns, and terminology) - it is not a conversation to reply to, and none of it ' +
        'should appear in your reply.',
      history,
      newText: text,
      tools: [],
      signal: controller.signal,
      onToolCall: () => {
        // Translation never needs tools - MCP tools aren't offered (tools: []
        // above), so this is unreachable, but SendFn requires the callback.
      },
      onChunk: (delta) => {
        result += delta;
      },
    });
  } finally {
    clearTimeout(timeout);
  }
  return result.trim();
}
