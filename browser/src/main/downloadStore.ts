/**
 * Tracks downloads from `will-download` through to a terminal state and
 * persists the history (`userData/downloads.json`) - but only terminal
 * entries (completed/cancelled/interrupted). A live `DownloadItem` isn't
 * serializable and stops being valid once the app restarts, so in-progress
 * state is never written to disk; a download interrupted by quitting the
 * app is simply gone from history, same as most browsers' behavior for an
 * unclean shutdown.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, type DownloadItem } from 'electron';
import { randomUUID } from 'node:crypto';
import type { DownloadRecord } from '../shared/types';

interface DownloadsFile {
  entries: DownloadRecord[];
}

/** Live items, keyed by our own id (not Electron's, which isn't exposed) -
 * lets IPC handlers cancel/pause a specific in-progress download. */
const liveItems = new Map<string, DownloadItem>();

function downloadsFilePath(): string {
  return path.join(app.getPath('userData'), 'downloads.json');
}

function loadFromDisk(): DownloadRecord[] {
  try {
    const raw = fs.readFileSync(downloadsFilePath(), 'utf-8');
    const data = JSON.parse(raw) as DownloadsFile;
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return []; // no downloads file yet, or it's corrupt
  }
}

let persisted = loadFromDisk();
/** In-memory list actually shown to the UI: persisted (terminal) entries
 * plus whatever's currently progressing, newest first. */
let records: DownloadRecord[] = [...persisted].reverse();

function persist(): void {
  const data: DownloadsFile = { entries: persisted };
  fs.mkdirSync(path.dirname(downloadsFilePath()), { recursive: true });
  fs.writeFileSync(downloadsFilePath(), JSON.stringify(data), 'utf-8');
}

export function getDownloads(): DownloadRecord[] {
  return records;
}

/** Wires a freshly-started DownloadItem (from session's 'will-download')
 * into a tracked record, calling `onChange` on every update so the caller
 * can broadcast the new list. */
export function trackDownload(item: DownloadItem, onChange: () => void): void {
  const id = randomUUID();
  const record: DownloadRecord = {
    id,
    filename: item.getFilename(),
    url: item.getURL(),
    savePath: item.getSavePath(),
    totalBytes: item.getTotalBytes(),
    receivedBytes: 0,
    state: 'progressing',
    startTime: Date.now(),
  };
  liveItems.set(id, item);
  records = [record, ...records];
  onChange();

  item.on('updated', (_event, state) => {
    record.receivedBytes = item.getReceivedBytes();
    record.savePath = item.getSavePath();
    record.state = state === 'interrupted' ? 'interrupted' : 'progressing';
    onChange();
  });

  item.once('done', (_event, state) => {
    record.state = state;
    record.receivedBytes = item.getReceivedBytes();
    liveItems.delete(id);
    persisted = [...persisted, record];
    persist();
    onChange();
  });
}

export function cancelDownload(id: string): void {
  liveItems.get(id)?.cancel();
}

export function clearFinished(): void {
  persisted = [];
  records = records.filter((r) => r.state === 'progressing');
  persist();
}

/** Chrome-style de-duplication: "screenshot.jpg", "screenshot (1).jpg", etc. */
function uniqueDownloadPath(filename: string): string {
  const dir = app.getPath('downloads');
  const { name, ext } = path.parse(filename);
  let candidate = path.join(dir, filename);
  for (let n = 1; fs.existsSync(candidate); n++) {
    candidate = path.join(dir, `${name} (${n})${ext}`);
  }
  return candidate;
}

/**
 * Writes a chat screenshot attachment's data URL to the user's Downloads
 * folder and records it as a completed download - the same list/panel as
 * everything from `will-download`, so a saved chat image is visible and
 * manageable (open/show in folder) the same way any other download is,
 * rather than vanishing into the filesystem with no trace in the UI.
 */
export function saveImageToDownloads(dataUrl: string, onChange: () => void): { ok: true; savePath: string } | { ok: false } {
  const prefix = 'data:image/jpeg;base64,';
  if (!dataUrl.startsWith(prefix)) return { ok: false };

  try {
    const buffer = Buffer.from(dataUrl.slice(prefix.length), 'base64');
    const savePath = uniqueDownloadPath(`paperkite-screenshot-${Date.now()}.jpg`);
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, buffer);

    const record: DownloadRecord = {
      id: randomUUID(),
      filename: path.basename(savePath),
      url: '',
      savePath,
      totalBytes: buffer.length,
      receivedBytes: buffer.length,
      state: 'completed',
      startTime: Date.now(),
    };
    records = [record, ...records];
    persisted = [...persisted, record];
    persist();
    onChange();

    return { ok: true, savePath };
  } catch {
    return { ok: false };
  }
}
