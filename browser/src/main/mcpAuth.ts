/**
 * Auth for Paperkite's own MCP server (main/mcp/builtinServer.ts): a
 * signed-JWT token store, mirroring the encrypted-credential pattern
 * already used by agentStore.ts/mcpStore.ts. Persisted to
 * `userData/mcpAuth.json`.
 *
 * Two kinds of token, one verification path:
 *  - The **internal** token (`jti: 'internal'`) is full-scope, never
 *    expires, and is what Paperkite's own agent chat uses to reach its
 *    own server (see main/mcp/client.ts) - auto-created on first use,
 *    never shown as revocable, never exposed as a value the user could
 *    have generated themselves.
 *  - **External** tokens are created from Settings with a chosen scope
 *    subset and TTL - the raw JWT is only ever returned once, at
 *    creation (see CreateMcpTokenResult) - only its metadata is
 *    persisted, so it can be listed and revoked but never re-displayed.
 *
 * Revocation works despite JWTs being self-contained: every token's
 * `jti` must still be present in the local store at verify time, so
 * deleting the record invalidates a still-validly-signed token immediately.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { randomUUID, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { McpScope, McpTokenInfo } from '../shared/types';

const PLAINTEXT_PREFIX = 'plaintext:';
const INTERNAL_JTI = 'internal';

export const ALL_MCP_SCOPES: McpScope[] = [
  'bookmarks:read',
  'bookmarks:write',
  'history:read',
  'history:write',
  'domains:read',
  'domains:write',
  'proxy:read',
  'tabs:read',
  'tabs:write',
];

interface StoredToken {
  jti: string;
  label: string;
  scopes: McpScope[];
  createdAt: number;
  expiresAt: number | null;
}

interface AuthFile {
  /** base64 - safeStorage-encrypted (or plaintext-prefixed fallback, see
   * agentStore.ts's identical trick) random HS256 signing secret. */
  encryptedSecret?: string;
  /** base64 - the internal token's own signed JWT, persisted (encrypted)
   * so the internal connection uses the same string across restarts
   * rather than silently invalidating itself on every launch. */
  encryptedInternalJwt?: string;
  internalTokenCreatedAt?: number;
  tokens: StoredToken[];
}

function authFilePath(): string {
  return path.join(app.getPath('userData'), 'mcpAuth.json');
}

function loadFromDisk(): AuthFile {
  try {
    const raw = fs.readFileSync(authFilePath(), 'utf-8');
    const data = JSON.parse(raw) as Partial<AuthFile>;
    return {
      encryptedSecret: data.encryptedSecret,
      encryptedInternalJwt: data.encryptedInternalJwt,
      internalTokenCreatedAt: data.internalTokenCreatedAt,
      tokens: Array.isArray(data.tokens) ? data.tokens : [],
    };
  } catch {
    return { tokens: [] }; // no file yet, or it's corrupt
  }
}

const store = loadFromDisk();

function persist(): void {
  fs.mkdirSync(path.dirname(authFilePath()), { recursive: true });
  fs.writeFileSync(authFilePath(), JSON.stringify(store), 'utf-8');
}

function encrypt(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64');
  }
  return PLAINTEXT_PREFIX + plain;
}

function decrypt(stored: string): string {
  if (stored.startsWith(PLAINTEXT_PREFIX)) {
    return stored.slice(PLAINTEXT_PREFIX.length);
  }
  return safeStorage.decryptString(Buffer.from(stored, 'base64'));
}

let cachedSecret: Uint8Array | null = null;

function getSigningSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  if (!store.encryptedSecret) {
    store.encryptedSecret = encrypt(randomBytes(32).toString('base64'));
    persist();
  }
  cachedSecret = new Uint8Array(Buffer.from(decrypt(store.encryptedSecret), 'base64'));
  return cachedSecret;
}

let cachedInternal: { jwt: string; createdAt: number } | null = null;

/** Creates (once, ever) or returns the internal token - safe to call
 * repeatedly, memoized both in-process and on disk. */
async function ensureInternalToken(): Promise<{ jwt: string; createdAt: number }> {
  if (cachedInternal) return cachedInternal;
  if (store.encryptedInternalJwt && store.internalTokenCreatedAt) {
    cachedInternal = { jwt: decrypt(store.encryptedInternalJwt), createdAt: store.internalTokenCreatedAt };
    return cachedInternal;
  }

  const createdAt = Date.now();
  const jwt = await new SignJWT({ scopes: ALL_MCP_SCOPES })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setJti(INTERNAL_JTI)
    .sign(getSigningSecret());

  store.encryptedInternalJwt = encrypt(jwt);
  store.internalTokenCreatedAt = createdAt;
  persist();
  cachedInternal = { jwt, createdAt };
  return cachedInternal;
}

/** Used exclusively by main/mcp/client.ts to authenticate Paperkite's own
 * agent-chat connection to its own server. */
export async function getInternalToken(): Promise<string> {
  return (await ensureInternalToken()).jwt;
}

/** Renderer-facing list - the internal token appears as a synthetic
 * leading, non-revocable entry so Settings can show it without a
 * separate code path (see McpTokenInfo.internal). */
export async function getTokens(): Promise<McpTokenInfo[]> {
  const internal = await ensureInternalToken();
  const internalInfo: McpTokenInfo = {
    jti: INTERNAL_JTI,
    label: 'Paperkite chat (internal)',
    scopes: ALL_MCP_SCOPES,
    createdAt: internal.createdAt,
    expiresAt: null,
    internal: true,
  };
  return [internalInfo, ...store.tokens.map((t): McpTokenInfo => ({ ...t, internal: false }))];
}

export async function createToken(label: string, scopes: McpScope[], ttlMs: number | null): Promise<{ token: McpTokenInfo; jwt: string }> {
  const jti = randomUUID();
  const now = Date.now();
  const expiresAt = ttlMs === null ? null : now + ttlMs;

  let builder = new SignJWT({ scopes }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setJti(jti);
  if (expiresAt !== null) builder = builder.setExpirationTime(Math.floor(expiresAt / 1000));
  const jwt = await builder.sign(getSigningSecret());

  const record: StoredToken = { jti, label, scopes, createdAt: now, expiresAt };
  store.tokens.push(record);
  persist();

  return { token: { ...record, internal: false }, jwt };
}

/** The internal token is never revocable - this is a no-op for it. */
export function revokeToken(jti: string): void {
  if (jti === INTERNAL_JTI) return;
  store.tokens = store.tokens.filter((t) => t.jti !== jti);
  persist();
}

/** Verifies a bearer token's signature and expiry, and (for external
 * tokens) that it hasn't been revoked - `null` for anything invalid,
 * expired, unsigned by us, or no longer on file. */
export async function verifyToken(jwt: string): Promise<{ scopes: McpScope[] } | null> {
  try {
    const { payload } = await jwtVerify(jwt, getSigningSecret());
    const jti = payload.jti;
    const scopes = payload.scopes;
    if (!jti || !Array.isArray(scopes)) return null;
    if (jti !== INTERNAL_JTI && !store.tokens.some((t) => t.jti === jti)) return null;
    return { scopes: scopes as McpScope[] };
  } catch {
    return null; // bad signature, malformed, or expired
  }
}
