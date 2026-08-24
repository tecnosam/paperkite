/**
 * Disk-backed bookmarks and bookmark folders, persisted together to
 * `userData/bookmarks.json`. Unlike historyStore, entries are user-curated
 * (added one at a time from the toolbar star), so there's no automatic cap
 * or eviction.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import type { BookmarkEntry, BookmarkFolder } from '../shared/types';

interface BookmarksFile {
  entries: BookmarkEntry[];
  folders: BookmarkFolder[];
}

function bookmarksFilePath(): string {
  return path.join(app.getPath('userData'), 'bookmarks.json');
}

function loadFromDisk(): BookmarksFile {
  try {
    const raw = fs.readFileSync(bookmarksFilePath(), 'utf-8');
    const data = JSON.parse(raw) as Partial<BookmarksFile>;
    return {
      // Pre-folders bookmarks.json files have no `folderId` on entries and
      // no `folders` array at all - both default cleanly to "unfiled".
      entries: (Array.isArray(data.entries) ? data.entries : []).map((e) => ({ ...e, folderId: e.folderId ?? null })),
      folders: Array.isArray(data.folders) ? data.folders : [],
    };
  } catch {
    return { entries: [], folders: [] }; // no bookmarks file yet, or it's corrupt
  }
}

let { entries, folders } = loadFromDisk();

function persist(): void {
  const data: BookmarksFile = { entries, folders };
  fs.mkdirSync(path.dirname(bookmarksFilePath()), { recursive: true });
  fs.writeFileSync(bookmarksFilePath(), JSON.stringify(data), 'utf-8');
}

/** Newest first, for direct display in the settings list. */
export function getBookmarks(): BookmarkEntry[] {
  return [...entries].reverse();
}

export function getFolders(): BookmarkFolder[] {
  return [...folders];
}

export function isBookmarked(url: string): boolean {
  return entries.some((e) => e.url === url);
}

/** Adds a bookmark for `url` if it isn't already one, otherwise removes
 * it - what the toolbar star button calls. Always files new bookmarks at
 * the root; the popover that opens right after is where the user picks a
 * folder (see moveBookmark). */
export function toggleBookmark(url: string, title: string): void {
  const existing = entries.find((e) => e.url === url);
  if (existing) {
    entries = entries.filter((e) => e.id !== existing.id);
  } else {
    entries.push({ id: randomUUID(), url, title, timestamp: Date.now(), folderId: null });
  }
  persist();
}

/** Unconditionally adds a new bookmark filed straight into `folderId`
 * (skips if the URL's already bookmarked, rather than duplicating it) -
 * what bulk import uses. `toggleBookmark` is deliberately not reused here:
 * its toggle-off-if-present behavior is right for a single star click, but
 * would silently *remove* an existing bookmark mid-import instead of
 * leaving it alone. */
export function addBookmark(url: string, title: string, folderId: string | null): BookmarkEntry | null {
  if (entries.some((e) => e.url === url)) return null;
  const entry: BookmarkEntry = { id: randomUUID(), url, title, timestamp: Date.now(), folderId };
  entries.push(entry);
  persist();
  return entry;
}

export function removeBookmark(id: string): void {
  entries = entries.filter((e) => e.id !== id);
  persist();
}

export function renameBookmark(id: string, title: string): void {
  const entry = entries.find((e) => e.id === id);
  if (entry) {
    entry.title = title;
    persist();
  }
}

/** `folderId: null` files it back to unfiled/root. No-op silently if the
 * folder doesn't exist (deleted out from under a stale UI reference). */
export function moveBookmark(id: string, folderId: string | null): void {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  if (folderId !== null && !folders.some((f) => f.id === folderId)) return;
  entry.folderId = folderId;
  persist();
}

export function createFolder(name: string, parentId: string | null): BookmarkFolder {
  const folder: BookmarkFolder = { id: randomUUID(), name, parentId, createdAt: Date.now() };
  folders.push(folder);
  persist();
  return folder;
}

export function renameFolder(id: string, name: string): void {
  const folder = folders.find((f) => f.id === id);
  if (folder) {
    folder.name = name;
    persist();
  }
}

/** Case-insensitive match against folders sharing `parentId` - used by the
 * MCP tools so an agent can say "file this under Research" without ever
 * knowing an id, creating the folder on first use. */
export function findOrCreateFolderByName(name: string, parentId: string | null): BookmarkFolder {
  const existing = folders.find((f) => f.parentId === parentId && f.name.toLowerCase() === name.toLowerCase());
  return existing ?? createFolder(name, parentId);
}

/** Deletes a folder and, matching Chrome, cascades: every subfolder
 * (recursively) and every bookmark filed anywhere in that subtree goes
 * with it. There's no undo, same as every other delete in this app. */
/** Wipes every bookmark AND folder - a full reset, not just the entries,
 * so "clear my bookmarks" (see ipc.ts's CLEAR_ALL_BOOKMARKS) doesn't leave
 * a pile of now-empty folders behind. */
export function clearAllBookmarks(): void {
  entries = [];
  folders = [];
  persist();
}

export function deleteFolder(id: string): void {
  const toDelete = new Set<string>([id]);
  // Folders form a small tree - repeatedly sweep for children of anything
  // already marked, until a pass finds nothing new.
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && toDelete.has(f.parentId) && !toDelete.has(f.id)) {
        toDelete.add(f.id);
        grew = true;
      }
    }
  }
  folders = folders.filter((f) => !toDelete.has(f.id));
  entries = entries.filter((e) => !e.folderId || !toDelete.has(e.folderId));
  persist();
}
