/**
 * Disk-backed browsing history, one flat chronological list (unlike
 * chatStore.ts, there's no per-room grouping - every visited page across
 * every tab lands in the same list). Persisted to `userData/history.json`.
 *
 * Unlike chat messages, browsing history isn't given a short age-based
 * expiry - it's capped purely by entry count (MAX_ENTRIES, oldest evicted
 * first) so the file doesn't grow unbounded over a long-lived install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import type { HistoryEntry } from '../shared/types';

export const MAX_ENTRIES = 5000;

interface HistoryFile {
  entries: HistoryEntry[];
}

function historyFilePath(): string {
  return path.join(app.getPath('userData'), 'history.json');
}

function loadFromDisk(): HistoryEntry[] {
  try {
    const raw = fs.readFileSync(historyFilePath(), 'utf-8');
    const data = JSON.parse(raw) as HistoryFile;
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return []; // no history file yet, or it's corrupt
  }
}

let entries = loadFromDisk();

function persist(): void {
  const data: HistoryFile = { entries };
  fs.mkdirSync(path.dirname(historyFilePath()), { recursive: true });
  fs.writeFileSync(historyFilePath(), JSON.stringify(data), 'utf-8');
}

/**
 * One page of history, newest first, optionally filtered by a
 * case-insensitive title/url substring match - the settings History
 * section fetches this on demand (initial load, scrolling further down,
 * and on each search-query change) instead of ever holding the full list
 * in the renderer.
 */
export function getHistoryPage(offset: number, limit: number, query: string): { entries: HistoryEntry[]; hasMore: boolean } {
  const newestFirst = [...entries].reverse();
  const q = query.trim().toLowerCase();
  const filtered = q
    ? newestFirst.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q))
    : newestFirst;

  return {
    entries: filtered.slice(offset, offset + limit),
    hasMore: offset + limit < filtered.length,
  };
}

/**
 * Records a page visit. If the most recently recorded entry is for the
 * same URL, its title is patched in place instead of appending a new
 * entry - this is what lets a single call site (page-title-updated, which
 * can fire more than once per navigation as a page's title settles) both
 * create and correct the entry without double-logging one visit.
 */
export function recordVisit(url: string, title: string): void {
  const last = entries[entries.length - 1];
  if (last && last.url === url) {
    last.title = title;
  } else {
    entries.push({ id: randomUUID(), url, title, timestamp: Date.now() });
    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(entries.length - MAX_ENTRIES);
    }
  }
  persist();
}

/** How many distinct pages were visited in a time window - used to
 * annotate the gap between two consecutive screenshots in a chain (see
 * chatStore.getScreenshotChain()). `fromTs` exclusive, `toTs` inclusive,
 * so a page visited exactly at a screenshot's own capture time doesn't
 * get double-counted against both the gap before and after it. */
export function countUniquePagesBetween(fromTs: number, toTs: number): number {
  const urls = new Set<string>();
  for (const entry of entries) {
    if (entry.timestamp > fromTs && entry.timestamp <= toTs) urls.add(entry.url);
  }
  return urls.size;
}

export function deleteEntry(id: string): void {
  entries = entries.filter((e) => e.id !== id);
  persist();
}

export function clearHistory(): void {
  entries = [];
  persist();
}

/** Total entry count, unfiltered - for the Privacy & Data section's
 * summary (see ipc.ts's REQUEST_DATA_USAGE_SUMMARY), which wants a plain
 * count without paying for a full page fetch. */
export function getHistoryCount(): number {
  return entries.length;
}
