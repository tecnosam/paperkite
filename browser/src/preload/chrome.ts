/**
 * Preload script for the chrome view. Runs with Node access in an
 * isolated context; the only thing exposed to the page is `window.paperkite`,
 * a narrow, typed surface over the IPC contract in shared/ipcChannels.ts.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/ipcChannels';
import type {
  TabsUpdatedPayload,
  NavState,
  SafetySettings,
  ThemePayload,
  ThemeSource,
  BookmarkEntry,
  BookmarkFolder,
  ToggleBookmarkPayload,
  RenameBookmarkPayload,
  MoveBookmarkPayload,
  CreateBookmarkFolderPayload,
  RenameBookmarkFolderPayload,
  BookmarkImportResult,
  DataUsageSummary,
  SubtitleSettings,
  PageTranslateSettings,
  PageTranslateStatusPayload,
  WhisperConfig,
  WhisperStatus,
  DomainTrustLists,
  ProxySettings,
  FindInPagePayload,
  FindResultPayload,
  DownloadRecord,
  HistoryPageRequest,
  HistoryPageResult,
  PermissionRequestPayload,
  PermissionResponsePayload,
  SitePermissions,
  SetSitePermissionPayload,
  AgentConfig,
  AddAgentPayload,
  UpdateAgentPayload,
  McpServerConfig,
  AddMcpServerPayload,
  UpdateMcpServerPayload,
  McpTestResult,
  BuiltinMcpServerStatus,
  McpTokenInfo,
  CreateMcpTokenPayload,
  CreateMcpTokenResult,
  ChatServersPayload,
  AddChatServerPayload,
  UpdateChatServerPayload,
  ClaimChatServerUsernamePayload,
  ChatServerUsernameClaimResult,
} from '../shared/types';

/** Wraps ipcRenderer.on so callers get a plain unsubscribe function back. */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  // commands
  /** `url` opens that address directly instead of the new-tab page - used
   * by History/Bookmarks rows in Settings to open in a new tab. */
  newTab: (url?: string) => ipcRenderer.send(IPC.NEW_TAB, url),
  closeTab: (id: string) => ipcRenderer.send(IPC.CLOSE_TAB, id),
  switchTab: (id: string) => ipcRenderer.send(IPC.SWITCH_TAB, id),
  navigate: (url: string) => ipcRenderer.send(IPC.NAVIGATE, url),
  goBack: () => ipcRenderer.send(IPC.GO_BACK),
  goForward: () => ipcRenderer.send(IPC.GO_FORWARD),
  reload: () => ipcRenderer.send(IPC.RELOAD),
  toggleChat: () => ipcRenderer.send(IPC.TOGGLE_CHAT),
  setSafetySettings: (settings: SafetySettings) => ipcRenderer.send(IPC.SET_SAFETY_SETTINGS, settings),
  setTheme: (source: ThemeSource) => ipcRenderer.send(IPC.SET_THEME, source),
  /** Local (non-blocking) modals like Settings need main to grow the
   * chrome view to full-window size first - it's normally clipped to
   * the toolbar strip. Call with `false` when the modal closes. */
  setOverlayOpen: (open: boolean) => ipcRenderer.send(IPC.SET_CHROME_OVERLAY, open),
  setToolbarPopoverOpen: (open: boolean) => ipcRenderer.send(IPC.SET_TOOLBAR_POPOVER_OPEN, open),
  /** Tell main the UI has mounted and is ready to receive initial state. */
  ready: () => ipcRenderer.send(IPC.CHROME_READY),
  deleteHistoryEntry: (id: string) => ipcRenderer.send(IPC.DELETE_HISTORY_ENTRY, id),
  clearHistory: () => ipcRenderer.send(IPC.CLEAR_HISTORY),
  requestHistoryPage: (req: HistoryPageRequest) => ipcRenderer.send(IPC.REQUEST_HISTORY_PAGE, req),
  toggleBookmark: (payload: ToggleBookmarkPayload) => ipcRenderer.send(IPC.TOGGLE_BOOKMARK, payload),
  deleteBookmark: (id: string) => ipcRenderer.send(IPC.DELETE_BOOKMARK, id),
  renameBookmark: (payload: RenameBookmarkPayload) => ipcRenderer.send(IPC.RENAME_BOOKMARK, payload),
  moveBookmark: (payload: MoveBookmarkPayload) => ipcRenderer.send(IPC.MOVE_BOOKMARK, payload),
  createBookmarkFolder: (payload: CreateBookmarkFolderPayload) => ipcRenderer.send(IPC.CREATE_BOOKMARK_FOLDER, payload),
  renameBookmarkFolder: (payload: RenameBookmarkFolderPayload) => ipcRenderer.send(IPC.RENAME_BOOKMARK_FOLDER, payload),
  deleteBookmarkFolder: (id: string) => ipcRenderer.send(IPC.DELETE_BOOKMARK_FOLDER, id),
  /** Opens a native file picker for a browser bookmark export - result
   * comes back on onBookmarkImportResult. */
  importBookmarks: () => ipcRenderer.send(IPC.IMPORT_BOOKMARKS),
  clearAllBookmarks: () => ipcRenderer.send(IPC.CLEAR_ALL_BOOKMARKS),
  clearAllAgentThreads: () => ipcRenderer.send(IPC.CLEAR_ALL_AGENT_THREADS),
  requestDataUsageSummary: () => ipcRenderer.send(IPC.REQUEST_DATA_USAGE_SUMMARY),
  setSubtitleSettings: (settings: SubtitleSettings) => ipcRenderer.send(IPC.SET_SUBTITLE_SETTINGS, settings),
  setPageTranslateSettings: (settings: PageTranslateSettings) => ipcRenderer.send(IPC.SET_PAGE_TRANSLATE_SETTINGS, settings),
  /** One WAV-encoded chunk of captured tab audio - see
   * renderer/chrome/audioCapture.ts. `bytes` is sent as a plain Uint8Array;
   * Electron's IPC structured-clones it, no manual encoding needed. */
  sendAudioChunk: (bytes: Uint8Array) => ipcRenderer.send(IPC.AUDIO_CHUNK, bytes),
  requestWhisperStatus: () => ipcRenderer.send(IPC.REQUEST_WHISPER_STATUS),
  setWhisperConfig: (config: WhisperConfig) => ipcRenderer.send(IPC.SET_WHISPER_CONFIG, config),
  pickWhisperModel: () => ipcRenderer.send(IPC.PICK_WHISPER_MODEL),
  pickWhisperTranslateModel: () => ipcRenderer.send(IPC.PICK_WHISPER_TRANSLATE_MODEL),
  setDomainTrust: (lists: DomainTrustLists) => ipcRenderer.send(IPC.SET_DOMAIN_TRUST, lists),
  setProxySettings: (settings: ProxySettings) => ipcRenderer.send(IPC.SET_PROXY_SETTINGS, settings),
  findInPage: (payload: FindInPagePayload) => ipcRenderer.send(IPC.FIND_IN_PAGE, payload),
  closeFindBar: () => ipcRenderer.send(IPC.CLOSE_FIND_BAR),
  cancelDownload: (id: string) => ipcRenderer.send(IPC.CANCEL_DOWNLOAD, id),
  openDownload: (id: string) => ipcRenderer.send(IPC.OPEN_DOWNLOAD, id),
  showDownloadInFolder: (id: string) => ipcRenderer.send(IPC.SHOW_DOWNLOAD_IN_FOLDER, id),
  clearDownloads: () => ipcRenderer.send(IPC.CLEAR_DOWNLOADS),
  respondToPermission: (payload: PermissionResponsePayload) => ipcRenderer.send(IPC.PERMISSION_RESPONSE, payload),
  requestSitePermissions: () => ipcRenderer.send(IPC.REQUEST_SITE_PERMISSIONS),
  setSitePermission: (payload: SetSitePermissionPayload) => ipcRenderer.send(IPC.SET_SITE_PERMISSION, payload),
  resetSitePermissions: (origin: string) => ipcRenderer.send(IPC.RESET_SITE_PERMISSIONS, origin),
  requestAgents: () => ipcRenderer.send(IPC.REQUEST_AGENTS),
  createAgent: (payload: AddAgentPayload) => ipcRenderer.send(IPC.CREATE_AGENT, payload),
  updateAgent: (payload: UpdateAgentPayload) => ipcRenderer.send(IPC.UPDATE_AGENT, payload),
  deleteAgent: (id: string) => ipcRenderer.send(IPC.DELETE_AGENT, id),
  requestMcpServers: () => ipcRenderer.send(IPC.REQUEST_MCP_SERVERS),
  createMcpServer: (payload: AddMcpServerPayload) => ipcRenderer.send(IPC.CREATE_MCP_SERVER, payload),
  updateMcpServer: (payload: UpdateMcpServerPayload) => ipcRenderer.send(IPC.UPDATE_MCP_SERVER, payload),
  deleteMcpServer: (id: string) => ipcRenderer.send(IPC.DELETE_MCP_SERVER, id),
  /** Fresh, uncached connection attempt against a draft config - result
   * comes back on onMcpServerTestResult. */
  testMcpServer: (payload: AddMcpServerPayload) => ipcRenderer.send(IPC.TEST_MCP_SERVER, payload),
  requestBuiltinMcpStatus: () => ipcRenderer.send(IPC.REQUEST_BUILTIN_MCP_STATUS),
  setBuiltinMcpEnabled: (enabled: boolean) => ipcRenderer.send(IPC.SET_BUILTIN_MCP_ENABLED, enabled),
  requestMcpTokens: () => ipcRenderer.send(IPC.REQUEST_MCP_TOKENS),
  /** The signed JWT comes back exactly once, on onMcpTokenCreated - never
   * persisted, never retrievable again after that. */
  createMcpToken: (payload: CreateMcpTokenPayload) => ipcRenderer.send(IPC.CREATE_MCP_TOKEN, payload),
  revokeMcpToken: (jti: string) => ipcRenderer.send(IPC.REVOKE_MCP_TOKEN, jti),
  requestChatServers: () => ipcRenderer.send(IPC.REQUEST_CHAT_SERVERS),
  createChatServer: (payload: AddChatServerPayload) => ipcRenderer.send(IPC.CREATE_CHAT_SERVER, payload),
  updateChatServer: (payload: UpdateChatServerPayload) => ipcRenderer.send(IPC.UPDATE_CHAT_SERVER, payload),
  deleteChatServer: (id: string) => ipcRenderer.send(IPC.DELETE_CHAT_SERVER, id),
  setDefaultChatServer: (id: string) => ipcRenderer.send(IPC.SET_DEFAULT_CHAT_SERVER, id),
  claimChatServerUsername: (payload: ClaimChatServerUsernamePayload) => ipcRenderer.send(IPC.CLAIM_CHAT_SERVER_USERNAME, payload),

  // events
  onTabsUpdated: (cb: (payload: TabsUpdatedPayload) => void) => subscribe(IPC.TABS_UPDATED, cb),
  onNavState: (cb: (payload: NavState) => void) => subscribe(IPC.NAV_STATE, cb),
  onSafetySettings: (cb: (settings: SafetySettings) => void) => subscribe(IPC.SAFETY_SETTINGS, cb),
  onTheme: (cb: (payload: ThemePayload) => void) => subscribe(IPC.THEME, cb),
  onHistoryPage: (cb: (result: HistoryPageResult) => void) => subscribe(IPC.HISTORY_PAGE, cb),
  onBookmarksUpdated: (cb: (entries: BookmarkEntry[]) => void) => subscribe(IPC.BOOKMARKS_UPDATED, cb),
  onBookmarkFoldersUpdated: (cb: (folders: BookmarkFolder[]) => void) => subscribe(IPC.BOOKMARK_FOLDERS_UPDATED, cb),
  onBookmarkImportResult: (cb: (result: BookmarkImportResult) => void) => subscribe(IPC.BOOKMARK_IMPORT_RESULT, cb),
  onDataUsageSummary: (cb: (summary: DataUsageSummary) => void) => subscribe(IPC.DATA_USAGE_SUMMARY, cb),
  onSubtitleSettings: (cb: (settings: SubtitleSettings) => void) => subscribe(IPC.SUBTITLE_SETTINGS, cb),
  onPageTranslateSettings: (cb: (settings: PageTranslateSettings) => void) => subscribe(IPC.PAGE_TRANSLATE_SETTINGS, cb),
  onPageTranslateStatus: (cb: (status: PageTranslateStatusPayload) => void) => subscribe(IPC.PAGE_TRANSLATE_STATUS, cb),
  onWhisperStatus: (cb: (status: WhisperStatus) => void) => subscribe(IPC.WHISPER_STATUS, cb),
  onDomainTrust: (cb: (lists: DomainTrustLists) => void) => subscribe(IPC.DOMAIN_TRUST, cb),
  onProxySettings: (cb: (settings: ProxySettings) => void) => subscribe(IPC.PROXY_SETTINGS, cb),
  onFindBarOpen: (cb: () => void) => subscribe(IPC.FIND_BAR_OPEN, cb),
  onFindResult: (cb: (payload: FindResultPayload) => void) => subscribe(IPC.FIND_RESULT, cb),
  onFocusAddressBar: (cb: () => void) => subscribe(IPC.FOCUS_ADDRESS_BAR, cb),
  onDownloadsUpdated: (cb: (records: DownloadRecord[]) => void) => subscribe(IPC.DOWNLOADS_UPDATED, cb),
  onPermissionRequested: (cb: (request: PermissionRequestPayload) => void) => subscribe(IPC.PERMISSION_REQUESTED, cb),
  onSitePermissions: (cb: (sites: SitePermissions[]) => void) => subscribe(IPC.SITE_PERMISSIONS, cb),
  onAgentsUpdated: (cb: (configs: AgentConfig[]) => void) => subscribe(IPC.AGENTS_UPDATED, cb),
  onMcpServersUpdated: (cb: (servers: McpServerConfig[]) => void) => subscribe(IPC.MCP_SERVERS_UPDATED, cb),
  onMcpServerTestResult: (cb: (result: McpTestResult) => void) => subscribe(IPC.MCP_SERVER_TEST_RESULT, cb),
  onBuiltinMcpStatus: (cb: (status: BuiltinMcpServerStatus) => void) => subscribe(IPC.BUILTIN_MCP_STATUS, cb),
  onMcpTokensUpdated: (cb: (tokens: McpTokenInfo[]) => void) => subscribe(IPC.MCP_TOKENS_UPDATED, cb),
  onMcpTokenCreated: (cb: (result: CreateMcpTokenResult) => void) => subscribe(IPC.MCP_TOKEN_CREATED, cb),
  onChatServersUpdated: (cb: (payload: ChatServersPayload) => void) => subscribe(IPC.CHAT_SERVERS_UPDATED, cb),
  /** Relayed from the chat view's UsernameTakenModal CTA - open Settings
   * deep-linked straight to this server's edit form (see
   * SettingsModal.tsx's focusChatServerId). */
  onOpenChatServerSettings: (cb: (serverId: string) => void) => subscribe(IPC.OPEN_CHAT_SERVER_SETTINGS, cb),
  onChatServerUsernameClaimResult: (cb: (result: ChatServerUsernameClaimResult) => void) =>
    subscribe(IPC.CHAT_SERVER_USERNAME_CLAIM_RESULT, cb),
};

export type PaperkiteChromeApi = typeof api;

contextBridge.exposeInMainWorld('paperkite', api);
