/**
 * Paperkite's own MCP server - the reverse of main/mcp/client.ts. Exposes
 * bookmarks, history, trusted domains, read-only proxy status, and tab
 * control as MCP tools over a local HTTP endpoint, so both Paperkite's
 * own agent chat (via an auto-generated internal token, see
 * main/mcpAuth.ts) and genuinely external MCP clients (Claude Desktop,
 * named explicitly in the request this shipped for) can drive the browser.
 *
 * Bound to 127.0.0.1 only - never reachable from the network. Every
 * request still needs a valid `Authorization: Bearer <jwt>` regardless of
 * origin (see handleHttpRequest) - that's the real defense; the Host
 * header check below is just cheap defense-in-depth against DNS rebinding,
 * implemented here rather than via the transport's now-deprecated
 * allowedHosts/allowedOrigins options.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpScope, BuiltinMcpServerStatus, DomainTrustLists } from '../../shared/types';
import { IPC } from '../../shared/ipcChannels';
import { verifyToken } from '../mcpAuth';
import { resolveAddressBarInput } from '../addressBar';
import {
  getBookmarks,
  getFolders,
  isBookmarked,
  toggleBookmark,
  removeBookmark,
  renameBookmark,
  moveBookmark,
  createFolder,
  renameFolder,
  deleteFolder,
  findOrCreateFolderByName,
} from '../bookmarkStore';
import { getHistoryPage, deleteEntry, clearHistory } from '../historyStore';
import { getDomainTrustLists, setDomainTrustLists } from '../domainTrustStore';
import { loadProxySettings } from '../proxyStore';
import type { WindowManager } from '../windowManager';

const DEFAULT_PORT = 7825;
const MAX_PORT_ATTEMPTS = 10;
const MCP_PATH = '/mcp';

function toolResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

function deniedResult(scope: McpScope): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: `Permission denied: this token doesn't have the "${scope}" scope.` }] };
}

/** Every tool checks its own required scope as its first line - `extra`
 * carries whatever verifyToken() found for this request's bearer token
 * (see handleHttpRequest), threaded through automatically by the SDK. */
function hasScope(extra: { authInfo?: AuthInfo }, scope: McpScope): boolean {
  return (extra.authInfo?.scopes as McpScope[] | undefined)?.includes(scope) ?? false;
}

/** Bookmarks and domain trust are pushed to the live UI on every mutation
 * (see ipc.ts's TOGGLE_BOOKMARK/SET_DOMAIN_TRUST handlers) - these tools
 * bypass ipc.ts, so they replicate the same broadcast here. History has no
 * such push channel even from the normal UI-driven path (Settings re-fetches
 * a page on demand instead), so history tools don't need one either. */
function broadcastBookmarks(wm: WindowManager): void {
  wm.chromeView.webContents.send(IPC.BOOKMARKS_UPDATED, getBookmarks());
}

function broadcastFolders(wm: WindowManager): void {
  wm.chromeView.webContents.send(IPC.BOOKMARK_FOLDERS_UPDATED, getFolders());
}

function broadcastDomains(wm: WindowManager, lists: DomainTrustLists): void {
  wm.chromeView.webContents.send(IPC.DOMAIN_TRUST, lists);
  wm.chatView.webContents.send(IPC.DOMAIN_TRUST, lists);
}

function registerTools(server: McpServer, wm: WindowManager): void {
  // ---------- Bookmarks ----------
  server.registerTool(
    'list_bookmarks',
    { description: 'List every bookmark folder and every bookmarked page, with each bookmark\'s folderId (null = unfiled).' },
    (extra) => {
      if (!hasScope(extra, 'bookmarks:read')) return deniedResult('bookmarks:read');
      return toolResult(JSON.stringify({ folders: getFolders(), bookmarks: getBookmarks() }));
    },
  );

  server.registerTool(
    'add_bookmark',
    {
      description: 'Bookmark a page, optionally filing it into a folder by name (created at the root if it doesn\'t exist yet).',
      inputSchema: {
        url: z.string().describe('The page URL'),
        title: z.string().describe('A title for the bookmark'),
        folder: z.string().optional().describe('Folder name to file it under - created at the root if not found. Omit to leave unfiled.'),
      },
    },
    (args, extra) => {
      if (!hasScope(extra, 'bookmarks:write')) return deniedResult('bookmarks:write');
      if (isBookmarked(args.url)) return toolResult(`"${args.url}" is already bookmarked.`);
      toggleBookmark(args.url, args.title);
      let folderNote = '';
      if (args.folder) {
        const folder = findOrCreateFolderByName(args.folder, null);
        const added = getBookmarks().find((b) => b.url === args.url);
        if (added) moveBookmark(added.id, folder.id);
        folderNote = ` in "${folder.name}"`;
      }
      broadcastFolders(wm);
      broadcastBookmarks(wm);
      return toolResult(`Bookmarked "${args.title}"${folderNote}.`);
    },
  );

  server.registerTool(
    'remove_bookmark',
    { description: 'Remove a bookmark by id (see list_bookmarks for ids).', inputSchema: { id: z.string() } },
    (args, extra) => {
      if (!hasScope(extra, 'bookmarks:write')) return deniedResult('bookmarks:write');
      removeBookmark(args.id);
      broadcastBookmarks(wm);
      return toolResult(`Removed bookmark ${args.id}.`);
    },
  );

  server.registerTool(
    'rename_bookmark',
    { description: 'Rename a bookmark by id.', inputSchema: { id: z.string(), title: z.string() } },
    (args, extra) => {
      if (!hasScope(extra, 'bookmarks:write')) return deniedResult('bookmarks:write');
      renameBookmark(args.id, args.title);
      broadcastBookmarks(wm);
      return toolResult(`Renamed bookmark ${args.id} to "${args.title}".`);
    },
  );

  server.registerTool(
    'move_bookmark',
    {
      description: 'File a bookmark into a different folder by id (see list_bookmarks for ids), or back to unfiled.',
      inputSchema: { id: z.string(), folderId: z.string().nullable().describe('Target folder id, or null for unfiled.') },
    },
    (args, extra) => {
      if (!hasScope(extra, 'bookmarks:write')) return deniedResult('bookmarks:write');
      moveBookmark(args.id, args.folderId);
      broadcastBookmarks(wm);
      return toolResult(args.folderId ? `Moved bookmark ${args.id} to folder ${args.folderId}.` : `Moved bookmark ${args.id} to unfiled.`);
    },
  );

  server.registerTool(
    'create_bookmark_folder',
    {
      description: 'Create a bookmark folder, optionally nested under a named parent folder (created at the root if it doesn\'t exist).',
      inputSchema: { name: z.string(), parentFolder: z.string().optional().describe('Name of the parent folder. Omit for a root-level folder.') },
    },
    (args, extra) => {
      if (!hasScope(extra, 'bookmarks:write')) return deniedResult('bookmarks:write');
      const parentId = args.parentFolder ? findOrCreateFolderByName(args.parentFolder, null).id : null;
      const folder = createFolder(args.name, parentId);
      broadcastFolders(wm);
      return toolResult(`Created folder "${folder.name}" (id: ${folder.id}).`);
    },
  );

  server.registerTool(
    'rename_bookmark_folder',
    { description: 'Rename a bookmark folder by id (see list_bookmarks for ids).', inputSchema: { id: z.string(), name: z.string() } },
    (args, extra) => {
      if (!hasScope(extra, 'bookmarks:write')) return deniedResult('bookmarks:write');
      renameFolder(args.id, args.name);
      broadcastFolders(wm);
      return toolResult(`Renamed folder ${args.id} to "${args.name}".`);
    },
  );

  server.registerTool(
    'delete_bookmark_folder',
    {
      description: 'Delete a bookmark folder by id. This also deletes every subfolder and every bookmark filed inside it, recursively - same as deleting it from Settings.',
      inputSchema: { id: z.string() },
    },
    (args, extra) => {
      if (!hasScope(extra, 'bookmarks:write')) return deniedResult('bookmarks:write');
      deleteFolder(args.id);
      broadcastFolders(wm);
      broadcastBookmarks(wm);
      return toolResult(`Deleted folder ${args.id} and everything in it.`);
    },
  );

  // ---------- History ----------
  server.registerTool(
    'search_history',
    {
      description: 'Search browsing history by title/URL substring, newest first. Omit query to list recent history.',
      // `.positive()` emits JSON Schema's `exclusiveMinimum`, which Gemini's
      // function-calling schema subset rejects outright ("Unknown name
      // 'exclusiveMinimum'") - `.min(1)` says the same thing (a positive
      // integer) via the plain `minimum` keyword every provider supports.
      inputSchema: { query: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
    },
    (args, extra) => {
      if (!hasScope(extra, 'history:read')) return deniedResult('history:read');
      const { entries } = getHistoryPage(0, args.limit ?? 50, args.query ?? '');
      return toolResult(JSON.stringify(entries));
    },
  );

  server.registerTool(
    'delete_history_entry',
    { description: 'Delete one history entry by id (see search_history for ids).', inputSchema: { id: z.string() } },
    (args, extra) => {
      if (!hasScope(extra, 'history:write')) return deniedResult('history:write');
      deleteEntry(args.id);
      return toolResult(`Deleted history entry ${args.id}.`);
    },
  );

  server.registerTool('clear_history', { description: 'Clear all browsing history.' }, (extra) => {
    if (!hasScope(extra, 'history:write')) return deniedResult('history:write');
    clearHistory();
    return toolResult('History cleared.');
  });

  // ---------- Trusted domains ----------
  server.registerTool('list_trusted_domains', { description: 'List trusted and untrusted domains for chat links.' }, (extra) => {
    if (!hasScope(extra, 'domains:read')) return deniedResult('domains:read');
    return toolResult(JSON.stringify(getDomainTrustLists()));
  });

  server.registerTool(
    'add_trusted_domain',
    { description: 'Mark a domain as trusted (removes it from untrusted if present).', inputSchema: { domain: z.string() } },
    (args, extra) => {
      if (!hasScope(extra, 'domains:write')) return deniedResult('domains:write');
      const lists = getDomainTrustLists();
      const next = { trusted: [...new Set([...lists.trusted, args.domain])], untrusted: lists.untrusted.filter((d) => d !== args.domain) };
      setDomainTrustLists(next);
      broadcastDomains(wm, next);
      return toolResult(`"${args.domain}" marked trusted.`);
    },
  );

  server.registerTool(
    'add_untrusted_domain',
    { description: 'Mark a domain as untrusted (removes it from trusted if present).', inputSchema: { domain: z.string() } },
    (args, extra) => {
      if (!hasScope(extra, 'domains:write')) return deniedResult('domains:write');
      const lists = getDomainTrustLists();
      const next = { untrusted: [...new Set([...lists.untrusted, args.domain])], trusted: lists.trusted.filter((d) => d !== args.domain) };
      setDomainTrustLists(next);
      broadcastDomains(wm, next);
      return toolResult(`"${args.domain}" marked untrusted.`);
    },
  );

  server.registerTool(
    'remove_domain',
    { description: 'Remove a domain from both the trusted and untrusted lists.', inputSchema: { domain: z.string() } },
    (args, extra) => {
      if (!hasScope(extra, 'domains:write')) return deniedResult('domains:write');
      const lists = getDomainTrustLists();
      const next = { trusted: lists.trusted.filter((d) => d !== args.domain), untrusted: lists.untrusted.filter((d) => d !== args.domain) };
      setDomainTrustLists(next);
      broadcastDomains(wm, next);
      return toolResult(`"${args.domain}" removed from both lists.`);
    },
  );

  // ---------- Proxy (read-only, deliberately no write tool) ----------
  server.registerTool('get_proxy_status', { description: 'Get the current proxy configuration (read-only - this server never changes it).' }, (extra) => {
    if (!hasScope(extra, 'proxy:read')) return deniedResult('proxy:read');
    return toolResult(JSON.stringify(loadProxySettings()));
  });

  // ---------- Tabs ----------
  server.registerTool('list_tabs', { description: 'List every open tab and which one is active.' }, (extra) => {
    if (!hasScope(extra, 'tabs:read')) return deniedResult('tabs:read');
    return toolResult(JSON.stringify(wm.tabs.getTabsPayload()));
  });

  server.registerTool(
    'open_tab',
    {
      description: 'Open a new tab, either navigating to a URL or searching (same as typing into the address bar).',
      inputSchema: { query: z.string().describe('A URL, or search terms') },
    },
    (args, extra) => {
      if (!hasScope(extra, 'tabs:write')) return deniedResult('tabs:write');
      const url = resolveAddressBarInput(args.query);
      const id = wm.tabs.newTab(url);
      return toolResult(`Opened a new tab (id: ${id}) at ${url}`);
    },
  );

  server.registerTool('close_tab', { description: 'Close a tab by id (see list_tabs for ids).', inputSchema: { id: z.string() } }, (args, extra) => {
    if (!hasScope(extra, 'tabs:write')) return deniedResult('tabs:write');
    wm.tabs.closeTab(args.id);
    return toolResult(`Closed tab ${args.id}.`);
  });

  server.registerTool('switch_tab', { description: 'Switch to a tab by id (see list_tabs for ids).', inputSchema: { id: z.string() } }, (args, extra) => {
    if (!hasScope(extra, 'tabs:write')) return deniedResult('tabs:write');
    wm.tabs.switchTab(args.id);
    return toolResult(`Switched to tab ${args.id}.`);
  });
}

let httpServer: http.Server | null = null;
let currentWm: WindowManager | null = null;
let currentPort: number | null = null;
const sessionTransports = new Map<string, StreamableHTTPServerTransport>();

async function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.url !== MCP_PATH) {
    res.writeHead(404).end();
    return;
  }

  const host = req.headers.host ?? '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
    return;
  }

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const verified = token ? await verifyToken(token) : null;
  if (!token || !verified) {
    res.writeHead(401, { 'content-type': 'text/plain' }).end('Unauthorized - missing or invalid bearer token.');
    return;
  }

  const reqWithAuth = req as http.IncomingMessage & { auth?: AuthInfo };
  reqWithAuth.auth = { token, clientId: 'external', scopes: verified.scopes };

  const sessionIdHeader = req.headers['mcp-session-id'];
  const sessionId = typeof sessionIdHeader === 'string' ? sessionIdHeader : undefined;
  const existing = sessionId ? sessionTransports.get(sessionId) : undefined;

  if (existing) {
    await existing.handleRequest(reqWithAuth, res);
    return;
  }

  if (!currentWm) throw new Error('Built-in MCP server not initialized.');
  const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      sessionTransports.set(sid, transport);
    },
    onsessionclosed: (sid) => {
      sessionTransports.delete(sid);
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) sessionTransports.delete(transport.sessionId);
  };
  // A `Server`/`McpServer` instance only ever supports one connected
  // transport at a time ("Already connected to a transport..." if you try
  // to reuse it) - each new HTTP session needs its own instance, per the
  // SDK's own multi-session guidance. Registration is cheap (just closures
  // over the shared stores/wm), so there's no real cost to doing it fresh
  // per session instead of trying to share one across every client.
  const session = new McpServer({ name: 'paperkite', version: '1.0.0' });
  registerTools(session, currentWm);
  await session.connect(transport);
  await transport.handleRequest(reqWithAuth, res);
}

function enabledPrefPath(): string {
  return path.join(app.getPath('userData'), 'mcpServerEnabled.json');
}

/** On by default, per the approved design - only off if the user has
 * explicitly toggled it off before. */
export function loadBuiltinMcpEnabledPreference(): boolean {
  try {
    const raw = fs.readFileSync(enabledPrefPath(), 'utf-8');
    return (JSON.parse(raw) as { enabled: boolean }).enabled;
  } catch {
    return true;
  }
}

function saveBuiltinMcpEnabledPreference(enabled: boolean): void {
  fs.mkdirSync(path.dirname(enabledPrefPath()), { recursive: true });
  fs.writeFileSync(enabledPrefPath(), JSON.stringify({ enabled }), 'utf-8');
}

export async function startBuiltinMcpServer(wm: WindowManager): Promise<void> {
  if (httpServer) return;

  currentWm = wm;

  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const port = DEFAULT_PORT + attempt;
    try {
      await new Promise<void>((resolve, reject) => {
        const server = http.createServer((req, res) => {
          void handleHttpRequest(req, res).catch((err: unknown) => {
            console.error('[builtinServer] request failed:', err);
            if (!res.headersSent) res.writeHead(500).end('Internal error');
          });
        });
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          httpServer = server;
          currentPort = port;
          resolve();
        });
      });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      // Port taken - try the next one.
    }
  }
  throw new Error('Could not find a free port for the built-in MCP server.');
}

export async function stopBuiltinMcpServer(): Promise<void> {
  const server = httpServer;
  httpServer = null;
  currentPort = null;
  currentWm = null;
  const sessions = [...sessionTransports.values()];
  sessionTransports.clear();
  await Promise.all(
    sessions.map((transport) =>
      transport.close().catch(() => {
        // Already closing/closed - nothing to clean up.
      }),
    ),
  );
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
}

export async function setBuiltinMcpServerEnabled(wm: WindowManager, enabled: boolean): Promise<void> {
  saveBuiltinMcpEnabledPreference(enabled);
  if (enabled) await startBuiltinMcpServer(wm);
  else await stopBuiltinMcpServer();
}

export function getBuiltinServerStatus(): BuiltinMcpServerStatus {
  return {
    enabled: httpServer !== null,
    port: currentPort,
    url: currentPort !== null ? `http://127.0.0.1:${currentPort}${MCP_PATH}` : null,
  };
}
