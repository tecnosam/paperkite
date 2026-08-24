/**
 * Persisted MCP server configurations (`userData/mcpServers.json`). Same
 * treatment as main/agentStore.ts: a stdio server's env vars or an http
 * server's auth header are real credentials, so they're encrypted at rest
 * via Electron's `safeStorage` and never leave this module as plaintext -
 * `getMcpServers()` (what every renderer sees) strips them down to a
 * `hasSecrets` boolean, and only `getMcpServerForConnection()` (used
 * solely by main/mcp/client.ts to open a real connection) ever decrypts one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import type { McpServerConfig, AddMcpServerPayload, UpdateMcpServerPayload } from '../shared/types';

/** On-disk shape - never sent to a renderer as-is. */
interface StoredMcpServer {
  id: string;
  name: string;
  transport: McpServerConfig['transport'];
  command?: string;
  args?: string[];
  url?: string;
  createdAt: number;
  /** base64 - either safeStorage-encrypted JSON, or (rare fallback, see
   * agentStore.ts's identical trick) plaintext prefixed so it's never
   * mistaken for an encrypted blob. Shape: {env?} for stdio, {authHeader?} for http. */
  encryptedSecrets?: string;
}

interface StoredSecrets {
  env?: Record<string, string>;
  authHeader?: string;
}

const PLAINTEXT_PREFIX = 'plaintext:';

interface McpServersFile {
  servers: StoredMcpServer[];
}

function serversFilePath(): string {
  return path.join(app.getPath('userData'), 'mcpServers.json');
}

/**
 * Pre-configured servers a fresh install starts with - both verified
 * working end-to-end against the real MCP protocol (see the "Test
 * connection" flow), both officially maintained, and neither needs an API
 * key or touches anything beyond what's explicitly relevant:
 *  - Memory: an in-conversation knowledge graph the agent can read/write
 *    to remember things you've told it across messages - no external data.
 *  - Filesystem: scoped to this browser's own Downloads folder (not the
 *    user's home/Documents) - the same folder main/downloadStore.ts
 *    already saves real downloads and saved images into, so this grants
 *    the agent visibility into content the app itself put there, not a
 *    new intrusion into unrelated personal files.
 * Only used when there's no servers file yet - never re-applied over a
 * user's own edits, including deleting every server on purpose.
 */
function defaultServers(): StoredMcpServer[] {
  const now = Date.now();
  return [
    {
      id: randomUUID(),
      name: 'Memory',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      createdAt: now,
    },
    {
      id: randomUUID(),
      name: 'Downloads folder',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', app.getPath('downloads')],
      createdAt: now,
    },
  ];
}

function loadFromDisk(): StoredMcpServer[] | null {
  try {
    const raw = fs.readFileSync(serversFilePath(), 'utf-8');
    const data = JSON.parse(raw) as McpServersFile;
    return Array.isArray(data.servers) ? data.servers : [];
  } catch {
    return null; // no file yet, or it's corrupt
  }
}

const loadedFromDisk = loadFromDisk();
let servers = loadedFromDisk ?? defaultServers();
// A first-run seed only lives in memory until something else calls
// persist() - write it immediately so it survives a quit before that.
if (!loadedFromDisk) persist();

function persist(): void {
  const data: McpServersFile = { servers };
  fs.mkdirSync(path.dirname(serversFilePath()), { recursive: true });
  fs.writeFileSync(serversFilePath(), JSON.stringify(data), 'utf-8');
}

function encryptSecrets(secrets: StoredSecrets): string {
  const plain = JSON.stringify(secrets);
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64');
  }
  return PLAINTEXT_PREFIX + plain;
}

function decryptSecrets(stored: string): StoredSecrets {
  const plain = stored.startsWith(PLAINTEXT_PREFIX)
    ? stored.slice(PLAINTEXT_PREFIX.length)
    : safeStorage.decryptString(Buffer.from(stored, 'base64'));
  return JSON.parse(plain) as StoredSecrets;
}

/** Non-empty check for the "leave blank to keep existing" edit convention -
 * an empty object/string means "the user didn't touch this field". */
function hasSecretPayload(payload: { env?: Record<string, string>; authHeader?: string }): boolean {
  return !!payload.authHeader || (!!payload.env && Object.keys(payload.env).length > 0);
}

/** What every renderer is allowed to see - no secret material, ever. */
export function getMcpServers(): McpServerConfig[] {
  return servers.map(({ encryptedSecrets, ...rest }) => ({ ...rest, hasSecrets: !!encryptedSecrets }));
}

export function addMcpServer(payload: AddMcpServerPayload): McpServerConfig {
  const stored: StoredMcpServer = {
    id: randomUUID(),
    name: payload.name,
    transport: payload.transport,
    command: payload.command,
    args: payload.args,
    url: payload.url,
    createdAt: Date.now(),
    encryptedSecrets: hasSecretPayload(payload) ? encryptSecrets({ env: payload.env, authHeader: payload.authHeader }) : undefined,
  };
  servers = [...servers, stored];
  persist();
  const { encryptedSecrets, ...rest } = stored;
  return { ...rest, hasSecrets: !!encryptedSecrets };
}

export function updateMcpServer(payload: UpdateMcpServerPayload): McpServerConfig | null {
  const index = servers.findIndex((s) => s.id === payload.id);
  if (index === -1) return null;

  const existing = servers[index];
  const updated: StoredMcpServer = {
    ...existing,
    name: payload.name,
    command: payload.command,
    args: payload.args,
    url: payload.url,
    // Only replace the encrypted blob if the edit form actually supplied a
    // new secret - otherwise keep whatever's already on file.
    encryptedSecrets: hasSecretPayload(payload)
      ? encryptSecrets({ env: payload.env, authHeader: payload.authHeader })
      : existing.encryptedSecrets,
  };
  servers = [...servers.slice(0, index), updated, ...servers.slice(index + 1)];
  persist();
  const { encryptedSecrets, ...rest } = updated;
  return { ...rest, hasSecrets: !!encryptedSecrets };
}

export function removeMcpServer(id: string): void {
  servers = servers.filter((s) => s.id !== id);
  persist();
}

/** What main/mcp/client.ts needs to open a real connection - `config` is
 * the public-safe subset (no encrypted blob attached), `secrets` is the
 * decrypted env/authHeader, kept as a separate field so it's obvious at
 * every call site which part is sensitive. */
export interface McpConnectionInfo {
  config: McpServerConfig;
  secrets: StoredSecrets;
}

/** Internal only - never expose the return value of this over IPC. Used
 * exclusively by main/mcp/client.ts to open a real connection. */
export function getMcpServerForConnection(id: string): McpConnectionInfo | null {
  const stored = servers.find((s) => s.id === id);
  if (!stored) return null;
  const { encryptedSecrets, ...rest } = stored;
  return {
    config: { ...rest, hasSecrets: !!encryptedSecrets },
    secrets: encryptedSecrets ? decryptSecrets(encryptedSecrets) : {},
  };
}
