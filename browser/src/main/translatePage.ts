/**
 * Batch-translates a page's worth of text nodes in a handful of LLM calls
 * rather than one per node - a content-heavy page can easily have several
 * hundred distinct text nodes (see preload/pageTranslate.ts), and calling
 * translateText() per node would be both slow (hundreds of round trips)
 * and wasteful (hundreds of separate cold system-prompt evaluations).
 *
 * Multiple texts are packed into one prompt as numbered lines
 * (`[1] ...`, `[2] ...`) and the model is instructed to echo the same
 * markers back - parsing by marker rather than by line POSITION means a
 * model that drops, merges, or reorders a line still resolves correctly
 * for everything else, instead of silently misaligning every entry after
 * the first mistake.
 */
import { getAdapter } from './agents';
import { getAgentForRequest } from './agentStore';
import type { PageTranslateTextEntry } from '../shared/types';

// Larger than translate.ts's single-line TRANSLATE_TIMEOUT_MS - a batch has
// meaningfully more to generate even once the model's already warm, on top
// of the same cold-local-model-load allowance that constant documents.
const BATCH_TIMEOUT_MS = 60_000;

// Tuned for "a handful of calls per page", not "one call per node" or "one
// call for the whole page" - the former is slow/wasteful (see doc comment
// above), the latter risks exceeding a smaller local model's context
// window on a genuinely large page.
const BATCH_SIZE = 40;
// Parallel batches in flight at once - enough to pipeline a big page
// faster than strictly serial, low enough not to make a local Ollama
// model (which can only really run one generation at a time anyway)
// context-switch itself into worse latency than just queuing would give.
const BATCH_CONCURRENCY = 2;

const MARKER_LINE = /^\[(\d+)\]\s?(.*)$/;

async function translateBatch(agentId: string, batch: PageTranslateTextEntry[], targetLanguage: string): Promise<PageTranslateTextEntry[]> {
  const agentEntry = getAgentForRequest(agentId);
  if (!agentEntry) throw new Error('This agent no longer exists - it may have been removed in Settings.');

  const send = getAdapter(agentEntry.config.provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);

  // Hard line breaks would break the one-line-per-marker protocol below -
  // collapsed to a single space, which is harmless for how this text is
  // about to be displayed (normal HTML text flow already collapses
  // whitespace visually outside <pre>, and preload/pageTranslate.ts
  // already skips <pre>/<code> entirely).
  const prompt = batch.map((entry, i) => `[${i + 1}] ${entry.text.replace(/\s+/g, ' ').trim()}`).join('\n');

  let result = '';
  try {
    await send({
      apiKey: agentEntry.apiKey,
      baseUrl: agentEntry.config.baseUrl,
      model: agentEntry.config.model,
      systemPrompt:
        `You are translating short fragments of text from a web page into ${targetLanguage}. ` +
        'Each input line is formatted "[N] text". Reply with the SAME number of lines, in the SAME order, each ' +
        'formatted "[N] translation" with the exact same [N] marker as its input line - never merge two lines ' +
        'into one, never split one line into two, never renumber, never add or drop a line. ' +
        'Translate directly and literally - preserve the original meaning and wording as closely as the target ' +
        'language allows. Do NOT paraphrase, summarize, or rephrase into more natural-sounding prose - a direct ' +
        'translation that reads slightly awkward is correct; a smooth paraphrase that drifts from the source is ' +
        'not. If a line is a proper noun, a number, or otherwise untranslatable, echo it unchanged. ' +
        'Reply with ONLY the numbered lines - no preamble, no notes, nothing else.',
      history: [],
      newText: prompt,
      tools: [],
      signal: controller.signal,
      onToolCall: () => {
        // Page translation never needs tools - unreachable with tools: []
        // above, but SendFn requires the callback.
      },
      onChunk: (delta) => {
        result += delta;
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  const byMarker = new Map<number, string>();
  for (const line of result.split('\n')) {
    const match = MARKER_LINE.exec(line.trim());
    if (!match) continue;
    byMarker.set(Number(match[1]), match[2]);
  }

  const resolved: PageTranslateTextEntry[] = [];
  batch.forEach((entry, i) => {
    const translated = byMarker.get(i + 1);
    // Missing/unparseable lines are dropped, not filled in with the
    // original - the caller (preload/pageTranslate.ts) simply leaves
    // whatever untranslated node alone rather than showing a fake
    // "translation" that's actually just the source text relabeled.
    if (translated !== undefined && translated.trim()) resolved.push({ id: entry.id, text: translated });
  });
  return resolved;
}

/** Splits `entries` into BATCH_SIZE-sized chunks, translates them with
 * BATCH_CONCURRENCY batches in flight at once, and returns every
 * successfully-resolved entry across all batches - a batch that errors
 * (timeout, agent removed mid-run, etc.) just contributes nothing rather
 * than failing the whole page, matching how a single wonky line failing to
 * parse doesn't taint the rest of its own batch either. */
export async function translatePageBatch(
  agentId: string,
  entries: PageTranslateTextEntry[],
  targetLanguage: string,
): Promise<PageTranslateTextEntry[]> {
  const nonEmpty = entries.filter((e) => e.text.trim());
  if (nonEmpty.length === 0) return [];

  const batches: PageTranslateTextEntry[][] = [];
  for (let i = 0; i < nonEmpty.length; i += BATCH_SIZE) batches.push(nonEmpty.slice(i, i + BATCH_SIZE));

  const results: PageTranslateTextEntry[] = [];
  let nextBatchIndex = 0;
  const worker = async () => {
    while (nextBatchIndex < batches.length) {
      const batch = batches[nextBatchIndex++];
      try {
        results.push(...(await translateBatch(agentId, batch, targetLanguage)));
      } catch (err) {
        console.error('[page translate] batch failed:', err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, () => worker()));
  return results;
}
