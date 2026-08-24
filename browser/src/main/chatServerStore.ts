/**
 * Persists the user's configured external chat-service backends (see
 * ../../chat-service/PROTOCOL.md) to `userData/chatServers.json`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import type { AddChatServerPayload, ChatServerConfig, UpdateChatServerPayload } from '../shared/types';

/** Adds the one field that never crosses IPC to a renderer - see its own
 * doc comment. Everything else here mirrors the public ChatServerConfig
 * shape exactly. */
interface StoredChatServerConfig extends ChatServerConfig {
  /** A previously-issued JWT for this server's username, cached after a
   * successful /connect - lets the NEXT connect (a new tab, a new room, an
   * app restart) present `token` instead of `username` per PROTOCOL.md's
   * "reuse an already-claimed identity" path, which skips the claim check
   * entirely and so can't 409 for a name this app already holds. `null`
   * before the first successful connect, or after `username`/`baseUrl`
   * changes invalidate whatever was cached (see updateChatServer). Never
   * returned by getChatServers()/getChatServerById() - only
   * getChatServerToken() exposes it, and only main/chatSession.ts calls
   * that; it has no business being sent to a renderer at all. */
  token: string | null;
}

interface ChatServersFile {
  servers: StoredChatServerConfig[];
  defaultServerId: string | null;
}

function chatServersFilePath(): string {
  return path.join(app.getPath('userData'), 'chatServers.json');
}

/** First-run seed: a single entry pointing at the hosted chat-service
 * instance, set as the default - gives chat something to connect to out of
 * the box rather than starting with an empty list and a broken-feeling
 * chat panel. Only used when no chatServers.json exists yet (see
 * loadedFromDisk below), same "seed once, never again" convention as
 * mcpStore.ts's defaultServers(). */
function seedServers(): ChatServersFile {
  const id = randomUUID();
  return {
    servers: [
      {
        id,
        name: 'Paperkite',
        baseUrl: 'https://paperkite-chat-service.samuelabolo.dev',
        username: null,
        token: null,
        createdAt: Date.now(),
      },
    ],
    defaultServerId: id,
  };
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, ''); // no trailing slash - endpoints are appended as e.g. `${baseUrl}/connect`
}

function normalizeUsername(username: string | null | undefined): string | null {
  const trimmed = username?.trim();
  return trimmed ? trimmed : null;
}

/** Strips `token` before anything leaves this module for a renderer -
 * built explicitly (not a destructure-and-discard) so a future field added
 * to StoredChatServerConfig doesn't silently leak to the public shape too. */
function toPublic(server: StoredChatServerConfig): ChatServerConfig {
  return { id: server.id, name: server.name, baseUrl: server.baseUrl, username: server.username, createdAt: server.createdAt };
}

let loadedFromDisk = true;

function loadFromDisk(): ChatServersFile {
  try {
    const raw = fs.readFileSync(chatServersFilePath(), 'utf-8');
    const data = JSON.parse(raw) as Partial<ChatServersFile>;
    const servers = Array.isArray(data.servers) ? data.servers : [];
    // Coerces pre-migration entries (missing `username`/`token` keys
    // entirely) to explicit `null` rather than leaving them `undefined`.
    return {
      servers: servers.map((s) => ({ ...s, username: normalizeUsername(s.username), token: s.token ?? null })),
      defaultServerId: data.defaultServerId ?? null,
    };
  } catch {
    loadedFromDisk = false;
    return seedServers();
  }
}

const state = loadFromDisk();

function persist(): void {
  fs.mkdirSync(path.dirname(chatServersFilePath()), { recursive: true });
  fs.writeFileSync(chatServersFilePath(), JSON.stringify(state), 'utf-8');
}

// Persist the seed immediately, same reasoning as mcpStore.ts's own
// first-run seeding - so it survives a quit before any real edit.
if (!loadedFromDisk) persist();

export function getChatServers(): ChatServerConfig[] {
  return state.servers.map(toPublic);
}

export function getDefaultChatServerId(): string | null {
  return state.defaultServerId;
}

export function getChatServerById(id: string): ChatServerConfig | null {
  const server = state.servers.find((s) => s.id === id);
  return server ? toPublic(server) : null;
}

/** Main-process-only - see StoredChatServerConfig.token's doc comment for
 * why this is a separate function from getChatServerById rather than a
 * field on its return value. */
export function getChatServerToken(id: string): string | null {
  return state.servers.find((s) => s.id === id)?.token ?? null;
}

/** Called after every successful /connect (see main/chatSession.ts's
 * onTokenIssued) - keeps the cached token current so the next connect for
 * this server, whatever tab/room triggers it, can reuse it. */
export function setChatServerToken(id: string, token: string): void {
  const server = state.servers.find((s) => s.id === id);
  if (!server) return;
  server.token = token;
  persist();
}

/** Called when a cached token turns out to be no longer good (see
 * main/chatSession.ts's onTokenInvalid) - so the next connect attempt
 * falls back to a fresh `username` claim instead of retrying the same bad
 * token forever. */
export function clearChatServerToken(id: string): void {
  const server = state.servers.find((s) => s.id === id);
  if (!server || server.token === null) return;
  server.token = null;
  persist();
}

/** True if some OTHER server already has this exact baseUrl (after the
 * same normalization `addChatServer`/`updateChatServer` apply, and
 * case-insensitively, since host/scheme aren't meaningfully
 * case-sensitive in practice) - pointing two configs at the same server
 * would just be confusing (two names for one identity, tokens getting
 * mixed up) and has no legitimate use here. `excludeId` lets an edit
 * check against every OTHER server without rejecting itself. */
function isDuplicateBaseUrl(baseUrl: string, excludeId: string | null): boolean {
  const normalized = normalizeBaseUrl(baseUrl).toLowerCase();
  return state.servers.some((s) => s.id !== excludeId && s.baseUrl.toLowerCase() === normalized);
}

export function addChatServer(payload: AddChatServerPayload): ChatServerConfig | null {
  if (isDuplicateBaseUrl(payload.baseUrl, null)) return null;
  const server: StoredChatServerConfig = {
    id: randomUUID(),
    name: payload.name.trim(),
    baseUrl: normalizeBaseUrl(payload.baseUrl),
    username: null,
    token: null,
    createdAt: Date.now(),
  };
  state.servers.push(server);
  // The very first server configured becomes the default automatically -
  // otherwise every tab would silently have nothing to connect to until
  // the user finds the separate "set as default" action.
  if (state.defaultServerId === null) state.defaultServerId = server.id;
  persist();
  return toPublic(server);
}

export function updateChatServer(payload: UpdateChatServerPayload): ChatServerConfig | null {
  const server = state.servers.find((s) => s.id === payload.id);
  if (!server) return null;
  if (isDuplicateBaseUrl(payload.baseUrl, payload.id)) return null;
  // A cached token proves a specific (baseUrl, username) pair - if the
  // baseUrl changes, it no longer describes the identity this config now
  // points at (a token is only valid on the server that signed it, so a
  // changed baseUrl is possibly a genuinely different server), so it
  // needs a fresh claim rather than risking a confusing 401 later.
  // (username itself can no longer change at all once set - see
  // setChatServerUsername - so it's never a reason to clear this here.)
  if (server.baseUrl !== normalizeBaseUrl(payload.baseUrl)) {
    server.token = null;
  }
  server.name = payload.name.trim();
  server.baseUrl = normalizeBaseUrl(payload.baseUrl);
  persist();
  return toPublic(server);
}

/** The only way a server's username is ever set (see
 * shared/types.ts's UpdateChatServerPayload doc comment) - called after
 * main/ipc.ts's claimChatServerUsername gets a real token back from the
 * server's own POST /connect, never from a plain form save. A no-op if
 * this server somehow already has one, so "permanent once set" holds
 * even if this ever gets called a second time some other way. */
export function setChatServerUsername(id: string, username: string): ChatServerConfig | null {
  const server = state.servers.find((s) => s.id === id);
  if (!server || server.username) return null;
  server.username = username;
  persist();
  return toPublic(server);
}

export function removeChatServer(id: string): void {
  state.servers = state.servers.filter((s) => s.id !== id);
  if (state.defaultServerId === id) {
    // Fall back to whatever's left rather than leaving every tab without
    // a default to follow.
    state.defaultServerId = state.servers[0]?.id ?? null;
  }
  persist();
}

export function setDefaultChatServer(id: string): void {
  if (!state.servers.some((s) => s.id === id)) return;
  state.defaultServerId = id;
  persist();
}
