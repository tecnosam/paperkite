/**
 * Wires ipcMain listeners (the "chrome -> main" and "chat -> main" half
 * of the IPC contract) to the WindowManager/TabManager/stores, and pushes
 * state back out ("main -> chrome", "main -> chat") in response.
 */
import { ipcMain, nativeTheme, shell, dialog, app } from 'electron';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { IPC } from '../shared/ipcChannels';
import type {
  SafetySettings,
  ThemePayload,
  ThemeSource,
  ToggleBookmarkPayload,
  RenameBookmarkPayload,
  MoveBookmarkPayload,
  CreateBookmarkFolderPayload,
  RenameBookmarkFolderPayload,
  SubtitleSettings,
  PageTranslateSettings,
  PageTranslateExtractedPayload,
  WhisperConfig,
  DomainTrustLists,
  ProxySettings,
  FindInPagePayload,
  HistoryPageRequest,
  ScreenshotChainNode,
  PermissionResponsePayload,
  SetSitePermissionPayload,
  AddAgentPayload,
  UpdateAgentPayload,
  SendAgentMessagePayload,
  RetryAgentMessagePayload,
  AddMcpServerPayload,
  UpdateMcpServerPayload,
  CreateMcpTokenPayload,
  MessageAttachment,
  AgentThread,
  AgentMessage,
  ChatMessage,
  ChatServersPayload,
  AddChatServerPayload,
  UpdateChatServerPayload,
  ClaimChatServerUsernamePayload,
  ChatServerUsernameClaimResult,
} from '../shared/types';
import { WHISPER_ENGINE, WHISPER_TRANSLATE_ENGINE } from '../shared/types';
import { PAPER_DARK, PAPER_LIGHT, type WindowManager } from './windowManager';
import { getSystemCountryCode, loadSafetySettings, saveSafetySettings, saveThemeSource } from './userStore';
import { getScreenshotChain } from './chatStore';
import * as chatSession from './chatSession';
import * as chatClient from './chatClient';
import type { ChatServerMessage } from './chatClient';
import {
  getChatServers,
  getDefaultChatServerId,
  getChatServerById,
  getChatServerToken,
  setChatServerToken,
  clearChatServerToken,
  addChatServer,
  updateChatServer,
  removeChatServer,
  setDefaultChatServer,
  setChatServerUsername,
} from './chatServerStore';
import { getHistoryPage, deleteEntry, clearHistory, countUniquePagesBetween, getHistoryCount } from './historyStore';
import {
  getBookmarks,
  getFolders,
  toggleBookmark,
  removeBookmark,
  renameBookmark,
  moveBookmark,
  createFolder,
  renameFolder,
  deleteFolder,
  clearAllBookmarks,
} from './bookmarkStore';
import { importBookmarksFromHtml } from './bookmarkImport';
import { getDomainTrustLists, setDomainTrustLists } from './domainTrustStore';
import { loadProxySettings, saveProxySettings, applyProxySettings } from './proxyStore';
import { getDownloads, cancelDownload, clearFinished, saveImageToDownloads } from './downloadStore';
import { captureCompressedScreenshot } from './screenshot';
import { resolvePermissionRequest } from './permissions';
import { getAllSitePermissions, setDecision, resetOrigin } from './permissionStore';
import { getAgentConfigs, addAgent, updateAgent, removeAgent, getAgentForRequest } from './agentStore';
import {
  getThreads,
  getMessages as getAgentMessages,
  createThread,
  deleteThread,
  clearAllThreads,
  addMessage as addAgentMessage,
  appendToMessage,
  finalizeMessage,
  resetMessageForRetry,
} from './agentThreadStore';
import { getAdapter, type AgentHistoryTurn } from './agents';
import { getMcpServers, addMcpServer, updateMcpServer, removeMcpServer } from './mcpStore';
import { getAllAvailableTools, testConnection, disconnectServer } from './mcp/client';
import { getTokens, createToken, revokeToken } from './mcpAuth';
import { getBuiltinServerStatus, setBuiltinMcpServerEnabled } from './mcp/builtinServer';
import { loadWhisperConfig, saveWhisperConfig, getWhisperStatus, invalidateWhisperStatusCache } from './whisperStore';
import { transcribeWavChunk } from './whisperTranscribe';
import { translateText } from './translate';
import { translatePageBatch } from './translatePage';

/** Tracks the AbortController for each thread's in-flight streaming
 * request, so a STOP_AGENT_MESSAGE for that thread can cancel it. */
const activeAgentStreams = new Map<string, AbortController>();

/** Live translate's own transcript so far - fed back into the next
 * whisper.cpp call as `--prompt` context (see whisperTranscribe.ts and the
 * AUDIO_CHUNK handler below). Cleared whenever translate turns off (see
 * SET_SUBTITLE_SETTINGS) so a new session doesn't start with stale
 * leftover context from whatever was playing before. */
let lastTranscript = '';

/** Rolling (transcript, translation) history for live translate, oldest
 * first, in memory only - never persisted, so it's implicitly gone the
 * moment the browser closes, on top of being cleared explicitly whenever
 * translate turns off (see SET_SUBTITLE_SETTINGS). Capped at 10 entries;
 * only the most recent TRANSLATION_HISTORY_CONTEXT_TURNS of those are
 * actually sent as context on each call (see the AUDIO_CHUNK handler) -
 * the rest are kept only so the context window can grow back up after a
 * translation that produced an unusually short/empty result. */
interface TranslationHistoryEntry {
  transcript: string;
  translation: string;
}
const MAX_TRANSLATION_HISTORY = 10;
const TRANSLATION_HISTORY_CONTEXT_TURNS = 3;
let translationHistory: TranslationHistoryEntry[] = [];

/** "Video from example.com: How to Debone a Chicken" - fed into whisper's
 * own --prompt (see whisperTranscribe.ts) as a prior for domain-specific
 * vocabulary and proper nouns. Built fresh per chunk (title can change
 * mid-session, e.g. a video site's title updates once metadata loads)
 * rather than cached, since it's cheap and this only runs once every few
 * seconds anyway. */
function buildPageContext(wm: WindowManager): string {
  const nav = wm.tabs.getActiveNavState();
  if (!nav || !nav.title) return '';
  let hostname = '';
  try {
    hostname = new URL(nav.url).hostname;
  } catch {
    // Internal pages (new tab, etc.) have no real URL to parse - title
    // alone is still useful context, so this isn't fatal.
  }
  return hostname ? `Video from ${hostname}: ${nav.title}.` : `Video: ${nav.title}.`;
}

/** How many screenshots to show on each side of the one being viewed. */
const CHAIN_RADIUS = 2;

/** The room URL resyncChatSession last broadcast ROOM_CHANGED/a cleared
 * MESSAGES for - lets it tell "the room actually changed" apart from
 * "something else triggered a resync but the room's the same" (see its
 * own doc comment). */
let lastResolvedRoomUrl: string | null = null;

function currentThemePayload(): ThemePayload {
  return { source: nativeTheme.themeSource, isDark: nativeTheme.shouldUseDarkColors };
}

/** ChatServerMessage (the wire shape from chatClient.ts) -> ChatMessage
 * (the app's own display shape) - sender/content map to username/text,
 * the only translation point for that (see main/chatSession.ts). */
function toChatMessage(m: ChatServerMessage): ChatMessage {
  return { id: m.id, username: m.sender, text: m.content, timestamp: m.timestamp };
}

/** override ?? the global default - the same resolution rule
 * resyncChatSession uses to pick a server, exposed separately so
 * ACTIVE_CHAT_SERVER broadcasts can report it without re-deriving a whole
 * ChatIdentity. */
function resolveEffectiveServerId(wm: WindowManager): string | null {
  return wm.tabs.getActiveChatServerId() ?? getDefaultChatServerId();
}

export function registerIpcHandlers(wm: WindowManager): void {
  // The single active chat-service polling session (see chatSession.ts) -
  // registered once here, reused across every resync for this window's
  // lifetime, translating its wire-shape messages to the app's ChatMessage
  // shape on the way out to the chat renderer.
  chatSession.initChatSession({
    onStatusChanged: (status) => {
      // A username-taken failure needs the user to actually see it, not
      // silently render "full-screen" inside a chat panel they never
      // opened - unlike the image lightbox (which can only ever be
      // triggered from inside an already-open panel), this can fire from
      // a background reconnect (a nav, a server-config edit) at any time.
      // wm.toggleChat() attaches the chat view synchronously (before this
      // status even reaches the renderer), so by the time its own
      // setOverlayOpen(true) call comes back, WindowManager.setChatFullscreen
      // no longer sees a detached view to (correctly, normally) no-op on.
      if (status.reason === 'username-taken' && !wm.isChatOpen()) wm.toggleChat();
      wm.chatView.webContents.send(IPC.CHAT_CONNECTION_STATUS, status);
    },
    onMessages: (url, messages) => {
      wm.chatView.webContents.send(IPC.MESSAGES, { url, list: messages.map(toChatMessage) });
    },
    // Keeps the cached token current so the NEXT /connect for this server
    // - a second tab, a different room, this app after a restart - can
    // reuse it (PROTOCOL.md's `token` path) instead of re-asserting
    // `username`, which only ever succeeds once per server, ever, and
    // would 409 on every attempt after the first.
    onTokenIssued: (serverId, token) => setChatServerToken(serverId, token),
    // The cached token stopped working (see chatSession.ts's own doc
    // comment on this - a rare operational case) - forget it so the next
    // attempt doesn't keep presenting the same bad one.
    onTokenInvalid: (serverId) => clearChatServerToken(serverId),
  });

  // --- chrome -> main ---
  ipcMain.on(IPC.NEW_TAB, (_event, url?: string) => wm.tabs.newTab(url));
  ipcMain.on(IPC.CLOSE_TAB, (_event, id: string) => wm.tabs.closeTab(id));
  ipcMain.on(IPC.SWITCH_TAB, (_event, id: string) => wm.tabs.switchTab(id));
  ipcMain.on(IPC.NAVIGATE, (_event, url: string) => wm.tabs.navigate(url));
  ipcMain.on(IPC.GO_BACK, () => wm.tabs.goBack());
  ipcMain.on(IPC.GO_FORWARD, () => wm.tabs.goForward());
  ipcMain.on(IPC.RELOAD, () => wm.tabs.reload());
  ipcMain.on(IPC.TOGGLE_CHAT, () => wm.toggleChat());
  // Local (non-blocking) chrome modals - e.g. Settings - need the same
  // full-window trick as the mandatory username prompt, since the chrome
  // view is normally clipped to CHROME_HEIGHT. See setChromeFullscreen.
  ipcMain.on(IPC.SET_CHROME_OVERLAY, (_event, open: boolean) => wm.setChromeFullscreen(open));
  ipcMain.on(IPC.SET_TOOLBAR_POPOVER_OPEN, (_event, open: boolean) => wm.setToolbarPopoverOpen(open));

  ipcMain.on(IPC.SET_SAFETY_SETTINGS, (_event, settings: SafetySettings) => {
    saveSafetySettings(settings);
    wm.chromeView.webContents.send(IPC.SAFETY_SETTINGS, settings);
    wm.chatView.webContents.send(IPC.SAFETY_SETTINGS, settings);
  });

  ipcMain.on(IPC.SET_DOMAIN_TRUST, (_event, lists: DomainTrustLists) => {
    setDomainTrustLists(lists);
    wm.chromeView.webContents.send(IPC.DOMAIN_TRUST, lists);
    wm.chatView.webContents.send(IPC.DOMAIN_TRUST, lists);
  });

  ipcMain.on(IPC.SET_PROXY_SETTINGS, (_event, settings: ProxySettings) => {
    saveProxySettings(settings);
    void applyProxySettings(settings);
    wm.chromeView.webContents.send(IPC.PROXY_SETTINGS, settings);
  });

  const broadcastTheme = () => {
    const payload = currentThemePayload();
    wm.win.setBackgroundColor(payload.isDark ? PAPER_DARK : PAPER_LIGHT);
    wm.chromeView.webContents.send(IPC.THEME, payload);
    wm.chatView.webContents.send(IPC.THEME, payload);
  };

  ipcMain.on(IPC.SET_THEME, (_event, source: ThemeSource) => {
    saveThemeSource(source);
    nativeTheme.themeSource = source;
    broadcastTheme(); // explicit, in case 'updated' doesn't fire (isDark unchanged)
  });

  // Covers the OS theme itself changing while we're in 'system' mode.
  nativeTheme.on('updated', broadcastTheme);

  // The chrome view asks for a full state sync once its React app mounts,
  // rather than main guessing when the renderer is ready to receive it.
  ipcMain.on(IPC.CHROME_READY, () => {
    wm.chromeView.webContents.send(IPC.SAFETY_SETTINGS, loadSafetySettings());
    wm.chromeView.webContents.send(IPC.THEME, currentThemePayload());
    wm.chromeView.webContents.send(IPC.DOMAIN_TRUST, getDomainTrustLists());
    wm.chromeView.webContents.send(IPC.PROXY_SETTINGS, loadProxySettings());
    wm.chromeView.webContents.send(IPC.TABS_UPDATED, wm.tabs.getTabsPayload());
    wm.chromeView.webContents.send(IPC.BOOKMARKS_UPDATED, getBookmarks());
    wm.chromeView.webContents.send(IPC.BOOKMARK_FOLDERS_UPDATED, getFolders());
    wm.chromeView.webContents.send(IPC.DOWNLOADS_UPDATED, getDownloads());
    const nav = wm.tabs.getActiveNavState();
    if (nav) wm.chromeView.webContents.send(IPC.NAV_STATE, nav);
    wm.chromeView.webContents.send(IPC.SUBTITLE_SETTINGS, wm.tabs.getActiveSubtitleSettings());
    wm.chromeView.webContents.send(IPC.PAGE_TRANSLATE_SETTINGS, wm.tabs.getActivePageTranslateSettings());
    // Status is transient, not tracked per-tab the way settings are (see
    // PageTranslateStatus's doc comment) - a fresh chrome mount has no way
    // to know if a translation happens to be mid-flight right now, so it
    // starts idle regardless and just picks up the next real status push.
    wm.chromeView.webContents.send(IPC.PAGE_TRANSLATE_STATUS, { status: 'idle' });
    void getWhisperStatus(true).then((status) => wm.chromeView.webContents.send(IPC.WHISPER_STATUS, status));
  });

  // No broadcast back for delete/clear - the History section already
  // updates its own local list optimistically (see HistorySection.tsx).
  ipcMain.on(IPC.DELETE_HISTORY_ENTRY, (_event, id: string) => deleteEntry(id));
  ipcMain.on(IPC.CLEAR_HISTORY, () => clearHistory());

  // --- Privacy & Data (Settings > Privacy & Data) ---
  ipcMain.on(IPC.REQUEST_DATA_USAGE_SUMMARY, () => {
    wm.chromeView.webContents.send(IPC.DATA_USAGE_SUMMARY, {
      historyCount: getHistoryCount(),
      bookmarkCount: getBookmarks().length,
      agentThreadCount: getThreads().length,
    });
  });

  ipcMain.on(IPC.CLEAR_ALL_BOOKMARKS, () => {
    clearAllBookmarks();
    wm.chromeView.webContents.send(IPC.BOOKMARKS_UPDATED, getBookmarks());
    wm.chromeView.webContents.send(IPC.BOOKMARK_FOLDERS_UPDATED, getFolders());
  });

  ipcMain.on(IPC.CLEAR_ALL_AGENT_THREADS, () => {
    // Same defensive step DELETE_AGENT_THREAD takes per-thread, just for
    // all of them at once - an in-flight stream still writing to a thread
    // that's about to disappear would otherwise persist a message for a
    // thread id that no longer exists.
    for (const controller of activeAgentStreams.values()) controller.abort();
    activeAgentStreams.clear();
    clearAllThreads();
    wm.chatView.webContents.send(IPC.AGENT_THREADS, getThreads());
  });

  ipcMain.on(IPC.REQUEST_HISTORY_PAGE, (_event, req: HistoryPageRequest) => {
    const { entries, hasMore } = getHistoryPage(req.offset, req.limit, req.query);
    wm.chromeView.webContents.send(IPC.HISTORY_PAGE, { entries, offset: req.offset, hasMore, query: req.query });
  });

  ipcMain.on(IPC.TOGGLE_BOOKMARK, (_event, payload: ToggleBookmarkPayload) => {
    toggleBookmark(payload.url, payload.title);
    wm.chromeView.webContents.send(IPC.BOOKMARKS_UPDATED, getBookmarks());
  });

  ipcMain.on(IPC.DELETE_BOOKMARK, (_event, id: string) => {
    removeBookmark(id);
    wm.chromeView.webContents.send(IPC.BOOKMARKS_UPDATED, getBookmarks());
  });

  ipcMain.on(IPC.RENAME_BOOKMARK, (_event, payload: RenameBookmarkPayload) => {
    renameBookmark(payload.id, payload.title);
    wm.chromeView.webContents.send(IPC.BOOKMARKS_UPDATED, getBookmarks());
  });

  ipcMain.on(IPC.MOVE_BOOKMARK, (_event, payload: MoveBookmarkPayload) => {
    moveBookmark(payload.id, payload.folderId);
    wm.chromeView.webContents.send(IPC.BOOKMARKS_UPDATED, getBookmarks());
  });

  ipcMain.on(IPC.CREATE_BOOKMARK_FOLDER, (_event, payload: CreateBookmarkFolderPayload) => {
    createFolder(payload.name, payload.parentId);
    wm.chromeView.webContents.send(IPC.BOOKMARK_FOLDERS_UPDATED, getFolders());
  });

  ipcMain.on(IPC.RENAME_BOOKMARK_FOLDER, (_event, payload: RenameBookmarkFolderPayload) => {
    renameFolder(payload.id, payload.name);
    wm.chromeView.webContents.send(IPC.BOOKMARK_FOLDERS_UPDATED, getFolders());
  });

  ipcMain.on(IPC.DELETE_BOOKMARK_FOLDER, (_event, id: string) => {
    deleteFolder(id);
    wm.chromeView.webContents.send(IPC.BOOKMARK_FOLDERS_UPDATED, getFolders());
    wm.chromeView.webContents.send(IPC.BOOKMARKS_UPDATED, getBookmarks());
  });

  ipcMain.on(IPC.IMPORT_BOOKMARKS, () => {
    void (async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(wm.win, {
        title: 'Import bookmarks',
        buttonLabel: 'Import',
        filters: [{ name: 'Bookmarks', extensions: ['html', 'htm'] }],
        properties: ['openFile'],
      });
      if (canceled || filePaths.length === 0) return;

      try {
        const html = fs.readFileSync(filePaths[0], 'utf-8');
        const summary = importBookmarksFromHtml(html);
        wm.chromeView.webContents.send(IPC.BOOKMARK_IMPORT_RESULT, { ok: true, ...summary });
        wm.chromeView.webContents.send(IPC.BOOKMARK_FOLDERS_UPDATED, getFolders());
        wm.chromeView.webContents.send(IPC.BOOKMARKS_UPDATED, getBookmarks());
      } catch (err) {
        wm.chromeView.webContents.send(IPC.BOOKMARK_IMPORT_RESULT, {
          ok: false,
          bookmarkCount: 0,
          folderCount: 0,
          skipped: 0,
          error: err instanceof Error ? err.message : 'That file could not be read as a bookmark export.',
        });
      }
    })();
  });

  // No broadcast here - wm.setSubtitleSettings -> TabManager.setActiveSubtitleSettings
  // fires onActiveSubtitleSettingsChanged, which both attaches/detaches
  // the overlay view (WindowManager) and pushes IPC.SUBTITLE_SETTINGS
  // back to chrome (main/index.ts) - one path, not two.
  ipcMain.on(IPC.SET_SUBTITLE_SETTINGS, (_event, settings: SubtitleSettings) => {
    wm.setSubtitleSettings(settings);
    // Fresh start each time translate turns on - carrying stale context
    // from a previous video/language into a new session would do more
    // harm than good (see the AUDIO_CHUNK handler's use of this).
    if (!settings.enabled) {
      lastTranscript = '';
      translationHistory = [];
    }
  });

  // Same one-path-not-two reasoning as SET_SUBTITLE_SETTINGS above -
  // wm.setPageTranslateSettings -> TabManager.setActivePageTranslateSettings
  // both drives the tab's own preload directly and fires the broadcast
  // back to chrome (main/index.ts).
  // wm.setPageTranslateSettings -> TabManager's onActivePageTranslateSettingsChanged
  // callback (see main/index.ts) also resets the status broadcast to
  // 'idle' - nothing's in flight yet the instant settings change either
  // way (a real 'translating' push, if one's coming, always follows
  // asynchronously once the tab's preload actually responds).
  ipcMain.on(IPC.SET_PAGE_TRANSLATE_SETTINGS, (_event, settings: PageTranslateSettings) => {
    wm.setPageTranslateSettings(settings);
  });

  // A tab's own preload (see preload/pageTranslate.ts) found text that
  // needs translating - either the initial full-page walk right after
  // PAGE_TRANSLATE_ENABLE, or a later batch its MutationObserver picked up
  // from SPA content rendering in. `event.sender` is that exact tab's own
  // WebContents - both which settings to translate with and where to send
  // the result come from it directly, no separate tab-id needed.
  ipcMain.on(IPC.PAGE_TRANSLATE_EXTRACTED, (event, payload: PageTranslateExtractedPayload) => {
    const tab = wm.tabs.getTabByWebContents(event.sender);
    // Tab closed, or translate got turned off, in the gap between the
    // preload sending this and it arriving here - nothing to do.
    if (!tab || !tab.settings.enabled || !tab.settings.agentId) return;
    const { agentId, language } = tab.settings;
    const isActiveTab = wm.tabs.getActiveView()?.webContents === event.sender;

    // Only the initial full-page walk drives the visible status - a
    // MutationObserver top-up re-flashing the spinner for every minor SPA
    // content change would be more distracting than informative.
    if (payload.initial && isActiveTab) {
      wm.chromeView.webContents.send(IPC.PAGE_TRANSLATE_STATUS, { status: 'translating' });
    }

    void translatePageBatch(agentId, payload.entries, language)
      .then((translated) => {
        if (event.sender.isDestroyed()) return;
        if (translated.length > 0) event.sender.send(IPC.PAGE_TRANSLATE_APPLY, translated);
        if (payload.initial && isActiveTab) {
          // A batch that resolved with nothing at all despite non-empty
          // input means every line failed to parse/translate - worth
          // surfacing as an error rather than silently looking "done" with
          // untranslated text still showing.
          const failed = payload.entries.length > 0 && translated.length === 0;
          wm.chromeView.webContents.send(IPC.PAGE_TRANSLATE_STATUS, {
            status: failed ? 'error' : 'done',
            error: failed ? 'Translation failed - the agent returned nothing usable.' : undefined,
          });
        }
      })
      .catch((err) => {
        console.error('[page translate] failed:', err);
        if (payload.initial && isActiveTab) {
          wm.chromeView.webContents.send(IPC.PAGE_TRANSLATE_STATUS, {
            status: 'error',
            error: err instanceof Error ? err.message : 'Translation failed.',
          });
        }
      });
  });

  // forceRefresh bypasses getWhisperStatus's cache (see whisperStore.ts) -
  // only worth paying for a fresh `whisper-cli --help` subprocess spawn
  // when something that could actually change the answer just happened
  // (the config was edited) or the renderer explicitly asked for an
  // up-to-date read (e.g. Settings mounting). Everything else, notably the
  // once-every-~5s AUDIO_CHUNK path, reads the cache instead.
  const broadcastWhisperStatus = (forceRefresh = false) => {
    void getWhisperStatus(forceRefresh).then((status) => wm.chromeView.webContents.send(IPC.WHISPER_STATUS, status));
  };

  ipcMain.on(IPC.REQUEST_WHISPER_STATUS, () => broadcastWhisperStatus(true));

  ipcMain.on(IPC.SET_WHISPER_CONFIG, (_event, config: WhisperConfig) => {
    saveWhisperConfig(config);
    invalidateWhisperStatusCache();
    broadcastWhisperStatus(true);
  });

  ipcMain.on(IPC.PICK_WHISPER_MODEL, () => {
    void (async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(wm.win, {
        title: 'Select a whisper.cpp model',
        buttonLabel: 'Select',
        filters: [{ name: 'GGML model', extensions: ['bin'] }],
        properties: ['openFile'],
      });
      if (canceled || filePaths.length === 0) return;
      saveWhisperConfig({ ...loadWhisperConfig(), modelPath: filePaths[0] });
      invalidateWhisperStatusCache();
      broadcastWhisperStatus(true);
    })();
  });

  ipcMain.on(IPC.PICK_WHISPER_TRANSLATE_MODEL, () => {
    void (async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(wm.win, {
        title: 'Select a whisper.cpp model for translation (must support the -tr task, e.g. not large-v3-turbo)',
        buttonLabel: 'Select',
        filters: [{ name: 'GGML model', extensions: ['bin'] }],
        properties: ['openFile'],
      });
      if (canceled || filePaths.length === 0) return;
      saveWhisperConfig({ ...loadWhisperConfig(), translateModelPath: filePaths[0] });
      invalidateWhisperStatusCache();
      broadcastWhisperStatus(true);
    })();
  });

  // Live translate's actual pipeline: one WAV chunk in (see
  // renderer/chrome/audioCapture.ts) -> whisper.cpp transcribes it -> the
  // translated line goes up on the overlay.
  //
  // settings.engine picks which of three paths runs - explicitly chosen in
  // the popover (see shared/types.ts's SubtitleSettings doc comment), never
  // auto-selected. An agent (the third path) generally beats whisper's own
  // -tr even when the target IS English - confirmed by hand: whisper's own
  // -tr on the tiny model hallucinates badly on real non-English speech -
  // "Thank you for watching" and the bracketed placeholder "(Speaking
  // foreign language)" for content that has nothing to do with either.
  // Whisper transcribing in the ORIGINAL language and handing that off to
  // an actual LLM agent to translate produced a correct, coherent result
  // on the exact same audio that made -tr hallucinate - but it's the
  // user's explicit choice now, not an automatic fallback.
  //
  // Chunks are dropped (not queued) while a previous one is still being
  // processed - for live captions, catching up to fresher audio beats
  // grinding through an ever-growing backlog of stale ones.
  let audioChunkBusy = false;
  ipcMain.on(IPC.AUDIO_CHUNK, (_event, wavBytes: Uint8Array) => {
    if (audioChunkBusy) return;
    audioChunkBusy = true;
    void (async () => {
      try {
        const status = await getWhisperStatus();
        if (!status.ready || !status.effectiveBinaryPath || !status.modelPath) return;

        const settings = wm.tabs.getActiveSubtitleSettings();
        if (!settings.enabled) return;

        // What page this even is - rides in whisper's own --prompt (see
        // whisperTranscribe.ts's doc comment) so it has a real prior for
        // domain-specific vocabulary/proper nouns from the very first
        // chunk, not just whatever continuity previousText builds up.
        const pageContext = buildPageContext(wm);

        if (settings.engine === WHISPER_ENGINE) {
          // Plain transcription, no translation at all - captions come out
          // in whatever language is actually spoken.
          const transcript = await transcribeWavChunk(
            status.effectiveBinaryPath,
            status.modelPath,
            wavBytes,
            false,
            lastTranscript,
            pageContext,
          );
          if (transcript) {
            lastTranscript = transcript;
            wm.pushSubtitleText(transcript);
          }
          return;
        }

        if (settings.engine === WHISPER_TRANSLATE_ENGINE) {
          // Not every model tier supports whisper's own -tr task -
          // large-v3-turbo in particular silently just transcribes instead
          // of translating (see WhisperConfig.translateModelPath's doc
          // comment) - so a dedicated translate-capable model, if one's
          // configured, takes priority over the main model here specifically.
          const translateModel =
            status.translateModelPath && status.translateModelExists ? status.translateModelPath : status.modelPath;
          const translated = await transcribeWavChunk(
            status.effectiveBinaryPath,
            translateModel,
            wavBytes,
            true,
            lastTranscript,
            pageContext,
          );
          if (translated) {
            lastTranscript = translated;
            wm.pushSubtitleText(translated);
          }
          return;
        }

        // Otherwise engine is a real agent's id - whisper transcribes in
        // the original language (prompt context below stays in that
        // language too, feeding back into whisper's own next call, not the
        // translation agent), then the agent translates that to `language`.
        const transcript = await transcribeWavChunk(
          status.effectiveBinaryPath,
          status.modelPath,
          wavBytes,
          false,
          lastTranscript,
          pageContext,
        );
        if (!transcript) return; // silence/no speech in this chunk - leave the last caption showing rather than blank it
        lastTranscript = transcript;

        // The last few (transcript, translation) pairs, oldest first, as
        // regular chat turns - gives the model continuity across chunk
        // boundaries (pronouns, dropped subjects, terminology set a few
        // lines ago) it otherwise has no way to see.
        const contextEntries = translationHistory.slice(-TRANSLATION_HISTORY_CONTEXT_TURNS);
        const history = contextEntries.flatMap((entry) => [
          { role: 'user' as const, text: entry.transcript },
          { role: 'assistant' as const, text: entry.translation },
        ]);

        const translated = await translateText(settings.engine, transcript, settings.language, history);
        if (translated) {
          wm.pushSubtitleText(translated);
          translationHistory.push({ transcript, translation: translated });
          if (translationHistory.length > MAX_TRANSLATION_HISTORY) translationHistory.shift();
        }
      } catch (err) {
        console.error('[live translate] chunk failed:', err);
      } finally {
        audioChunkBusy = false;
      }
    })();
  });

  ipcMain.on(IPC.FIND_IN_PAGE, (_event, payload: FindInPagePayload) => {
    const wc = wm.tabs.getActiveView()?.webContents;
    if (!wc) return;
    if (!payload.text) {
      wc.stopFindInPage('clearSelection');
      return;
    }
    wc.findInPage(payload.text, { forward: payload.forward, findNext: payload.findNext });
  });

  ipcMain.on(IPC.CLOSE_FIND_BAR, () => wm.closeFindBar());

  ipcMain.on(IPC.CANCEL_DOWNLOAD, (_event, id: string) => cancelDownload(id));

  ipcMain.on(IPC.OPEN_DOWNLOAD, (_event, id: string) => {
    const record = getDownloads().find((d) => d.id === id);
    if (record) void shell.openPath(record.savePath);
  });

  ipcMain.on(IPC.SHOW_DOWNLOAD_IN_FOLDER, (_event, id: string) => {
    const record = getDownloads().find((d) => d.id === id);
    if (record) shell.showItemInFolder(record.savePath);
  });

  ipcMain.on(IPC.CLEAR_DOWNLOADS, () => {
    clearFinished();
    wm.chromeView.webContents.send(IPC.DOWNLOADS_UPDATED, getDownloads());
  });

  ipcMain.on(IPC.PERMISSION_RESPONSE, (_event, payload: PermissionResponsePayload) => {
    resolvePermissionRequest(payload.requestId, payload.allow, payload.remember);
  });

  ipcMain.on(IPC.REQUEST_SITE_PERMISSIONS, () => {
    wm.chromeView.webContents.send(IPC.SITE_PERMISSIONS, getAllSitePermissions());
  });

  ipcMain.on(IPC.SET_SITE_PERMISSION, (_event, payload: SetSitePermissionPayload) => {
    setDecision(payload.origin, payload.capability, payload.decision);
    wm.chromeView.webContents.send(IPC.SITE_PERMISSIONS, getAllSitePermissions());
  });

  ipcMain.on(IPC.RESET_SITE_PERMISSIONS, (_event, origin: string) => {
    resetOrigin(origin);
    wm.chromeView.webContents.send(IPC.SITE_PERMISSIONS, getAllSitePermissions());
  });

  // Agent configs (Settings > Agents) are relevant to both surfaces - chat
  // needs the list too, to populate its thread-starter picker.
  const broadcastAgents = () => {
    const configs = getAgentConfigs();
    wm.chromeView.webContents.send(IPC.AGENTS_UPDATED, configs);
    wm.chatView.webContents.send(IPC.AGENTS_UPDATED, configs);
  };

  ipcMain.on(IPC.REQUEST_AGENTS, () => broadcastAgents());

  ipcMain.on(IPC.CREATE_AGENT, (_event, payload: AddAgentPayload) => {
    addAgent(payload);
    broadcastAgents();
  });

  ipcMain.on(IPC.UPDATE_AGENT, (_event, payload: UpdateAgentPayload) => {
    updateAgent(payload);
    broadcastAgents();
  });

  ipcMain.on(IPC.DELETE_AGENT, (_event, id: string) => {
    removeAgent(id);
    broadcastAgents();
  });

  // MCP servers (Settings > MCP) - chrome-only, unlike agent configs the
  // chat panel never needs the raw list, only the transient "Working…"
  // status text a tool call produces (see handleSendAgentMessage below).
  const broadcastMcpServers = () => {
    wm.chromeView.webContents.send(IPC.MCP_SERVERS_UPDATED, getMcpServers());
  };

  ipcMain.on(IPC.REQUEST_MCP_SERVERS, () => broadcastMcpServers());

  ipcMain.on(IPC.CREATE_MCP_SERVER, (_event, payload: AddMcpServerPayload) => {
    addMcpServer(payload);
    broadcastMcpServers();
  });

  ipcMain.on(IPC.UPDATE_MCP_SERVER, (_event, payload: UpdateMcpServerPayload) => {
    // The server's config just changed - drop any cached connection so the
    // next message reconnects with the new command/url/secrets instead of
    // silently continuing to use the stale one.
    void disconnectServer(payload.id);
    updateMcpServer(payload);
    broadcastMcpServers();
  });

  ipcMain.on(IPC.DELETE_MCP_SERVER, (_event, id: string) => {
    void disconnectServer(id);
    removeMcpServer(id);
    broadcastMcpServers();
  });

  ipcMain.on(IPC.TEST_MCP_SERVER, (_event, payload: AddMcpServerPayload) => {
    void testConnection(payload).then((result) => {
      wm.chromeView.webContents.send(IPC.MCP_SERVER_TEST_RESULT, result);
    });
  });

  // Paperkite's own MCP server (Settings > MCP's "let other apps control
  // Paperkite" section) - see main/mcp/builtinServer.ts + main/mcpAuth.ts.
  const broadcastMcpTokens = () => {
    void getTokens().then((tokens) => wm.chromeView.webContents.send(IPC.MCP_TOKENS_UPDATED, tokens));
  };

  ipcMain.on(IPC.REQUEST_BUILTIN_MCP_STATUS, () => {
    wm.chromeView.webContents.send(IPC.BUILTIN_MCP_STATUS, getBuiltinServerStatus());
  });

  ipcMain.on(IPC.SET_BUILTIN_MCP_ENABLED, (_event, enabled: boolean) => {
    void setBuiltinMcpServerEnabled(wm, enabled).then(() => {
      wm.chromeView.webContents.send(IPC.BUILTIN_MCP_STATUS, getBuiltinServerStatus());
    });
  });

  ipcMain.on(IPC.REQUEST_MCP_TOKENS, () => broadcastMcpTokens());

  ipcMain.on(IPC.CREATE_MCP_TOKEN, (_event, payload: CreateMcpTokenPayload) => {
    void createToken(payload.label, payload.scopes, payload.ttlMs).then(({ token, jwt }) => {
      wm.chromeView.webContents.send(IPC.MCP_TOKEN_CREATED, { token, jwt });
      broadcastMcpTokens();
    });
  });

  ipcMain.on(IPC.REVOKE_MCP_TOKEN, (_event, jti: string) => {
    revokeToken(jti);
    broadcastMcpTokens();
  });

  // Chat servers (see main/chatServerStore.ts + PROTOCOL.md) - broadcast to
  // both chrome (Settings CRUD) and chat (the per-tab picker, which also
  // needs the list to show "(default)" against the right one).
  const broadcastChatServers = () => {
    const payload: ChatServersPayload = { servers: getChatServers(), defaultServerId: getDefaultChatServerId() };
    wm.chromeView.webContents.send(IPC.CHAT_SERVERS_UPDATED, payload);
    wm.chatView.webContents.send(IPC.CHAT_SERVERS_UPDATED, payload);
  };

  ipcMain.on(IPC.REQUEST_CHAT_SERVERS, () => broadcastChatServers());

  ipcMain.on(IPC.CREATE_CHAT_SERVER, (_event, payload: AddChatServerPayload) => {
    // null = rejected as a duplicate baseUrl (see chatServerStore.ts) -
    // the form already checks this client-side, so reaching here means
    // either a race with another edit or a caller that skipped that
    // check; either way there's nothing to broadcast, nothing changed.
    if (!addChatServer(payload)) return;
    broadcastChatServers();
    resyncChatSession(wm);
  });

  ipcMain.on(IPC.UPDATE_CHAT_SERVER, (_event, payload: UpdateChatServerPayload) => {
    if (!updateChatServer(payload)) return;
    broadcastChatServers();
    resyncChatSession(wm);
  });

  // Actually claims the username against the server's own POST /connect
  // (see PROTOCOL.md) rather than just saving whatever was typed - the
  // uniqueness check only exists server-side, so this is the only way to
  // know before the fact whether a name is really available. Reports the
  // real outcome back to chrome (see ChatServerUsernameClaimResult) so
  // the Settings field can show a spinner while this is in flight, then
  // a green check or "already claimed" inline, instead of only finding
  // out later - see chat's own UsernameTakenModal for what that felt
  // like before this existed.
  ipcMain.on(IPC.CLAIM_CHAT_SERVER_USERNAME, (_event, payload: ClaimChatServerUsernamePayload) => {
    void claimChatServerUsername(wm, payload);
  });

  ipcMain.on(IPC.DELETE_CHAT_SERVER, (_event, id: string) => {
    removeChatServer(id);
    broadcastChatServers();
    resyncChatSession(wm);
  });

  ipcMain.on(IPC.SET_DEFAULT_CHAT_SERVER, (_event, id: string) => {
    setDefaultChatServer(id);
    broadcastChatServers();
    resyncChatSession(wm);
  });

  // --- chat -> main ---
  ipcMain.on(IPC.CHAT_READY, () => {
    wm.chatView.webContents.send(IPC.SAFETY_SETTINGS, loadSafetySettings());
    wm.chatView.webContents.send(IPC.THEME, currentThemePayload());
    wm.chatView.webContents.send(IPC.DOMAIN_TRUST, getDomainTrustLists());
    broadcastChatServers();
    wm.chatView.webContents.send(IPC.CHAT_CONNECTION_STATUS, chatSession.getLastStatus());
    const url = wm.tabs.getActiveView()?.webContents.getURL();
    if (url) wm.chatView.webContents.send(IPC.ROOM_CHANGED, { url });
    wm.chatView.webContents.send(IPC.ACTIVE_CHAT_SERVER, {
      overrideServerId: wm.tabs.getActiveChatServerId(),
      effectiveServerId: resolveEffectiveServerId(wm),
    });
    wm.chatView.webContents.send(IPC.MESSAGES, { url: url ?? '', list: chatSession.getBufferedMessages().map(toChatMessage) });
  });

  ipcMain.on(IPC.SET_ACTIVE_CHAT_SERVER, (_event, id: string | null) => {
    // Fires TabManager's onActiveChatServerChanged callback, which
    // main/index.ts wires straight into resyncChatSession - one path,
    // shared with the tab-switch trigger, rather than resyncing twice here.
    wm.tabs.setActiveChatServerId(id);
  });

  // The chat view can't open Settings itself (that UI lives in the chrome
  // view, a separate renderer) - relay the request across, deep-linked to
  // the exact server that needs fixing (see UsernameTakenModal.tsx).
  ipcMain.on(IPC.REQUEST_OPEN_CHAT_SERVER_SETTINGS, (_event, serverId: string) => {
    wm.chromeView.webContents.send(IPC.OPEN_CHAT_SERVER_SETTINGS, serverId);
  });

  ipcMain.on(IPC.SEND_MESSAGE, (_event, text: string) => {
    void chatSession.sendChatMessage(text).catch((err: unknown) => {
      console.error('[chat] send failed:', err);
    });
  });

  ipcMain.on(IPC.CAPTURE_SCREENSHOT, () => {
    void captureCompressedScreenshot(wm.tabs).then((result) => {
      wm.chatView.webContents.send(IPC.SCREENSHOT_CAPTURED, result);
    });
  });

  // Chat's image lightbox needs the same full-window trick as chrome's
  // modals - the chat view is normally just a CHAT_WIDTH sidebar. See
  // WindowManager.setChatFullscreen.
  ipcMain.on(IPC.SET_CHAT_OVERLAY, (_event, open: boolean) => wm.setChatFullscreen(open));

  ipcMain.on(IPC.SAVE_IMAGE, (_event, dataUrl: string) => {
    const result = saveImageToDownloads(dataUrl, () =>
      wm.chromeView.webContents.send(IPC.DOWNLOADS_UPDATED, getDownloads()),
    );
    wm.chatView.webContents.send(IPC.IMAGE_SAVED, result);
  });

  // Composed here rather than in chatStore itself, to keep chatStore and
  // historyStore independent of each other - this is the only place that
  // needs both.
  ipcMain.on(IPC.REQUEST_SCREENSHOT_CHAIN, (_event, attachmentId: string) => {
    const chain = getScreenshotChain(attachmentId, CHAIN_RADIUS);
    if (!chain) return;
    const nodes: ScreenshotChainNode[] = chain.map((attachment, i) => ({
      id: attachment.id,
      dataUrl: attachment.dataUrl,
      url: attachment.url,
      timestamp: attachment.timestamp,
      pagesSincePrevious: i === 0 ? null : countUniquePagesBetween(chain[i - 1].timestamp, attachment.timestamp),
    }));
    wm.chatView.webContents.send(IPC.SCREENSHOT_CHAIN, { targetId: attachmentId, nodes });
  });

  // A trusted link in a chat message opens in a new tab, rather than
  // navigating the current one out from under whatever the user's
  // reading the chat about.
  ipcMain.on(IPC.OPEN_LINK, (_event, url: string) => wm.tabs.newTab(url));

  // --- agent threads (chat -> main) ---
  ipcMain.on(IPC.REQUEST_AGENT_THREADS, () => {
    wm.chatView.webContents.send(IPC.AGENT_THREADS, getThreads());
  });

  ipcMain.on(IPC.CREATE_AGENT_THREAD, (_event, agentId: string) => {
    createThread(agentId);
    wm.chatView.webContents.send(IPC.AGENT_THREADS, getThreads());
  });

  ipcMain.on(IPC.DELETE_AGENT_THREAD, (_event, threadId: string) => {
    activeAgentStreams.get(threadId)?.abort();
    activeAgentStreams.delete(threadId);
    deleteThread(threadId);
    wm.chatView.webContents.send(IPC.AGENT_THREADS, getThreads());
  });

  ipcMain.on(IPC.REQUEST_AGENT_MESSAGES, (_event, threadId: string) => {
    wm.chatView.webContents.send(IPC.AGENT_MESSAGES, { threadId, list: getAgentMessages(threadId) });
  });

  ipcMain.on(IPC.STOP_AGENT_MESSAGE, (_event, threadId: string) => {
    activeAgentStreams.get(threadId)?.abort();
  });

  ipcMain.on(IPC.SEND_AGENT_MESSAGE, (_event, payload: SendAgentMessagePayload) => {
    void handleSendAgentMessage(wm, payload);
  });

  ipcMain.on(IPC.RETRY_AGENT_MESSAGE, (_event, payload: RetryAgentMessagePayload) => {
    void handleRetryAgentMessage(wm, payload);
  });
}

/**
 * Persists + broadcasts the user's message immediately (with whatever
 * screenshot the camera button attached, if any - capture is no longer
 * automatic here, see AgentConversation.tsx), then hands off to
 * runAgentTurn for the actual streaming reply.
 */
async function handleSendAgentMessage(wm: WindowManager, payload: SendAgentMessagePayload): Promise<void> {
  const { threadId, text, attachment } = payload;
  const thread = getThreads().find((t) => t.id === threadId);
  if (!thread) return;

  const userMessage = addAgentMessage(threadId, {
    threadId,
    role: 'user',
    text,
    timestamp: Date.now(),
    attachment,
  });
  wm.chatView.webContents.send(IPC.AGENT_MESSAGE_ADDED, { threadId, message: userMessage });
  wm.chatView.webContents.send(IPC.AGENT_THREADS, getThreads());

  const history = getAgentMessages(threadId)
    .filter((m) => m.id !== userMessage.id && !m.error)
    .map((m) => ({ role: m.role, text: m.text }));

  const assistantMessage = addAgentMessage(threadId, {
    threadId,
    role: 'assistant',
    text: '',
    timestamp: Date.now(),
  });
  wm.chatView.webContents.send(IPC.AGENT_MESSAGE_ADDED, { threadId, message: assistantMessage });

  await runAgentTurn(wm, thread, assistantMessage, text, attachment, history);
}

/**
 * Re-runs a failed assistant reply in place: reuses its own id (rather
 * than creating a new user/assistant pair, which would duplicate the
 * question in the thread) and resends the same preceding user message
 * that originally triggered it, with the same history that was visible
 * at the time - not anything added since.
 */
async function handleRetryAgentMessage(wm: WindowManager, payload: RetryAgentMessagePayload): Promise<void> {
  const { threadId, messageId } = payload;
  const thread = getThreads().find((t) => t.id === threadId);
  if (!thread) return;

  const messages = getAgentMessages(threadId);
  const index = messages.findIndex((m) => m.id === messageId);
  if (index <= 0) return; // no preceding user message to resend
  const userMessage = messages[index - 1];
  if (userMessage.role !== 'user') return;

  const assistantMessage = resetMessageForRetry(threadId, messageId);
  if (!assistantMessage) return;
  wm.chatView.webContents.send(IPC.AGENT_MESSAGE_RETRY, { threadId, messageId });

  const history = messages
    .slice(0, index - 1)
    .filter((m) => !m.error)
    .map((m) => ({ role: m.role, text: m.text }));

  await runAgentTurn(wm, thread, assistantMessage, userMessage.text, userMessage.attachment, history);
}

/**
 * Streams a reply into `assistantMessage` (a placeholder for a fresh send,
 * or a just-reset failed message for a retry), gathering the current set
 * of MCP tools first and relaying "Working…" status while a tool call is
 * in flight. Shared by handleSendAgentMessage and handleRetryAgentMessage
 * so the two only differ in how they arrive at their (thread, message,
 * text, attachment, history) tuple, not in how the actual turn runs.
 */
async function runAgentTurn(
  wm: WindowManager,
  thread: AgentThread,
  assistantMessage: AgentMessage,
  newText: string,
  attachment: MessageAttachment | undefined,
  history: AgentHistoryTurn[],
): Promise<void> {
  const threadId = thread.id;

  const agentEntry = getAgentForRequest(thread.agentId);
  if (!agentEntry) {
    const error = 'This agent no longer exists - it may have been removed in Settings.';
    finalizeMessage(threadId, assistantMessage.id, error);
    wm.chatView.webContents.send(IPC.AGENT_MESSAGE_ERROR, { threadId, messageId: assistantMessage.id, error });
    return;
  }

  // Connects to (or reuses an already-connected) every configured MCP
  // server in parallel - a down/misconfigured one just contributes no
  // tools this turn rather than failing the whole send.
  const tools = await getAllAvailableTools();

  const controller = new AbortController();
  activeAgentStreams.set(threadId, controller);
  const send = getAdapter(agentEntry.config.provider);

  // A screenshot already carries "[Current page: url]" text alongside the
  // image (see each adapter's buildUserTurn) - but capture is opt-in (the
  // camera button), so a thread with no screenshot would otherwise never
  // tell the model what page it's even about. Only worth stapling on for
  // the first message: by the second, either a screenshot already said it,
  // or the model has enough conversation context to not need it repeated
  // every turn. Changes only what's sent to the model, not what's shown in
  // the chat UI or persisted - see handleSendAgentMessage, which already
  // stored/broadcast the user's own unmodified text before this runs.
  const currentUrl = wm.tabs.getActiveNavState()?.url;
  const textForModel = history.length === 0 && !attachment && currentUrl ? `[Current page: ${currentUrl}]\n\n${newText}` : newText;

  // Tracks whether a "Working…" status is currently showing, so it can be
  // cleared the moment real text resumes (or the reply finishes/errors)
  // without sending a redundant clear on every single text chunk.
  let statusActive = false;
  const clearStatus = () => {
    if (!statusActive) return;
    statusActive = false;
    wm.chatView.webContents.send(IPC.AGENT_MESSAGE_STATUS, { threadId, messageId: assistantMessage.id, status: null });
  };

  try {
    await send({
      apiKey: agentEntry.apiKey,
      baseUrl: agentEntry.config.baseUrl,
      model: agentEntry.config.model,
      systemPrompt: agentEntry.config.systemPrompt,
      history,
      newText: textForModel,
      screenshot: attachment,
      tools,
      signal: controller.signal,
      onToolCall: (serverName, toolName) => {
        statusActive = true;
        wm.chatView.webContents.send(IPC.AGENT_MESSAGE_STATUS, {
          threadId,
          messageId: assistantMessage.id,
          status: `Calling ${toolName} on ${serverName}…`,
        });
      },
      onChunk: (textDelta) => {
        clearStatus();
        appendToMessage(threadId, assistantMessage.id, textDelta);
        wm.chatView.webContents.send(IPC.AGENT_MESSAGE_CHUNK, { threadId, messageId: assistantMessage.id, textDelta });
      },
    });
    finalizeMessage(threadId, assistantMessage.id);
    wm.chatView.webContents.send(IPC.AGENT_MESSAGE_DONE, { threadId, messageId: assistantMessage.id });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    const message = aborted ? 'Stopped.' : err instanceof Error ? err.message : 'Something went wrong.';
    finalizeMessage(threadId, assistantMessage.id, aborted ? undefined : message);
    if (aborted) {
      wm.chatView.webContents.send(IPC.AGENT_MESSAGE_DONE, { threadId, messageId: assistantMessage.id });
    } else {
      wm.chatView.webContents.send(IPC.AGENT_MESSAGE_ERROR, { threadId, messageId: assistantMessage.id, error: message });
    }
  } finally {
    clearStatus();
    activeAgentStreams.delete(threadId);
    wm.chatView.webContents.send(IPC.AGENT_THREADS, getThreads());
  }
}

/** Resolves the effective (server, room, identity) for whatever's active
 * right now - the active tab's own chat-server override if it has one,
 * else the global default; the active tab's URL as the room; the
 * effective SERVER's own username (see ChatServerConfig.username's doc
 * comment - identity is per-server, not global) - and resyncs the single
 * chat-service polling session (see chatSession.ts) to match. It's a
 * no-op if none of that actually changed since the last call
 * (syncChatSession's own lastSyncKey guard). Called from every trigger
 * that could change the effective target: a nav or tab switch
 * (main/index.ts), a per-tab server override (SET_ACTIVE_CHAT_SERVER
 * above, via TabManager's onActiveChatServerChanged), and any chat-server
 * CRUD mutation (above) - including editing a server's own username.
 *
 * A server with no username set yet resolves to `identity: null`, same as
 * having no server at all - chatSession.ts treats that as "nothing to
 * connect to" (idle), not an error, since nothing was actually attempted.
 *
 * Also pushes ROOM_CHANGED + a cleared MESSAGES list to the chat renderer,
 * but only when the room URL itself actually changed - otherwise a CRUD
 * edit to some unrelated server would flash the current room's messages
 * away for no reason. */
export function resyncChatSession(wm: WindowManager): void {
  const url = wm.tabs.getActiveView()?.webContents.getURL() ?? null;
  const tabId = wm.tabs.getActiveTabId();
  const overrideServerId = wm.tabs.getActiveChatServerId();
  const effectiveServerId = resolveEffectiveServerId(wm);
  const effectiveServer = effectiveServerId ? getChatServerById(effectiveServerId) : null;

  const identity =
    url && tabId && effectiveServer?.username
      ? {
          url,
          username: effectiveServer.username,
          browser: `Paperkite/${app.getVersion()}`,
          session_id: tabId,
          region: getSystemCountryCode(),
          // Prefer reusing a cached token over asserting `username` fresh -
          // see chatSession.ts's own doc comment: a `username` claim only
          // ever succeeds once per server, ever, so every subsequent
          // connect for an identity this app already holds (a second tab,
          // a different room, a restart) needs this or it 409s.
          token: getChatServerToken(effectiveServer.id) ?? undefined,
        }
      : null;

  chatSession.syncChatSession(effectiveServer, identity);
  wm.chatView.webContents.send(IPC.ACTIVE_CHAT_SERVER, {
    overrideServerId,
    effectiveServerId: effectiveServer?.id ?? null,
  });

  if (url !== lastResolvedRoomUrl) {
    lastResolvedRoomUrl = url;
    if (url) wm.chatView.webContents.send(IPC.ROOM_CHANGED, { url });
    wm.chatView.webContents.send(IPC.MESSAGES, { url: url ?? '', list: [] });
  }
}

/** The one place a chat server's username actually gets claimed - see
 * IPC.CLAIM_CHAT_SERVER_USERNAME's own doc comment above for why this
 * calls the real server instead of just persisting the input. `url` is
 * required by POST /connect (it's "the requested room"), but the
 * uniqueness claim itself is server-wide, not room-scoped (see
 * PROTOCOL.md) - this isn't joining any real room, so the server's own
 * baseUrl is used as a harmless, always-valid placeholder. */
async function claimChatServerUsername(wm: WindowManager, { serverId, username }: ClaimChatServerUsernamePayload): Promise<void> {
  const trimmed = username.trim();
  const respond = (result: Omit<ChatServerUsernameClaimResult, 'serverId' | 'username'>) => {
    const payload: ChatServerUsernameClaimResult = { serverId, username: trimmed, ...result };
    wm.chromeView.webContents.send(IPC.CHAT_SERVER_USERNAME_CLAIM_RESULT, payload);
  };

  const server = getChatServerById(serverId);
  if (!server) return respond({ ok: false, reason: 'error', message: 'Server not found.' });
  if (server.username) return respond({ ok: false, reason: 'error', message: 'This server already has a username set.' });
  if (!trimmed) return respond({ ok: false, reason: 'error', message: 'Enter a username.' });

  try {
    const { token } = await chatClient.connect(server.baseUrl, {
      url: server.baseUrl,
      username: trimmed,
      browser: `Paperkite/${app.getVersion()}`,
      session_id: randomUUID(),
      region: getSystemCountryCode(),
    });
    setChatServerUsername(serverId, trimmed);
    setChatServerToken(serverId, token);
    // Same broadcast the CRUD handlers above do, inlined - this function
    // lives outside their closure, so it can't reach their local
    // `broadcastChatServers`.
    const serversPayload: ChatServersPayload = { servers: getChatServers(), defaultServerId: getDefaultChatServerId() };
    wm.chromeView.webContents.send(IPC.CHAT_SERVERS_UPDATED, serversPayload);
    wm.chatView.webContents.send(IPC.CHAT_SERVERS_UPDATED, serversPayload);
    resyncChatSession(wm);
    respond({ ok: true });
  } catch (err) {
    if (err instanceof chatClient.ChatUsernameTakenError) {
      respond({ ok: false, reason: 'taken', message: 'Username already claimed, try another' });
    } else {
      respond({ ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
    }
  }
}
