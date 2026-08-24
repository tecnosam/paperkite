/**
 * Persists the open tab list (URLs, in order, plus which one was active)
 * across restarts, so quitting Paperkite doesn't throw away every open
 * tab - same disk-backed-flat-file idea as historyStore.ts/bookmarkStore.ts,
 * saved to `userData/session.json`. TabManager itself doesn't know this
 * module exists - main/index.ts wires saves off the existing onTabsChanged
 * callback and reads this once at startup, the same separation-of-concerns
 * historyStore.ts's onPageVisited callback already follows.
 *
 * Unlike those simpler stores, writes here are debounced rather than
 * synchronous: onTabsChanged fires far more often than the tab *list*
 * actually changes structurally - a single page load alone fires it for
 * loading-start, loading-stop, and often several title/favicon updates -
 * so writing to disk on every single one would be needless I/O.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const SAVE_DEBOUNCE_MS = 800;

interface PersistedSession {
  tabs: string[];
  activeIndex: number;
}

function sessionFilePath(): string {
  return path.join(app.getPath('userData'), 'session.json');
}

/** Returns null if there's nothing worth restoring (no file yet, it's
 * corrupt, or it was saved with zero tabs somehow) - the caller falls back
 * to a single fresh new-tab page in that case, same as a first-ever launch. */
export function loadSession(): PersistedSession | null {
  try {
    const raw = fs.readFileSync(sessionFilePath(), 'utf-8');
    const data = JSON.parse(raw) as Partial<PersistedSession>;
    if (!Array.isArray(data.tabs) || data.tabs.length === 0) return null;
    return { tabs: data.tabs, activeIndex: typeof data.activeIndex === 'number' ? data.activeIndex : 0 };
  } catch {
    return null;
  }
}

function persist(persistedSession: PersistedSession): void {
  fs.mkdirSync(path.dirname(sessionFilePath()), { recursive: true });
  fs.writeFileSync(sessionFilePath(), JSON.stringify(persistedSession), 'utf-8');
}

let saveTimer: NodeJS.Timeout | null = null;
let pending: PersistedSession | null = null;

export function scheduleSessionSave(tabs: string[], activeIndex: number): void {
  pending = { tabs, activeIndex };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (pending) persist(pending);
  }, SAVE_DEBOUNCE_MS);
}

/** Called on app quit (see main/index.ts's before-quit handler) - without
 * this, a quit that lands inside the debounce window would save stale
 * (or no) state instead of the tab list the user actually quit with. */
export function flushSessionSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (pending) persist(pending);
}
