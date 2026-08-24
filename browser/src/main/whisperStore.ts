/**
 * Locates and persists config for whisper.cpp - the local speech-to-text
 * engine live translate uses to transcribe tab audio (see
 * whisperTranscribe.ts). Paperkite doesn't install, bundle, or manage
 * whisper.cpp itself; the user gets it onto their machine however they
 * like (Homebrew, building from source, whatever) and either it resolves
 * on PATH under a name we recognize, or they point at it explicitly in
 * Settings. Same is true of the model file - there's no download flow
 * here, just a path picker.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { app } from 'electron';
import type { WhisperConfig, WhisperStatus } from '../shared/types';
import { DEFAULT_WHISPER_CONFIG } from '../shared/types';

/** Tried in order - different distributions have shipped whisper.cpp's
 * CLI under all of these at one point or another (`main` is the historical
 * name from the project's own examples, before it was renamed). */
const CANDIDATE_BINARY_NAMES = ['whisper-cli', 'whisper-cpp', 'whisper', 'main'];

function configFilePath(): string {
  return path.join(app.getPath('userData'), 'whisper.json');
}

export function loadWhisperConfig(): WhisperConfig {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf-8');
    const data = JSON.parse(raw) as Partial<WhisperConfig>;
    return { ...DEFAULT_WHISPER_CONFIG, ...data };
  } catch {
    return { ...DEFAULT_WHISPER_CONFIG };
  }
}

export function saveWhisperConfig(config: WhisperConfig): void {
  fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
  fs.writeFileSync(configFilePath(), JSON.stringify(config), 'utf-8');
}

function which(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('which', [name], (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
}

/** Confirms a path is actually runnable and looks like whisper.cpp (its
 * --help output mentions "whisper") - not just that a file exists there,
 * since a stale/misconfigured path shouldn't silently claim to be ready. */
function verifyBinary(binPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(binPath, ['--help'], { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        resolve(false);
        return;
      }
      resolve(/whisper/i.test(stdout) || /whisper/i.test(stderr));
    });
  });
}

/** `which` only finds what's on PATH, and a GUI-launched app (as opposed to
 * one started from an interactive shell) doesn't necessarily inherit the
 * shell's PATH - Homebrew's own install dirs are the classic case that
 * goes missing. Falling back to checking these directly means "I just
 * brew installed it" keeps working regardless of how Paperkite itself was
 * launched. */
const HOMEBREW_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

async function detectBinary(): Promise<string | null> {
  for (const name of CANDIDATE_BINARY_NAMES) {
    const resolved = await which(name);
    if (resolved && (await verifyBinary(resolved))) return resolved;
  }
  for (const dir of HOMEBREW_BIN_DIRS) {
    for (const name of CANDIDATE_BINARY_NAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate) && (await verifyBinary(candidate))) return candidate;
    }
  }
  return null;
}

/** getWhisperStatus is called on every audio chunk (see ipc.ts's
 * AUDIO_CHUNK handler) - roughly every 5s while translate is on - to make
 * sure nothing's changed since the last check. Without caching, that means
 * re-spawning a `whisper-cli --help` subprocess every single chunk on top
 * of the actual transcription subprocess for that chunk: two whisper-cli
 * processes fighting over the same GPU/Metal backend every 5 seconds,
 * which is exactly the kind of contention that makes verifyBinary's 5s
 * timeout flaky - "whisper randomly stops being found" specifically while
 * it's in active use, not at rest. The fix: detect once, cache it, and
 * only re-detect when something that could actually change the answer
 * happens - the config being edited (see invalidateWhisperStatusCache,
 * called from ipc.ts's SET_WHISPER_CONFIG/PICK_WHISPER_MODEL handlers) or
 * an explicit REQUEST_WHISPER_STATUS from the renderer (Settings wants a
 * fresh read, e.g. after installing whisper.cpp while the app was open). */
let cachedStatus: WhisperStatus | null = null;

export function invalidateWhisperStatusCache(): void {
  cachedStatus = null;
}

export async function getWhisperStatus(forceRefresh = false): Promise<WhisperStatus> {
  if (cachedStatus && !forceRefresh) return cachedStatus;

  const config = loadWhisperConfig();

  let effectiveBinaryPath: string | null = null;
  let binaryAutoDetected = false;
  if (config.binaryPath) {
    effectiveBinaryPath = (await verifyBinary(config.binaryPath)) ? config.binaryPath : null;
  } else {
    effectiveBinaryPath = await detectBinary();
    binaryAutoDetected = effectiveBinaryPath !== null;
  }

  const modelExists = !!config.modelPath && fs.existsSync(config.modelPath);
  const translateModelExists = !!config.translateModelPath && fs.existsSync(config.translateModelPath);

  cachedStatus = {
    ready: effectiveBinaryPath !== null && modelExists,
    binaryPathOverride: config.binaryPath,
    effectiveBinaryPath,
    binaryAutoDetected,
    modelPath: config.modelPath,
    modelExists,
    translateModelPath: config.translateModelPath,
    translateModelExists,
  };
  return cachedStatus;
}
