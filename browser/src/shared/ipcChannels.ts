/**
 * Canonical IPC channel names, shared by preload scripts and the main
 * process so a typo can't silently split a sender from its listener.
 */
export const IPC = {
  // chrome -> main
  NEW_TAB: 'chrome:new-tab',
  CLOSE_TAB: 'chrome:close-tab',
  SWITCH_TAB: 'chrome:switch-tab',
  NAVIGATE: 'chrome:navigate',
  GO_BACK: 'chrome:go-back',
  GO_FORWARD: 'chrome:go-forward',
  RELOAD: 'chrome:reload',
  TOGGLE_CHAT: 'chrome:toggle-chat',
  SET_SAFETY_SETTINGS: 'chrome:set-safety-settings',
  SET_THEME: 'chrome:set-theme',
  /** Chrome asks main to grow/shrink it to full-window size, for local
   * (non-blocking) modals like Settings - see WindowManager.setChromeFullscreen. */
  SET_CHROME_OVERLAY: 'chrome:set-overlay',
  SET_TOOLBAR_POPOVER_OPEN: 'chrome:set-toolbar-popover-open',
  CHROME_READY: 'chrome:ready',
  DELETE_HISTORY_ENTRY: 'chrome:delete-history-entry',
  CLEAR_HISTORY: 'chrome:clear-history',
  REQUEST_HISTORY_PAGE: 'chrome:request-history-page',
  TOGGLE_BOOKMARK: 'chrome:toggle-bookmark',
  DELETE_BOOKMARK: 'chrome:delete-bookmark',
  RENAME_BOOKMARK: 'chrome:rename-bookmark',
  MOVE_BOOKMARK: 'chrome:move-bookmark',
  CREATE_BOOKMARK_FOLDER: 'chrome:create-bookmark-folder',
  RENAME_BOOKMARK_FOLDER: 'chrome:rename-bookmark-folder',
  DELETE_BOOKMARK_FOLDER: 'chrome:delete-bookmark-folder',
  IMPORT_BOOKMARKS: 'chrome:import-bookmarks',
  CLEAR_ALL_BOOKMARKS: 'chrome:clear-all-bookmarks',
  CLEAR_ALL_AGENT_THREADS: 'chrome:clear-all-agent-threads',
  REQUEST_DATA_USAGE_SUMMARY: 'chrome:request-data-usage-summary',
  SET_SUBTITLE_SETTINGS: 'chrome:set-subtitle-settings',
  SET_PAGE_TRANSLATE_SETTINGS: 'chrome:set-page-translate-settings',
  AUDIO_CHUNK: 'chrome:audio-chunk',
  REQUEST_WHISPER_STATUS: 'chrome:request-whisper-status',
  SET_WHISPER_CONFIG: 'chrome:set-whisper-config',
  PICK_WHISPER_MODEL: 'chrome:pick-whisper-model',
  PICK_WHISPER_TRANSLATE_MODEL: 'chrome:pick-whisper-translate-model',
  SET_DOMAIN_TRUST: 'chrome:set-domain-trust',
  SET_PROXY_SETTINGS: 'chrome:set-proxy-settings',
  FIND_IN_PAGE: 'chrome:find-in-page',
  CLOSE_FIND_BAR: 'chrome:close-find-bar',
  CANCEL_DOWNLOAD: 'chrome:cancel-download',
  OPEN_DOWNLOAD: 'chrome:open-download',
  SHOW_DOWNLOAD_IN_FOLDER: 'chrome:show-download-in-folder',
  CLEAR_DOWNLOADS: 'chrome:clear-downloads',
  PERMISSION_RESPONSE: 'chrome:permission-response',
  REQUEST_SITE_PERMISSIONS: 'chrome:request-site-permissions',
  SET_SITE_PERMISSION: 'chrome:set-site-permission',
  RESET_SITE_PERMISSIONS: 'chrome:reset-site-permissions',
  CREATE_AGENT: 'chrome:create-agent',
  UPDATE_AGENT: 'chrome:update-agent',
  DELETE_AGENT: 'chrome:delete-agent',
  REQUEST_AGENTS: 'chrome:request-agents',
  REQUEST_MCP_SERVERS: 'chrome:request-mcp-servers',
  CREATE_MCP_SERVER: 'chrome:create-mcp-server',
  UPDATE_MCP_SERVER: 'chrome:update-mcp-server',
  DELETE_MCP_SERVER: 'chrome:delete-mcp-server',
  TEST_MCP_SERVER: 'chrome:test-mcp-server',
  REQUEST_BUILTIN_MCP_STATUS: 'chrome:request-builtin-mcp-status',
  SET_BUILTIN_MCP_ENABLED: 'chrome:set-builtin-mcp-enabled',
  REQUEST_MCP_TOKENS: 'chrome:request-mcp-tokens',
  CREATE_MCP_TOKEN: 'chrome:create-mcp-token',
  REVOKE_MCP_TOKEN: 'chrome:revoke-mcp-token',
  REQUEST_CHAT_SERVERS: 'chrome:request-chat-servers',
  CREATE_CHAT_SERVER: 'chrome:create-chat-server',
  UPDATE_CHAT_SERVER: 'chrome:update-chat-server',
  DELETE_CHAT_SERVER: 'chrome:delete-chat-server',
  SET_DEFAULT_CHAT_SERVER: 'chrome:set-default-chat-server',
  CLAIM_CHAT_SERVER_USERNAME: 'chrome:claim-chat-server-username',

  // main -> chrome
  TABS_UPDATED: 'main:tabs-updated',
  NAV_STATE: 'main:nav-state',
  SAFETY_SETTINGS: 'main:safety-settings',
  HISTORY_PAGE: 'main:history-page',
  BOOKMARKS_UPDATED: 'main:bookmarks-updated',
  BOOKMARK_FOLDERS_UPDATED: 'main:bookmark-folders-updated',
  BOOKMARK_IMPORT_RESULT: 'main:bookmark-import-result',
  DATA_USAGE_SUMMARY: 'main:data-usage-summary',
  SUBTITLE_SETTINGS: 'main:subtitle-settings',
  PAGE_TRANSLATE_SETTINGS: 'main:page-translate-settings',
  PAGE_TRANSLATE_STATUS: 'main:page-translate-status',
  WHISPER_STATUS: 'main:whisper-status',
  PROXY_SETTINGS: 'main:proxy-settings',
  FIND_BAR_OPEN: 'main:find-bar-open',
  FIND_RESULT: 'main:find-result',
  FOCUS_ADDRESS_BAR: 'main:focus-address-bar',
  DOWNLOADS_UPDATED: 'main:downloads-updated',
  PERMISSION_REQUESTED: 'main:permission-requested',
  SITE_PERMISSIONS: 'main:site-permissions',
  MCP_SERVERS_UPDATED: 'main:mcp-servers-updated',
  MCP_SERVER_TEST_RESULT: 'main:mcp-server-test-result',
  BUILTIN_MCP_STATUS: 'main:builtin-mcp-status',
  MCP_TOKENS_UPDATED: 'main:mcp-tokens-updated',
  MCP_TOKEN_CREATED: 'main:mcp-token-created',
  /** Relayed from chat's REQUEST_OPEN_CHAT_SERVER_SETTINGS below - the chat
   * view can't open Settings itself (that UI lives in the chrome view, a
   * separate renderer), so it asks main to forward the request. Carries
   * the server id chrome should deep-link straight to (see
   * SettingsModal.tsx's focusChatServerId). */
  OPEN_CHAT_SERVER_SETTINGS: 'main:open-chat-server-settings',
  /** Result of a CLAIM_CHAT_SERVER_USERNAME attempt - see
   * ChatServerUsernameClaimResult's own doc comment in shared/types.ts. */
  CHAT_SERVER_USERNAME_CLAIM_RESULT: 'main:chat-server-username-claim-result',
  // main -> chrome & main -> chat
  THEME: 'main:theme',
  DOMAIN_TRUST: 'main:domain-trust',
  AGENTS_UPDATED: 'main:agents-updated',
  /** Broadcast to both - Settings' CRUD list (chrome) and the per-tab
   * server picker (chat) both need the current server list + default. */
  CHAT_SERVERS_UPDATED: 'main:chat-servers-updated',

  // main -> chat
  ROOM_CHANGED: 'main:room-changed',
  MESSAGES: 'main:messages',
  ACTIVE_CHAT_SERVER: 'main:active-chat-server',
  CHAT_CONNECTION_STATUS: 'main:chat-connection-status',
  SCREENSHOT_CAPTURED: 'main:screenshot-captured',
  IMAGE_SAVED: 'main:image-saved',
  SCREENSHOT_CHAIN: 'main:screenshot-chain',
  AGENT_THREADS: 'main:agent-threads',
  AGENT_MESSAGES: 'main:agent-messages',
  AGENT_MESSAGE_ADDED: 'main:agent-message-added',
  AGENT_MESSAGE_CHUNK: 'main:agent-message-chunk',
  AGENT_MESSAGE_DONE: 'main:agent-message-done',
  AGENT_MESSAGE_ERROR: 'main:agent-message-error',
  AGENT_MESSAGE_STATUS: 'main:agent-message-status',
  AGENT_MESSAGE_RETRY: 'main:agent-message-retry',

  // chat -> main
  SEND_MESSAGE: 'chat:send-message',
  OPEN_LINK: 'chat:open-link',
  CHAT_READY: 'chat:ready',
  SET_ACTIVE_CHAT_SERVER: 'chat:set-active-chat-server',
  /** "Go fix this server's username" - see OPEN_CHAT_SERVER_SETTINGS above,
   * fired from UsernameTakenModal.tsx's CTA. */
  REQUEST_OPEN_CHAT_SERVER_SETTINGS: 'chat:request-open-chat-server-settings',
  CAPTURE_SCREENSHOT: 'chat:capture-screenshot',
  /** Chat asks main to grow it to full-window size for the image lightbox -
   * same trick as chrome:set-overlay, but for the chat view. */
  SET_CHAT_OVERLAY: 'chat:set-overlay',
  SAVE_IMAGE: 'chat:save-image',
  REQUEST_SCREENSHOT_CHAIN: 'chat:request-screenshot-chain',
  REQUEST_AGENT_THREADS: 'chat:request-agent-threads',
  CREATE_AGENT_THREAD: 'chat:create-agent-thread',
  DELETE_AGENT_THREAD: 'chat:delete-agent-thread',
  REQUEST_AGENT_MESSAGES: 'chat:request-agent-messages',
  SEND_AGENT_MESSAGE: 'chat:send-agent-message',
  STOP_AGENT_MESSAGE: 'chat:stop-agent-message',
  RETRY_AGENT_MESSAGE: 'chat:retry-agent-message',

  // main <-> tab pages (see preload/pageTranslate.ts) - not chrome or chat,
  // a third preload attached to every ordinary browsing tab. No
  // contextBridge on this one: the preload talks to main directly over
  // ipcRenderer, and never exposes anything into the (untrusted) page's
  // own JS world.
  /** main -> tab: start walking the DOM and translating what it finds;
   * also what gets sent again on every fresh navigation while a tab's
   * PageTranslateSettings.enabled is true (see main/tabManager.ts) - a new
   * document has nothing translated yet. */
  PAGE_TRANSLATE_ENABLE: 'page-translate:enable',
  /** main -> tab: restore every currently-translated node's original
   * text and stop watching for new content. */
  PAGE_TRANSLATE_DISABLE: 'page-translate:disable',
  /** tab -> main: newly found translatable text - fired once for the
   * initial full-page walk, and again per batch whenever the tab's own
   * MutationObserver notices new/changed text (SPA content). */
  PAGE_TRANSLATE_EXTRACTED: 'page-translate:extracted',
  /** main -> tab: translations for a batch this exact tab previously sent
   * up via PAGE_TRANSLATE_EXTRACTED - applied by node id, not position. */
  PAGE_TRANSLATE_APPLY: 'page-translate:apply',
} as const;
