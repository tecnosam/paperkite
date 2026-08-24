/**
 * Runs one audio chunk through a whisper.cpp binary and returns the
 * transcribed text. whisper.cpp's CLI only reads from real files (no
 * stdin support), so each chunk is a temp WAV file, cleaned up after.
 *
 * Two modes, chosen by the caller (see ipc.ts's AUDIO_CHUNK handler):
 *  - `translateToEnglish: false` (default) - transcribes in the ORIGINAL
 *    spoken language (`-l auto`, no `-tr`). whisper.cpp can only translate
 *    to English on its own, so any other target language needs a second
 *    hop against the user's chosen agent (see translate.ts).
 *  - `translateToEnglish: true` - whisper's own `-tr` flag does the whole
 *    job in one pass, still detecting the spoken language via `-l auto`
 *    but emitting English directly. Skips the agent hop entirely when
 *    that's exactly the target language anyway - no extra network call, no
 *    extra failure point, no agent required to even be configured.
 *
 * `previousText` feeds the prior chunk's own transcript back in as
 * whisper's `--prompt` - a real fix, not a tweak, for a failure mode
 * confirmed by hand: with short, context-free chunks, the tiny model falls
 * back to emitting the literal bracketed placeholder "(Speaking foreign
 * language)" instead of attempting non-English speech at all - a real,
 * if unfortunate, learned pattern from whisper's own training data, and
 * the tiny model (the weakest variant at multilingual work) hits it far
 * more readily than transcribing what's actually being said. Passing
 * recent context back in gives it continuity to recognize "this is
 * ongoing speech in a language I should attempt" rather than treating
 * each isolated fragment as ambiguous.
 *
 * `pageContext` (the tab's title/domain - see ipc.ts's AUDIO_CHUNK
 * handler) rides in the same `--prompt`, ahead of `previousText` - whisper
 * biases its vocabulary/spelling toward whatever's in the prompt, so
 * telling it up front what kind of page this is (a cooking channel, a
 * tech talk, etc.) gives it a real prior for domain-specific terms and
 * proper nouns it would otherwise have no way to guess at, on top of the
 * plain transcript continuity `previousText` already provides.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const TRANSCRIBE_TIMEOUT_MS = 20_000;

// whisper.cpp caps how much of a supplied --prompt it actually uses
// (documented as roughly half its text context window) - trimming to the
// last stretch of characters here is just to avoid handing over an
// ever-growing string as a session runs long, not a precise token budget.
const MAX_PROMPT_CHARS = 200;
// Page context gets its own smaller, fixed budget out of the total above -
// short enough to always leave meaningful room for previousText (which
// matters more once a session's been running a while), but long enough for
// a real title + domain.
const MAX_PAGE_CONTEXT_CHARS = 100;

function buildPrompt(pageContext: string, previousText: string): string {
  const context = pageContext.slice(0, MAX_PAGE_CONTEXT_CHARS);
  const remainingBudget = MAX_PROMPT_CHARS - context.length - (context && previousText ? 1 : 0);
  const transcript = previousText.slice(-Math.max(0, remainingBudget));
  if (context && transcript) return `${context} ${transcript}`;
  return context || transcript;
}

export async function transcribeWavChunk(
  binaryPath: string,
  modelPath: string,
  wavBytes: Uint8Array,
  translateToEnglish = false,
  previousText = '',
  pageContext = '',
): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `paperkite-subtitle-${randomUUID()}.wav`);
  await fs.writeFile(tmpFile, wavBytes);

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      // -nt: no timestamps, -np: no prints except the actual transcription -
      // together these give plain recognized text on stdout, nothing else
      // to parse out. -l auto lets whisper detect the spoken language
      // itself rather than assuming English. -sns (--suppress-nst) tells
      // whisper to suppress non-speech tokens during decoding - a second,
      // model-level layer against hallucinated output on chunks that turn
      // out to be mostly ambient noise/music despite passing our own
      // client-side VAD (see renderer/chrome/audioCapture.ts).
      const args = ['-m', modelPath, '-f', tmpFile, '-l', 'auto', '-nt', '-np', '-sns'];
      if (translateToEnglish) args.push('-tr');
      const prompt = buildPrompt(pageContext, previousText);
      if (prompt) args.push('--prompt', prompt);
      execFile(binaryPath, args, { timeout: TRANSCRIBE_TIMEOUT_MS }, (err, out, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve(out);
      });
    });
    return stdout.trim();
  } finally {
    await fs.unlink(tmpFile).catch(() => {
      // Best-effort cleanup - a leftover temp file every few seconds isn't
      // worth failing the transcription over.
    });
  }
}
