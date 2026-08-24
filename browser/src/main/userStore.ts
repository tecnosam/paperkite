/**
 * Persists safety settings and theme preference to disk under `userData`.
 * There's no per-browser "identity" here anymore - a chat username is
 * per-server now (see chatServerStore.ts's ChatServerConfig.username), not
 * a single global one. Chat history has its own store - see chatStore.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { SafetySettings, ThemeSource } from '../shared/types';
import { DEFAULT_SAFETY_SETTINGS } from '../shared/types';

interface UserFile {
  safety: SafetySettings;
}

function userFilePath(): string {
  return path.join(app.getPath('userData'), 'user.json');
}

/** The OS-reported country, e.g. "US" - no network lookup involved. Used
 * as every chat server connection's `region` field (see
 * main/ipc.ts's resyncChatSession) - unlike username, there's no per-server
 * reason to vary this, so it's just read fresh wherever it's needed rather
 * than persisted. */
export function getSystemCountryCode(): string {
  try {
    const code = app.getLocaleCountryCode();
    return /^[A-Z]{2}$/i.test(code) ? code.toUpperCase() : 'US';
  } catch {
    return 'US';
  }
}

function readFile(): UserFile | null {
  try {
    const raw = fs.readFileSync(userFilePath(), 'utf-8');
    const data = JSON.parse(raw) as Partial<UserFile>;
    return { safety: { ...DEFAULT_SAFETY_SETTINGS, ...data.safety } };
  } catch {
    // No file yet, or it's corrupt - treat both as "nothing saved".
    return null;
  }
}

function writeFile(data: UserFile): void {
  fs.mkdirSync(path.dirname(userFilePath()), { recursive: true });
  fs.writeFileSync(userFilePath(), JSON.stringify(data, null, 2), 'utf-8');
}

export function loadSafetySettings(): SafetySettings {
  return readFile()?.safety ?? DEFAULT_SAFETY_SETTINGS;
}

export function saveSafetySettings(safety: SafetySettings): void {
  writeFile({ safety });
}

// Theme is deliberately its own file, not part of user.json - a device
// preference, not part of the (now per-server) chat identity.
interface ThemeFile {
  source: ThemeSource;
}

function themeFilePath(): string {
  return path.join(app.getPath('userData'), 'theme.json');
}

export function loadThemeSource(): ThemeSource {
  try {
    const raw = fs.readFileSync(themeFilePath(), 'utf-8');
    const data = JSON.parse(raw) as Partial<ThemeFile>;
    return data.source === 'light' || data.source === 'dark' ? data.source : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemeSource(source: ThemeSource): void {
  fs.mkdirSync(path.dirname(themeFilePath()), { recursive: true });
  fs.writeFileSync(themeFilePath(), JSON.stringify({ source } satisfies ThemeFile), 'utf-8');
}
