/**
 * Persisted AI agent configurations (`userData/agents.json`). Unlike every
 * other store in this app, this one holds real, billable credentials, not
 * just preferences - API keys are encrypted at rest via Electron's
 * `safeStorage` (OS keychain-backed) and, critically, never leave this
 * module as plaintext: `getAgentConfigs()` (what every renderer sees)
 * strips the key down to a `hasCredential` boolean, and only
 * `getDecryptedKey()` (used solely by the provider adapters in
 * main/agents/) ever decrypts one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import type { AgentConfig, AddAgentPayload, UpdateAgentPayload } from '../shared/types';

/** On-disk shape - never sent to a renderer as-is. */
interface StoredAgent {
  id: string;
  provider: AgentConfig['provider'];
  name: string;
  model: string;
  baseUrl?: string;
  systemPrompt?: string;
  createdAt: number;
  /** base64 - either safeStorage-encrypted, or (rare fallback, see below)
   * plaintext prefixed so it's never mistaken for an encrypted blob. */
  encryptedApiKey?: string;
}

const PLAINTEXT_PREFIX = 'plaintext:';

interface AgentsFile {
  agents: StoredAgent[];
}

function agentsFilePath(): string {
  return path.join(app.getPath('userData'), 'agents.json');
}

function loadFromDisk(): StoredAgent[] {
  try {
    const raw = fs.readFileSync(agentsFilePath(), 'utf-8');
    const data = JSON.parse(raw) as AgentsFile;
    return Array.isArray(data.agents) ? data.agents : [];
  } catch {
    return []; // no agents file yet, or it's corrupt
  }
}

let agents = loadFromDisk();

function persist(): void {
  const data: AgentsFile = { agents };
  fs.mkdirSync(path.dirname(agentsFilePath()), { recursive: true });
  fs.writeFileSync(agentsFilePath(), JSON.stringify(data), 'utf-8');
}

/** Some Linux setups have no keyring backend for safeStorage to use -
 * degrade to a marked plaintext value there rather than refusing to save
 * the agent at all. Encrypted on every platform that actually matters
 * (macOS Keychain, Windows DPAPI, and most Linux desktops). */
function encryptKey(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64');
  }
  return PLAINTEXT_PREFIX + plain;
}

function decryptKey(stored: string): string {
  if (stored.startsWith(PLAINTEXT_PREFIX)) {
    return stored.slice(PLAINTEXT_PREFIX.length);
  }
  return safeStorage.decryptString(Buffer.from(stored, 'base64'));
}

/** What every renderer is allowed to see - no key material, ever. */
export function getAgentConfigs(): AgentConfig[] {
  return agents.map(({ encryptedApiKey, ...rest }) => ({ ...rest, hasCredential: !!encryptedApiKey }));
}

export function addAgent(payload: AddAgentPayload): void {
  const stored: StoredAgent = {
    id: randomUUID(),
    provider: payload.provider,
    name: payload.name,
    model: payload.model,
    baseUrl: payload.baseUrl,
    systemPrompt: payload.systemPrompt,
    createdAt: Date.now(),
    encryptedApiKey: payload.apiKey ? encryptKey(payload.apiKey) : undefined,
  };
  agents = [...agents, stored];
  persist();
}

/** `apiKey` only overwrites the stored credential if non-empty - leaving
 * it blank in the edit form keeps whatever key is already on file, the
 * same convention main/mcpStore.ts's updateMcpServer uses for secrets. */
export function updateAgent(payload: UpdateAgentPayload): AgentConfig | null {
  const index = agents.findIndex((a) => a.id === payload.id);
  if (index === -1) return null;

  const existing = agents[index];
  const updated: StoredAgent = {
    ...existing,
    name: payload.name,
    model: payload.model,
    baseUrl: payload.baseUrl,
    systemPrompt: payload.systemPrompt,
    encryptedApiKey: payload.apiKey ? encryptKey(payload.apiKey) : existing.encryptedApiKey,
  };
  agents = [...agents.slice(0, index), updated, ...agents.slice(index + 1)];
  persist();
  const { encryptedApiKey, ...rest } = updated;
  return { ...rest, hasCredential: !!encryptedApiKey };
}

export function removeAgent(id: string): void {
  agents = agents.filter((a) => a.id !== id);
  persist();
}

/** Internal only - never expose the return value of this over IPC. Used
 * exclusively by main/agents/index.ts to build an outbound request. */
export function getAgentForRequest(id: string): { config: StoredAgent; apiKey: string | null } | null {
  const config = agents.find((a) => a.id === id);
  if (!config) return null;
  return { config, apiKey: config.encryptedApiKey ? decryptKey(config.encryptedApiKey) : null };
}
