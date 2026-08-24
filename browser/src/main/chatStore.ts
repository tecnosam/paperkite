/**
 * What's left of the old local-only mock chat store, after the page chat
 * itself moved to a real external chat-service (see main/chatSession.ts
 * and ../../chat-service/PROTOCOL.md). All that's left here is historical
 * screenshot-attachment data: `getScreenshotChain` still backs the image
 * lightbox's prev/next browsing (see renderer/chat/components/
 * ImageLightbox.tsx), scanning whatever's in `userData/chatHistory.json`
 * from before this migration. Nothing writes new entries into this file
 * anymore - it's read-only history now, aging out naturally via the same
 * retention policy it always had (30-day age cap, 256-per-room cap,
 * pinned-exempt - moot going forward since nothing pins new entries
 * either, but harmless to leave running for whatever's already on disk).
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { ChatMessage, MessageAttachment } from '../shared/types';

const MAX_MESSAGES_PER_ROOM = 256;
const MAX_MESSAGE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

interface HistoryFile {
  rooms: Record<string, ChatMessage[]>;
}

function historyFilePath(): string {
  return path.join(app.getPath('userData'), 'chatHistory.json');
}

function loadFromDisk(): Map<string, ChatMessage[]> {
  try {
    const raw = fs.readFileSync(historyFilePath(), 'utf-8');
    const data = JSON.parse(raw) as HistoryFile;
    return new Map(Object.entries(data.rooms));
  } catch {
    return new Map(); // no history file, or it's corrupt - nothing to scan
  }
}

const rooms = loadFromDisk();

function persist(): void {
  const data: HistoryFile = { rooms: Object.fromEntries(rooms) };
  fs.mkdirSync(path.dirname(historyFilePath()), { recursive: true });
  fs.writeFileSync(historyFilePath(), JSON.stringify(data), 'utf-8');
}

/** Trims one room in place per the retention policy. Returns true if it
 * actually changed anything, so callers only persist when needed. */
function enforceRetention(roomKey: string): boolean {
  const list = rooms.get(roomKey);
  if (!list || list.length === 0) return false;

  const now = Date.now();
  let next = list.filter((m) => m.pinned || now - m.timestamp <= MAX_MESSAGE_AGE_MS);

  const nonPinnedCount = next.reduce((n, m) => n + (m.pinned ? 0 : 1), 0);
  if (nonPinnedCount > MAX_MESSAGES_PER_ROOM) {
    // `next` is chronological, so filtering out the first N non-pinned
    // messages we encounter drops the oldest ones - exactly what we want.
    let toDrop = nonPinnedCount - MAX_MESSAGES_PER_ROOM;
    next = next.filter((m) => {
      if (m.pinned || toDrop <= 0) return true;
      toDrop--;
      return false;
    });
  }

  if (next.length === list.length) return false;
  rooms.set(roomKey, next);
  return true;
}

// Enforce retention immediately on load - covers a history file that
// already exceeds the cap, or has aged past 30 days since the app last ran.
{
  let changed = false;
  for (const roomKey of rooms.keys()) {
    if (enforceRetention(roomKey)) changed = true;
  }
  if (changed) persist();
}

setInterval(() => {
  let changed = false;
  for (const roomKey of rooms.keys()) {
    if (enforceRetention(roomKey)) changed = true;
  }
  if (changed) persist();
}, RETENTION_SWEEP_INTERVAL_MS).unref();

/**
 * Every screenshot ever sent, across every room, oldest first - the raw
 * material for getScreenshotChain() below. Not cached: called only when
 * a lightbox is opened, and the rooms map only shrinks over time now (see
 * file header), so a full scan stays cheap.
 */
function allAttachmentsChronological(): MessageAttachment[] {
  const attachments: MessageAttachment[] = [];
  for (const list of rooms.values()) {
    for (const message of list) {
      if (message.attachments) attachments.push(...message.attachments);
    }
  }
  return attachments.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * The small window of screenshots immediately before/after `attachmentId`
 * in time, across every room - `radius` before and `radius` after,
 * clamped at the ends. Returns `null` if the id isn't found (its message
 * or room may have since aged out via retention, or - for anything sent
 * after the migration to a real chat-service - never existed here at all,
 * since real messages carry no attachments).
 */
export function getScreenshotChain(attachmentId: string, radius: number): MessageAttachment[] | null {
  const all = allAttachmentsChronological();
  const index = all.findIndex((a) => a.id === attachmentId);
  if (index === -1) return null;
  return all.slice(Math.max(0, index - radius), index + radius + 1);
}
