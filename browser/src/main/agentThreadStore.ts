/**
 * Disk-backed storage for private agent threads (`userData/agentThreads.json`).
 * Unlike chatStore.ts, this isn't keyed by room/URL - threads persist across
 * navigation, so it's just a flat list of threads plus a flat list of
 * messages keyed by threadId. No retention policy: this is user-authored
 * content the user explicitly created, like bookmarks, not ambient chat
 * chatter that should age out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import type { AgentThread, AgentMessage } from '../shared/types';

interface ThreadsFile {
  threads: AgentThread[];
  messages: Record<string, AgentMessage[]>;
}

function threadsFilePath(): string {
  return path.join(app.getPath('userData'), 'agentThreads.json');
}

function loadFromDisk(): ThreadsFile {
  try {
    const raw = fs.readFileSync(threadsFilePath(), 'utf-8');
    const data = JSON.parse(raw) as ThreadsFile;
    return {
      threads: Array.isArray(data.threads) ? data.threads : [],
      messages: data.messages && typeof data.messages === 'object' ? data.messages : {},
    };
  } catch {
    return { threads: [], messages: {} }; // no file yet, or it's corrupt
  }
}

const store = loadFromDisk();

function persist(): void {
  fs.mkdirSync(path.dirname(threadsFilePath()), { recursive: true });
  fs.writeFileSync(threadsFilePath(), JSON.stringify(store), 'utf-8');
}

export function getThreads(): AgentThread[] {
  return [...store.threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getMessages(threadId: string): AgentMessage[] {
  return store.messages[threadId] ?? [];
}

export function createThread(agentId: string): AgentThread {
  const now = Date.now();
  const thread: AgentThread = {
    id: randomUUID(),
    agentId,
    title: 'New thread',
    createdAt: now,
    updatedAt: now,
  };
  store.threads.push(thread);
  store.messages[thread.id] = [];
  persist();
  return thread;
}

export function deleteThread(threadId: string): void {
  store.threads = store.threads.filter((t) => t.id !== threadId);
  delete store.messages[threadId];
  persist();
}

/** Wipes every thread and its messages - see ipc.ts's
 * CLEAR_ALL_AGENT_THREADS, which also aborts any in-flight stream first
 * (same defensive step deleteThread's own caller takes per-thread). */
export function clearAllThreads(): void {
  store.threads = [];
  store.messages = {};
  persist();
}

/** Derives a thread's title from the first ~40 chars of its first user
 * message - called once, right after that message is added. */
function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed || 'New thread';
}

export function addMessage(threadId: string, message: Omit<AgentMessage, 'id'>): AgentMessage {
  const full: AgentMessage = { ...message, id: randomUUID() };
  const list = store.messages[threadId] ?? [];
  list.push(full);
  store.messages[threadId] = list;

  const thread = store.threads.find((t) => t.id === threadId);
  if (thread) {
    thread.updatedAt = full.timestamp;
    if (thread.title === 'New thread' && message.role === 'user') {
      thread.title = deriveTitle(message.text);
    }
  }
  persist();
  return full;
}

/** Appends a streamed chunk to an already-added assistant message's text -
 * called repeatedly as chunks arrive, but only persisted once the stream
 * finishes (see finalizeMessage) so a mid-stream crash doesn't leave a
 * partial write on every single chunk. */
export function appendToMessage(threadId: string, messageId: string, textDelta: string): void {
  const message = store.messages[threadId]?.find((m) => m.id === messageId);
  if (message) message.text += textDelta;
}

/** Persists the final state of a streamed message (or an error) once the
 * stream is done - see appendToMessage's note on why this isn't done per-chunk. */
export function finalizeMessage(threadId: string, messageId: string, error?: string): void {
  const message = store.messages[threadId]?.find((m) => m.id === messageId);
  if (message && error) message.error = error;
  persist();
}

/** Clears a failed assistant message's text/error in place so the
 * streaming pipeline can reuse its id for a retry, rather than creating a
 * new user/assistant pair - see main/ipc.ts's retry flow. `null` if the
 * message doesn't exist or isn't a failed assistant message (nothing
 * sensible to retry). */
export function resetMessageForRetry(threadId: string, messageId: string): AgentMessage | null {
  const message = store.messages[threadId]?.find((m) => m.id === messageId);
  if (!message || message.role !== 'assistant' || !message.error) return null;
  message.text = '';
  message.error = undefined;
  persist();
  return message;
}
