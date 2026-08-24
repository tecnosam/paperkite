/**
 * Shared type definitions for the IPC contract between the main process
 * and the two renderer surfaces (chrome + chat). Keeping these in one
 * place means preload scripts, main-process handlers, and React
 * components all type-check against the same shapes.
 */

/** A single browser tab as seen by the chrome UI. */
export interface TabInfo {
  id: string;
  title: string;
  url: string;
  favicon: string | null;
  loading: boolean;
}

/** Sent whenever the tab list or the active tab changes. */
export interface TabsUpdatedPayload {
  tabs: TabInfo[];
  activeId: string | null;
}

/** Reserved SubtitleSettings.engine values for the two whisper-only paths
 * (see below) - any other value is a real agent's id. Agent ids are
 * randomUUID() strings (see main/agentStore.ts), so collision with these
 * reserved words isn't a real concern. */
export const WHISPER_ENGINE = 'whisper';
export const WHISPER_TRANSLATE_ENGINE = 'whisper-translate';

/** Live-translation subtitle overlay settings - kept per-tab (see
 * TabManager) so turning it on for one video doesn't leak into others.
 * `engine` picks what actually produces the caption text, explicitly
 * chosen in the popover (see SubtitlePopover) - never auto-selected:
 *  - WHISPER_ENGINE: plain whisper.cpp transcription, no translation at
 *    all - captions stay in whatever language is actually spoken;
 *    `language` below is ignored.
 *  - WHISPER_TRANSLATE_ENGINE: whisper.cpp's own `-tr` flag - always
 *    outputs English regardless of `language` below, since that's the
 *    only language whisper can translate to on its own (see
 *    main/whisperTranscribe.ts).
 *  - a real agent's id: whisper transcribes in the original language,
 *    then that agent translates the result into `language` below (see
 *    main/translate.ts) - the only engine that can target a language
 *    other than English, and generally better quality than whisper's own
 *    `-tr` even when the target IS English (confirmed by hand: whisper's
 *    own `-tr` hallucinates badly on real non-English speech with smaller
 *    models). */
export interface SubtitleSettings {
  enabled: boolean;
  engine: string;
  language: string;
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = { enabled: false, engine: WHISPER_ENGINE, language: 'English' };

/** In-page text translation settings - kept per-tab (see TabManager), same
 * reasoning as SubtitleSettings: turning it on for one page shouldn't leak
 * into others. Unlike live subtitles, there's no whisper-equivalent
 * fallback here - translating arbitrary page text always needs an agent,
 * so `agentId` is required (not optional-with-a-built-in-engine) once
 * `enabled` is true; the popover blocks turning it on until one's picked.
 * Re-applied fresh on every navigation while enabled (see
 * main/tabManager.ts) - a new document has no memory of the last one's
 * translated DOM. */
export interface PageTranslateSettings {
  enabled: boolean;
  agentId: string | null;
  language: string;
}

export const DEFAULT_PAGE_TRANSLATE_SETTINGS: PageTranslateSettings = { enabled: false, agentId: null, language: 'English' };

/** One text node's content and a stable id, unique within whichever tab
 * sent it and only meaningful for the lifetime of its current document -
 * used both directions over IPC.PAGE_TRANSLATE_EXTRACTED (tab -> main,
 * `text` is the original) and IPC.PAGE_TRANSLATE_APPLY (main -> tab,
 * `text` is the translation for that same id). The preload keeps a live
 * Map from id to the actual DOM Text node (see preload/pageTranslate.ts),
 * so applying a translation never needs to re-query the DOM by position -
 * which would be fragile against anything else mutating the page in the
 * meantime. */
export interface PageTranslateTextEntry {
  id: string;
  text: string;
}

/** IPC.PAGE_TRANSLATE_EXTRACTED's actual payload (tab -> main). */
export interface PageTranslateExtractedPayload {
  entries: PageTranslateTextEntry[];
  /** True only for the very first walk, right after PAGE_TRANSLATE_ENABLE -
   * later batches the MutationObserver picks up from SPA content set this
   * false, so main only flips the visible 'translating' status (see
   * PageTranslateStatus) for the initial page-load pass, not for every
   * minor content top-up after it. */
  initial: boolean;
}

/** Sent main -> tab (IPC.PAGE_TRANSLATE_ENABLE) to (re-)start page
 * translation - including once per fresh navigation while a tab's
 * PageTranslateSettings.enabled is true, since a new document starts with
 * nothing translated. */
export interface PageTranslateEnablePayload {
  agentId: string;
  language: string;
}

/** Live progress for the ACTIVE tab's page translation - purely a
 * transient status signal (see main/ipc.ts), not persisted the way
 * PageTranslateSettings is. Drives the toolbar button/popover's
 * spinner and error messaging (see PageTranslatePopover.tsx):
 *  - 'idle': nothing in flight - either translate is off, or it's on but
 *    fully caught up (matches 'done' visually, kept distinct mainly so
 *    "just turned on, about to start" and "already finished a while ago"
 *    aren't conflated in main's own bookkeeping).
 *  - 'translating': the tab's initial full-page walk is being translated -
 *    later background top-ups from its MutationObserver do NOT re-enter
 *    this state, so minor SPA content changes don't re-flash the spinner.
 *  - 'done': the initial walk's translation finished (successfully, even
 *    if some individual lines silently failed to parse - see
 *    translatePage.ts) - the normal "on and working" state.
 *  - 'error': the whole batch failed outright (agent removed, timeout,
 *    etc.) - `error` carries a short human-readable reason. */
export type PageTranslateStatus = 'idle' | 'translating' | 'done' | 'error';

export interface PageTranslateStatusPayload {
  status: PageTranslateStatus;
  error?: string;
}

/** A reasonable, non-exhaustive spread for language pickers - not meant to
 * be authoritative, just enough to try the UI with. Shared between the
 * live-subtitle popover and the page-translate popover (see
 * PageTranslateSettings below) rather than each keeping its own copy. */
export const TRANSLATE_LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Russian',
  'Japanese',
  'Korean',
  'Mandarin Chinese',
  'Arabic',
  'Hindi',
  'Turkish',
  'Polish',
  'Vietnamese',
] as const;

/** User-set overrides for locating whisper.cpp - `null` means "auto-detect"
 * (binaryPath) or "not set" (modelPath). Paperkite doesn't install or
 * bundle whisper.cpp itself; the user is responsible for getting it onto
 * their machine however they like (see main/whisperStore.ts). */
export interface WhisperConfig {
  binaryPath: string | null;
  modelPath: string | null;
  /** Optional second model, used only for whisper's own `-tr` (translate to
   * English) fallback path when no agent is configured - see
   * main/whisperTranscribe.ts. Exists because not every model tier actually
   * supports the translate task: `large-v3-turbo` in particular was never
   * trained on it and silently just transcribes in the original language
   * instead (confirmed against a matching upstream whisper.cpp issue).
   * `null` means "use `modelPath` for this too," which is correct for any
   * tier that DOES support translate (base/small/medium/large-v3) - this
   * only needs to be set to work around turbo specifically. */
  translateModelPath: string | null;
}

export const DEFAULT_WHISPER_CONFIG: WhisperConfig = { binaryPath: null, modelPath: null, translateModelPath: null };

/** Live-computed (not persisted) picture of whether live translate can
 * actually run right now. `binaryPathOverride` is the raw config value
 * (what Settings shows in the text field - null means "auto-detect");
 * `effectiveBinaryPath` is whichever of that override / auto-detection
 * actually resolved to something runnable, or null if neither did. */
export interface WhisperStatus {
  ready: boolean;
  binaryPathOverride: string | null;
  effectiveBinaryPath: string | null;
  binaryAutoDetected: boolean;
  modelPath: string | null;
  modelExists: boolean;
  /** See WhisperConfig.translateModelPath - optional, so modelExists-style
   * checks against it are meaningless when it's null (that's the normal,
   * unset state, not a broken one). */
  translateModelPath: string | null;
  translateModelExists: boolean;
}

/** Navigation state for the currently active tab. */
export interface NavState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

/** A chat message. Real ones (see main/chatSession.ts) come from an
 * external chat-service room and only ever have id/username/text/timestamp
 * - countryCode/pinned/attachments are legacy fields from the old
 * local-only mock chat (main/chatStore.ts's now-retired canned-reply
 * system) that a handful of pre-existing on-disk records still carry, kept
 * optional rather than removed so that old data still type-checks. Pin
 * state for real messages is tracked entirely client-side now (see
 * renderer/chat/App.tsx) - the chat-service protocol has no concept of it. */
export interface ChatMessage {
  /** Stable id - a server-assigned opaque string for real messages, never
   * reused, so the UI can key list items correctly. */
  id: string;
  username: string;
  text: string;
  timestamp: number;
  /** ISO 3166-1 alpha-2 code, e.g. "US" - legacy-only, see above. */
  countryCode?: string;
  /** Legacy-only, see above - real messages don't set this; pin state for
   * them lives in renderer/chat/App.tsx's own local state instead. */
  pinned?: boolean;
  /** Legacy-only, see above - up to MAX_MESSAGE_ATTACHMENTS screenshots.
   * The chat-service protocol's /send only carries a plain text `content`
   * field, so real messages never have this. */
  attachments?: MessageAttachment[];
}

/** Persisted local identity - set once on first run, reused silently. */
/** Content-safety toggles, persisted alongside the user profile. All
 * default to `true` (safest default); each is a pure display-time filter
 * in the chat renderer - the underlying message text is never mutated. */
export interface SafetySettings {
  censorProfanity: boolean;
  censorNudity: boolean;
  /** When true: only trusted/same-site links are clickable, suspicious
   * (spam/phishing-looking) links are auto-masked, everything else is
   * plain text. When false: every link is shown as plain clickable text,
   * no filtering at all. */
  censorHyperlinks: boolean;
}

export const DEFAULT_SAFETY_SETTINGS: SafetySettings = {
  censorProfanity: true,
  censorNudity: true,
  censorHyperlinks: true,
};

/** 'system' follows the OS light/dark setting live; 'light'/'dark' pin it. */
export type ThemeSource = 'system' | 'light' | 'dark';

/** Pushed to both renderers whenever the resolved theme changes (a
 * preference change, or the OS theme itself changing while on 'system'). */
export interface ThemePayload {
  source: ThemeSource;
  isDark: boolean;
}

/** Sent when the active tab's chat room changes (a navigation, tab switch,
 * or chat-server override change) - the chat-service protocol derives the
 * room from this URL server-side (see main/chatSession.ts), so there's no
 * separate client-computed room key anymore, just the URL itself. */
export interface RoomChangedPayload {
  url: string;
}

/** Sent whenever the current room's message list changes. `url` guards
 * against a stale delivery for a room the user's since navigated away
 * from, same idea as RoomChangedPayload. */
export interface MessagesPayload {
  url: string;
  list: ChatMessage[];
}

/** A configured external chat-service backend (see ../../chat-service in
 * this workspace, and its PROTOCOL.md) - Paperkite is a CLIENT of these,
 * never the service itself. No secret/credential field: the protocol's own
 * /connect issues a JWT per-session, there's nothing to pre-configure
 * beyond where the service lives. */
export interface ChatServerConfig {
  id: string;
  name: string;
  /** e.g. "http://localhost:8080" - no trailing slash (stripped on save). */
  baseUrl: string;
  /** This browser's identity on THIS server specifically - username is
   * per-server, not a single global identity, since a server's own
   * uniqueness claim (see ../../chat-service/PROTOCOL.md) is scoped to
   * that server alone, and there's no reason a name picked for one server
   * should carry over to an unrelated one. `null` means not set yet - see
   * main/ipc.ts's resyncChatSession, which treats that the same as "no
   * server configured" (nothing to connect with) rather than an error. */
  username: string | null;
  createdAt: number;
}

/** No `username` here on purpose - a server needs a real id before a
 * username can be claimed against it (see ClaimChatServerUsernamePayload
 * below), so a new server is always created without one and the caller
 * sets it afterward through that separate, validated flow. */
export interface AddChatServerPayload {
  name: string;
  baseUrl: string;
}

/** No `username` here either - once set, a server's username is
 * permanent (see ChatServerConfig.username's doc comment) and can only
 * ever be set through ClaimChatServerUsernamePayload's claim flow, never
 * silently overwritten by a general name/URL edit. */
export interface UpdateChatServerPayload {
  id: string;
  name: string;
  baseUrl: string;
}

export interface ClaimChatServerUsernamePayload {
  serverId: string;
  username: string;
}

/** Sent back after a ClaimChatServerUsernamePayload attempt - main
 * actually calls the server's own POST /connect to claim it (see
 * chatClient.connect), rather than just saving whatever was typed, so
 * this reports what the server itself decided. `reason` distinguishes a
 * permanent "someone else already has this name" (`taken`) from a
 * transient failure worth retrying (`error`) - see
 * ChatServerUsernameField.tsx for the two different messages shown. */
export interface ChatServerUsernameClaimResult {
  serverId: string;
  username: string;
  ok: boolean;
  reason?: 'taken' | 'error';
  message?: string;
}

/** The full server list plus which one is the GLOBAL default - sent to
 * both chrome (Settings > Chat Servers CRUD) and chat (the per-tab picker,
 * which needs to show "(default)" against the right one). */
export interface ChatServersPayload {
  servers: ChatServerConfig[];
  defaultServerId: string | null;
}

/** Which server the active tab is actually using right now.
 * `overrideServerId` is that tab's own explicit pick (null = "follow
 * whatever the global default is"); `effectiveServerId` is the one
 * actually in use after resolving that - the same value when an override
 * is set, otherwise whatever the current global default resolves to. */
export interface ActiveChatServerPayload {
  overrideServerId: string | null;
  effectiveServerId: string | null;
}

/** The live state of main's one-at-a-time chat-service polling session
 * (see main/chatSession.ts) - `url` guards against a status update for a
 * room the user's since navigated away from, same idea as
 * MessagesPayload's roomKey. */
export interface ChatConnectionStatus {
  state: 'idle' | 'connecting' | 'connected' | 'error';
  url: string | null;
  /** Set only when state is 'error' - a short, user-presentable reason
   * (e.g. a network error message). */
  error?: string;
  /** Set only when state is 'error' and the cause is the server-side
   * username claim (see ChatServerConfig.username's doc comment) already
   * being taken - a permanent failure the user can only fix from Settings,
   * not a transient one worth just showing as inline text. Lets the chat
   * renderer show a targeted modal + CTA instead (see UsernameTakenModal.tsx)
   * rather than string-matching `error` to detect this case. */
  reason?: 'username-taken';
}

/** An image attached to a chat message - currently only ever a page
 * screenshot, but `kind` leaves room for other attachment types later.
 * `dataUrl` is fully self-contained (base64-encoded JPEG) so the chat
 * renderer can drop it straight into an <img src>. */
export interface MessageAttachment {
  kind: 'screenshot';
  /** Stable id, assigned at capture time - lets the lightbox ask main for
   * this screenshot's place in the global chain (see chatStore.getScreenshotChain). */
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  /** The page URL that was on screen when this was captured. */
  url: string;
  /** Capture time - distinct from the *message's* send time (a user can
   * capture, wait, caption, then send), which is what the chain is
   * actually ordered by. */
  timestamp: number;
}

/** A message can carry at most this many screenshots - enforced in
 * MessageInput.tsx (the camera button disables once reached). */
export const MAX_MESSAGE_ATTACHMENTS = 3;

/** One node in a screenshot's "chain" - the small window of screenshots
 * (across every room, not just the current page) captured immediately
 * before/after it. `pagesSincePrevious` is how many distinct pages (from
 * browsing history) were visited between this node and the previous one
 * in the window - `null` for the first node, since there's no earlier
 * node in the window to measure from. See main/chatStore.ts's
 * getScreenshotChain() and main/historyStore.ts's countUniquePagesBetween(). */
export interface ScreenshotChainNode {
  id: string;
  dataUrl: string;
  url: string;
  timestamp: number;
  pagesSincePrevious: number | null;
}

export interface ScreenshotChainResult {
  targetId: string;
  nodes: ScreenshotChainNode[];
}

/** Sent back after a chat image save (the lightbox's Save button) resolves -
 * see main/downloadStore.ts's saveImageToDownloads(). */
export type ImageSavedResult = { ok: true; savePath: string } | { ok: false };

/** One browsing-history entry - a page the user actually navigated to
 * (not the new-tab page or an internal error page). */
export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  timestamp: number;
}

/** Requests one page of browsing history, newest first, optionally
 * filtered by a search query - see main/historyStore.ts's getHistoryPage(). */
export interface HistoryPageRequest {
  offset: number;
  limit: number;
  query: string;
}

/** `offset` and `query` are echoed back so the renderer can tell whether
 * this response still matches its current request (the user may have
 * typed a new search query, or the section may have reset, in the time
 * it took main to reply) and discard it if not. */
export interface HistoryPageResult {
  entries: HistoryEntry[];
  offset: number;
  hasMore: boolean;
  query: string;
}

/** Live counts for Settings > Privacy & Data's per-category clear actions
 * (see main/ipc.ts's REQUEST_DATA_USAGE_SUMMARY) - just enough context to
 * show what a "Clear" button is actually about to remove, not a full
 * listing (each category already has its own section for that). */
export interface DataUsageSummary {
  historyCount: number;
  bookmarkCount: number;
  agentThreadCount: number;
}

/** A user-saved bookmark, toggled from the toolbar star or renamed/removed
 * from the settings page. `folderId: null` means unfiled (root level). */
export interface BookmarkEntry {
  id: string;
  url: string;
  title: string;
  timestamp: number;
  folderId: string | null;
}

/** A bookmark folder, Chrome-style - can nest under another folder.
 * `parentId: null` means it lives at the root. */
export interface BookmarkFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

/** Sent by the chrome renderer when the toolbar star is clicked. Always
 * files the new bookmark at the root - the bookmark popover that opens
 * right after is where the user picks a folder (see MoveBookmarkPayload). */
export interface ToggleBookmarkPayload {
  url: string;
  title: string;
}

/** Sent by the chrome renderer when a bookmark is renamed - from the
 * toolbar popover or from Settings. */
export interface RenameBookmarkPayload {
  id: string;
  title: string;
}

/** Sent when a bookmark is filed into a different folder (or back to
 * unfiled, via `folderId: null`). */
export interface MoveBookmarkPayload {
  id: string;
  folderId: string | null;
}

export interface CreateBookmarkFolderPayload {
  name: string;
  parentId: string | null;
}

export interface RenameBookmarkFolderPayload {
  id: string;
  name: string;
}

/** Result of importing a browser bookmark export (Netscape Bookmark File
 * Format - the same HTML format Chrome/Firefox/Safari/Edge all use). */
export interface BookmarkImportResult {
  ok: boolean;
  bookmarkCount: number;
  folderCount: number;
  /** Already-bookmarked URLs, left as-is rather than duplicated. */
  skipped: number;
  error?: string;
}

/** User-managed domain trust lists, layered on top of the built-in
 * heuristics in shared/linkSafety.ts - an untrusted match always wins,
 * a trusted match always bypasses the heuristics, membership in one list
 * excludes the other. Bare lowercase hostnames, e.g. "example.com". */
export interface DomainTrustLists {
  trusted: string[];
  untrusted: string[];
}

export const DEFAULT_DOMAIN_TRUST_LISTS: DomainTrustLists = {
  trusted: [],
  untrusted: [],
};

/** Manual proxy configuration, applied via session.setProxy(). 'direct'
 * means no proxy (the default) - the protocol/host/port/bypassList fields
 * are only meaningful when mode is 'manual'. */
export interface ProxySettings {
  mode: 'direct' | 'manual';
  protocol: 'http' | 'https' | 'socks5';
  host: string;
  port: string;
  /** Comma-separated bypass rules, e.g. "localhost,127.0.0.1". */
  bypassList: string;
}

export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  mode: 'direct',
  protocol: 'http',
  host: '',
  port: '',
  bypassList: 'localhost,127.0.0.1',
};

/** Sent by the chrome renderer's find bar as the user types or hits
 * next/previous. */
export interface FindInPagePayload {
  text: string;
  forward: boolean;
  /** true for consecutive Enter/next presses on the same search - lets
   * Electron skip re-scanning the page (see webContents.findInPage()). */
  findNext: boolean;
}

/** Sent back after a findInPage() call resolves. */
export interface FindResultPayload {
  activeMatchOrdinal: number;
  matches: number;
}

/** A single browser download, tracked from `will-download` through to a
 * terminal state. Only terminal-state entries are persisted across
 * restarts - see main/downloadStore.ts. */
export interface DownloadRecord {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  startTime: number;
}

/** Site API access this browser actually gates - deliberately just these
 * three (what was asked for), not the full list Electron's permission
 * API supports. See main/permissions.ts. */
export type PermissionCapability = 'geolocation' | 'camera' | 'microphone';
export type PermissionDecision = 'granted' | 'denied';

/** One origin's remembered decisions, for the Settings > Permissions list -
 * a capability absent from the record means "never decided", not denied. */
export interface SitePermissions {
  origin: string;
  geolocation?: PermissionDecision;
  camera?: PermissionDecision;
  microphone?: PermissionDecision;
}

/** Sent to chrome when a page requests a capability with no remembered
 * decision yet - chrome shows the Allow/Block bubble and responds on
 * PERMISSION_RESPONSE. `capabilities` can be more than one at once (a
 * getUserMedia call requesting both camera and microphone together shows
 * a single combined prompt, matching how Chrome itself handles it). */
export interface PermissionRequestPayload {
  requestId: string;
  origin: string;
  capabilities: PermissionCapability[];
}

export interface PermissionResponsePayload {
  requestId: string;
  allow: boolean;
  /** Persist this decision for the origin so future requests skip the
   * prompt - the checkbox in the bubble, defaulted on like Chrome's. */
  remember: boolean;
}

/** Sent by the settings page to flip or clear a remembered decision. */
export interface SetSitePermissionPayload {
  origin: string;
  capability: PermissionCapability;
  decision: PermissionDecision;
}

/** ---------- AI agents ---------- */

export type AgentProvider = 'gemini' | 'openai' | 'claude' | 'ollama';

/** Renderer-facing shape - never carries a credential, not even an
 * encrypted one. See main/agentStore.ts. */
export interface AgentConfig {
  id: string;
  provider: AgentProvider;
  /** User-given label, e.g. "Work Claude" - shown instead of the raw provider name. */
  name: string;
  model: string;
  /** Local server address - only meaningful for 'ollama'. */
  baseUrl?: string;
  /** Sent as this agent's system prompt on every message - not a secret,
   * just a preference, unlike apiKey. */
  systemPrompt?: string;
  createdAt: number;
  /** Whether an API key is on file - the key itself is never exposed to
   * any renderer. Always false for 'ollama' (no credential needed). */
  hasCredential: boolean;
}

/** Sent once from Settings when adding an agent - chrome -> main only,
 * the apiKey is written to disk encrypted and never read back. */
export interface AddAgentPayload {
  provider: AgentProvider;
  name: string;
  model: string;
  baseUrl?: string;
  systemPrompt?: string;
  apiKey?: string;
}

/** Sent when editing an existing agent. `provider` is fixed at creation
 * (like an MCP server's transport - changing it would invalidate the
 * model/key expectations, so it isn't offered as editable). `apiKey` is
 * only applied if non-empty - leaving it blank keeps whatever key is
 * already on file, the same convention UpdateMcpServerPayload uses. */
export interface UpdateAgentPayload {
  id: string;
  name: string;
  model: string;
  baseUrl?: string;
  systemPrompt?: string;
  apiKey?: string;
}

/** A private, page-independent conversation with one configured agent. */
export interface AgentThread {
  id: string;
  agentId: string;
  /** Derived once from the first ~40 chars of the first user message. */
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  /** Only ever set on user messages - a screenshot of the current page,
   * attached only when the user explicitly captured one via the camera
   * button (see MessageInput's pattern, reused in AgentConversation). */
  attachment?: MessageAttachment;
  /** Set on an assistant message that failed (bad key, network error,
   * rate limit, etc.) - kept in history so it's visible on reopening. */
  error?: string;
}

/** Sent by the chat renderer when the user hits send in an agent thread. */
export interface SendAgentMessagePayload {
  threadId: string;
  text: string;
  /** Set only if the user explicitly captured a screenshot via the camera
   * button for this message - never automatic. */
  attachment?: MessageAttachment;
}

/** Sent by the chat renderer to retry a failed assistant reply - `messageId`
 * is the failed message's own id, reused in place rather than creating a
 * new user/assistant pair. Also sent back (main -> chat) right before the
 * retry starts, so the UI can reset that message to "streaming" locally. */
export interface RetryAgentMessagePayload {
  threadId: string;
  messageId: string;
}

/** Sent whenever a thread's message list is fetched wholesale (on open). */
export interface AgentMessagesPayload {
  threadId: string;
  list: AgentMessage[];
}

/** Sent the instant a message (user or assistant placeholder) is added,
 * so the UI can show it before any streaming has happened. */
export interface AgentMessageAddedPayload {
  threadId: string;
  message: AgentMessage;
}

/** Streamed to the chat renderer as an assistant reply arrives. */
export interface AgentMessageChunkPayload {
  threadId: string;
  messageId: string;
  textDelta: string;
}

export interface AgentMessageDonePayload {
  threadId: string;
  messageId: string;
}

export interface AgentMessageErrorPayload {
  threadId: string;
  messageId: string;
  error: string;
}

/** Sent while an agent reply is in progress but not currently emitting
 * text - e.g. a tool call is running. `status: null` clears it (text
 * resumed, or the reply finished/errored). Purely transient - never
 * persisted, matching the streaming cursor it replaces while active. */
export interface AgentMessageStatusPayload {
  threadId: string;
  messageId: string;
  status: string | null;
}

/** ---------- MCP servers ---------- */

export type McpTransport = 'stdio' | 'http';

/** Renderer-facing shape - like AgentConfig, never carries a credential,
 * not even an encrypted one. See main/mcpStore.ts. */
export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  /** stdio only - the executable to run. */
  command?: string;
  /** stdio only - command-line arguments. */
  args?: string[];
  /** http only - the server's endpoint. */
  url?: string;
  createdAt: number;
  /** Whether env vars (stdio) or an auth header (http) are on file - the
   * values themselves are never exposed to any renderer. */
  hasSecrets: boolean;
}

/** Sent once from Settings when adding a server - chrome -> main only. */
export interface AddMcpServerPayload {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  /** stdio: environment variables for the child process. */
  env?: Record<string, string>;
  /** http: sent as the `Authorization` header verbatim. */
  authHeader?: string;
}

/** Sent when editing an existing server. `env`/`authHeader` are only
 * applied if present (and non-empty) - omitting them keeps whatever
 * secret is already on file, so the edit form never needs to re-display
 * a saved credential to let the user leave it untouched. */
export interface UpdateMcpServerPayload {
  id: string;
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  authHeader?: string;
}

/** Result of Settings' "Test connection" - a fresh, uncached connection
 * attempt against a draft (possibly not-yet-saved) server config. */
export type McpTestResult = { ok: true; toolCount: number } | { ok: false; error: string };

/** ---------- Paperkite's own MCP server ---------- */

/** Every capability the built-in server exposes is gated behind one of
 * these - a token only works for the tools whose scope it was granted.
 * `proxy` deliberately has no `:write` variant - see main/mcp/builtinServer.ts. */
export type McpScope =
  | 'bookmarks:read'
  | 'bookmarks:write'
  | 'history:read'
  | 'history:write'
  | 'domains:read'
  | 'domains:write'
  | 'proxy:read'
  | 'tabs:read'
  | 'tabs:write';

/** Whether the built-in server is currently listening, and where - `url`
 * is `null` while disabled. */
export interface BuiltinMcpServerStatus {
  enabled: boolean;
  port: number | null;
  url: string | null;
}

/** Renderer-facing token metadata - the signed JWT itself is never sent
 * over IPC except once, at creation time (see CreateMcpTokenResult). The
 * synthetic `jti: 'internal'` entry (Paperkite's own agent chat's access)
 * is included here too, so Settings can show it without a separate
 * code path - `internal: true` marks it as non-revocable. */
export interface McpTokenInfo {
  jti: string;
  label: string;
  scopes: McpScope[];
  createdAt: number;
  expiresAt: number | null;
  internal: boolean;
}

/** Sent once from Settings to mint a new external token. */
export interface CreateMcpTokenPayload {
  label: string;
  scopes: McpScope[];
  /** Milliseconds from now, or `null` for "never expires". */
  ttlMs: number | null;
}

/** The only time the raw JWT is ever sent to a renderer - shown once in
 * the "copy this now" box, never persisted, never retrievable again. */
export interface CreateMcpTokenResult {
  token: McpTokenInfo;
  jwt: string;
}

