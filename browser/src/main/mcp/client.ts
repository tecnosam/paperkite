/**
 * Owns live MCP server connections, keyed by server id. Tools are cached
 * per connection (re-fetched only on reconnect) and exposed to the LLM
 * provider adapters (main/agents/*) namespaced as `mcp__<alias>__<toolName>`
 * so two servers can never collide on a tool name - see parseNamespacedTool.
 * `<alias>` is a short `sN` counter, not the server's own (UUID) id: some
 * providers' function-calling implementations synthesize code internally
 * to invoke a tool (e.g. `default_api.mcp__...(...)`), and a UUID's
 * hyphens aren't valid there - Gemini in particular fails the whole turn
 * with `MALFORMED_FUNCTION_CALL` if the name contains one. Aliases are
 * assigned once per server, first-connect, and stay stable for the process's
 * lifetime.
 *
 * A server that fails to connect (bad command, unreachable URL, wrong
 * auth) never blocks the rest: getAllAvailableTools() just omits its
 * tools for that turn rather than failing the whole message send.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { getMcpServers, getMcpServerForConnection } from '../mcpStore';
import { getInternalToken } from '../mcpAuth';
import { getBuiltinServerStatus } from './builtinServer';
import type { AddMcpServerPayload, McpServerConfig, McpTestResult } from '../../shared/types';

/** Sentinel id for Paperkite's own MCP server (main/mcp/builtinServer.ts) -
 * not a real mcpStore entry (it can't be edited/deleted the normal way),
 * so it's connected to separately, via the internal token rather than a
 * stored credential. See ensureBuiltinConnected. */
const BUILTIN_SERVER_ID = '__builtin__';
const BUILTIN_SERVER_NAME = 'Paperkite';

export interface McpTool {
  serverId: string;
  serverName: string;
  /** Namespaced (`mcp__<serverId>__<toolName>`) - this, not the server's
   * own tool name, is what's sent to the LLM and what comes back in a
   * tool call. See parseNamespacedTool. */
  name: string;
  /** The server's own, un-namespaced tool name - for display only (e.g.
   * the "Working…" status), never sent to the LLM directly. */
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ConnectedServer {
  client: Client;
  tools: McpTool[];
}

interface DraftServer {
  transport: McpServerConfig['transport'];
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  authHeader?: string;
}

const NAMESPACE_PREFIX = 'mcp__';
const CLIENT_INFO = { name: 'paperkite', version: '1.0.0' };

const connections = new Map<string, ConnectedServer>();

let nextAlias = 0;
const aliasToServerId = new Map<string, string>();
const serverIdToAlias = new Map<string, string>();

function aliasFor(serverId: string): string {
  const existing = serverIdToAlias.get(serverId);
  if (existing) return existing;
  const alias = `s${nextAlias++}`;
  serverIdToAlias.set(serverId, alias);
  aliasToServerId.set(alias, serverId);
  return alias;
}

function buildTransport(draft: DraftServer): Transport {
  if (draft.transport === 'stdio') {
    if (!draft.command) throw new Error('No command configured for this server.');
    return new StdioClientTransport({ command: draft.command, args: draft.args, env: draft.env });
  }
  if (!draft.url) throw new Error('No URL configured for this server.');
  return new StreamableHTTPClientTransport(new URL(draft.url), {
    requestInit: draft.authHeader ? { headers: { Authorization: draft.authHeader } } : undefined,
  });
}

function namespaceToolName(serverId: string, toolName: string): string {
  return `${NAMESPACE_PREFIX}${aliasFor(serverId)}__${toolName}`;
}

/** Inverse of namespaceToolName. Aliases are `sN` - never contain `_`, so
 * the first `__` after the prefix is always the real boundary even if a
 * tool's own name happens to contain `__`. */
function parseNamespacedTool(name: string): { serverId: string; toolName: string } | null {
  if (!name.startsWith(NAMESPACE_PREFIX)) return null;
  const rest = name.slice(NAMESPACE_PREFIX.length);
  const sep = rest.indexOf('__');
  if (sep === -1) return null;
  const serverId = aliasToServerId.get(rest.slice(0, sep));
  if (!serverId) return null;
  return { serverId, toolName: rest.slice(sep + 2) };
}

/** Connects, lists tools, and caches the connection under `serverId` -
 * shared by ensureConnected (user-configured servers) and
 * ensureBuiltinConnected (Paperkite's own server). `null` on any failure -
 * a down/misconfigured server just contributes no tools this turn. */
async function connectAndCache(serverId: string, serverName: string, transport: Transport): Promise<McpTool[] | null> {
  try {
    const client = new Client(CLIENT_INFO);
    await client.connect(transport);
    const { tools } = await client.listTools();
    const namespaced = tools.map((tool): McpTool => ({
      serverId,
      serverName,
      name: namespaceToolName(serverId, tool.name),
      toolName: tool.name,
      description: tool.description ?? '',
      inputSchema: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    }));
    connections.set(serverId, { client, tools: namespaced });
    return namespaced;
  } catch {
    return null;
  }
}

/** Connects (or reuses an existing connection) and returns this server's
 * tools - `null` if the server doesn't exist or the connection failed. */
export async function ensureConnected(serverId: string): Promise<McpTool[] | null> {
  const existing = connections.get(serverId);
  if (existing) return existing.tools;

  const info = getMcpServerForConnection(serverId);
  if (!info) return null;

  return connectAndCache(
    serverId,
    info.config.name,
    buildTransport({ transport: info.config.transport, command: info.config.command, args: info.config.args, url: info.config.url, ...info.secrets }),
  );
}

/** Same idea as ensureConnected, but for Paperkite's own server - not an
 * mcpStore entry, so its connection info comes from main/mcp/builtinServer.ts's
 * live status and main/mcpAuth.ts's internal token instead of a stored config. */
async function ensureBuiltinConnected(): Promise<McpTool[] | null> {
  const existing = connections.get(BUILTIN_SERVER_ID);
  if (existing) return existing.tools;

  const status = getBuiltinServerStatus();
  if (!status.enabled || !status.url) return null;

  const token = await getInternalToken();
  return connectAndCache(BUILTIN_SERVER_ID, BUILTIN_SERVER_NAME, buildTransport({ transport: 'http', url: status.url, authHeader: `Bearer ${token}` }));
}

/** Every tool from every configured server plus Paperkite's own, connecting
 * to each in parallel - the set offered to the LLM on a given message. */
export async function getAllAvailableTools(): Promise<McpTool[]> {
  const configs = getMcpServers();
  const results = await Promise.all([ensureBuiltinConnected(), ...configs.map((c) => ensureConnected(c.id))]);
  return results.filter((r): r is McpTool[] => r !== null).flat();
}

/** Executes a namespaced tool call and returns its result as plain text,
 * ready to feed straight back into the LLM as a tool-result turn. Never
 * throws - a failure comes back as descriptive text so the model can see
 * and react to it, same as any other tool result. */
export async function callTool(namespacedName: string, args: Record<string, unknown>): Promise<string> {
  const parsed = parseNamespacedTool(namespacedName);
  if (!parsed) return `Error: unrecognized tool "${namespacedName}".`;

  const connection = connections.get(parsed.serverId);
  if (!connection) return `Error: the server for "${namespacedName}" isn't connected.`;

  try {
    const result = (await connection.client.callTool({ name: parsed.toolName, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (result.content ?? [])
      .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : `[${block.type} content omitted]`))
      .join('\n');
    return text || 'Tool completed with no output.';
  } catch (err) {
    return `Error calling tool: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Powers Settings' "Test connection" button - a fresh, uncached
 * connection attempt against a draft (possibly unsaved) config. */
export async function testConnection(draft: AddMcpServerPayload): Promise<McpTestResult> {
  let client: Client | null = null;
  try {
    client = new Client(CLIENT_INFO);
    await client.connect(buildTransport(draft));
    const { tools } = await client.listTools();
    return { ok: true, toolCount: tools.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Connection failed.' };
  } finally {
    try {
      await client?.close();
    } catch {
      // Already dead or never fully connected - nothing to clean up.
    }
  }
}

export async function disconnectServer(serverId: string): Promise<void> {
  const existing = connections.get(serverId);
  connections.delete(serverId);
  if (!existing) return;
  try {
    await existing.client.close();
  } catch {
    // Already dead - nothing to clean up.
  }
}

export async function disconnectAll(): Promise<void> {
  await Promise.all([...connections.keys()].map((id) => disconnectServer(id)));
}
