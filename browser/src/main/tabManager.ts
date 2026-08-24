/**
 * Owns every tab's WebContentsView: creation, navigation, teardown, and
 * the bookkeeping (title/favicon/loading/history) that the chrome view
 * needs to render a tab strip and toolbar. Does NOT touch the BaseWindow
 * or decide what's visible on screen - that's WindowManager's job, driven
 * by the callbacks below. This split keeps "what a tab is" separate from
 * "how tabs get laid out on screen", which is the seam you'll want when
 * extending this (e.g. screenshots/CDP attach per-tab, not per-window).
 */
import {
  WebContentsView,
  BaseWindow,
  Menu,
  clipboard,
  type Event,
  type MenuItemConstructorOptions,
  type NativeImage,
  type WebContents,
} from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveAddressBarInput } from './addressBar';
import { NEW_TAB_URL } from './newTabPage';
import { buildErrorPageUrl, buildCrashPageUrl } from './errorPage';
import type { NavState, TabsUpdatedPayload, SubtitleSettings, PageTranslateSettings } from '../shared/types';
import { DEFAULT_SUBTITLE_SETTINGS, DEFAULT_PAGE_TRANSLATE_SETTINGS } from '../shared/types';
import { IPC } from '../shared/ipcChannels';

/** Navigations that don't represent a real failure - a new load
 * superseding this one, the user hitting stop, a download starting, etc.
 * None of these should show an error page. */
const ERR_ABORTED = -3;

/** Electron's zoomLevel is exponential (each whole step is roughly a 20%
 * change) - these bounds keep zoom roughly within Chrome's ~30%-500% range. */
const ZOOM_STEP = 0.5;
const MIN_ZOOM_LEVEL = -8;
const MAX_ZOOM_LEVEL = 9;

/** How many recently-closed tab URLs to remember for reopenClosedTab() -
 * in-memory only (not persisted - see sessionRestore.ts for the separate,
 * disk-backed "what was open" list), reset each app launch. */
const MAX_CLOSED_TABS = 20;

interface Tab {
  id: string;
  view: WebContentsView;
  title: string;
  /** Tracked ourselves rather than read from `webContents.getURL()` on
   * demand - mid-navigation, getURL() can lag or report the outgoing
   * page, which made the address bar flash blank/stale while loading. */
  url: string;
  favicon: string | null;
  loading: boolean;
  /** Set right before loading our own error-page data: URL, so the
   * navigation event handlers below can recognize that internal load and
   * keep showing the URL that actually failed - not our data: URL - in
   * the address bar, and not treat it as "the user browsed to a new
   * page" for chat-room purposes. Cleared once that load commits. */
  pendingErrorUrl: string | null;
  /** True only for a tab's very first page-title-updated after being
   * auto-opened at the default landing page (startup, Cmd+T, the "+"
   * button) - consumed (set false) the first time it's checked. Since
   * NEW_TAB_URL is now a real, visitable site rather than an internal
   * data: page, a plain `tab.url === NEW_TAB_URL` check would wrongly
   * exclude every deliberate visit to that site from history too, not
   * just the auto-opened landing tab. */
  skipNextHistoryRecord: boolean;
  /** Live-translation subtitle overlay settings - per-tab so turning it
   * on for one video doesn't leak into unrelated tabs. */
  subtitles: SubtitleSettings;
  /** In-page text translation settings - per-tab, same reasoning as
   * subtitles. Re-sent to this tab's own preload (see
   * preload/pageTranslate.ts) on every fresh navigation while enabled -
   * see wireEvents's dom-ready handler - since a new document starts with
   * nothing translated. */
  pageTranslate: PageTranslateSettings;
  /** Which chat server (see main/chatServerStore.ts) this tab's page chat
   * connects to - null means "follow the global default". Per-tab so
   * switching servers for one page's chat doesn't affect any other tab. */
  chatServerId: string | null;
}

export interface TabManagerCallbacks {
  /** Tab list (title/favicon/loading/order) changed - push tabsUpdated. */
  onTabsChanged: () => void;
  /** The active tab's nav state (url/title/back/forward/loading) changed. */
  onActiveNavStateChanged: () => void;
  /** The active tab navigated to a new URL - chat room may need to change. */
  onActiveUrlChanged: (url: string) => void;
  /** The active tab's WebContentsView itself changed (switch/close/new) -
   * WindowManager should swap which view is attached to the window. */
  onActiveViewChanged: (view: WebContentsView | null) => void;
  /** Any tab's title settled after a real navigation (not the new-tab
   * page, not an error page) - the browsing-history hook. Fired from
   * page-title-updated rather than did-navigate so the title recorded is
   * accurate, not the outgoing page's stale one. */
  onPageVisited: (url: string, title: string) => void;
  /** A find-in-page search on the active tab produced (or updated) a
   * result - forwarded to the chrome renderer's find bar. */
  onFindResult: (activeMatchOrdinal: number, matches: number) => void;
  /** The active tab's page requested (or exited) HTML fullscreen - e.g. a
   * video player's own fullscreen button. WindowManager reacts by growing
   * the page view to cover the whole window and taking the OS window
   * fullscreen too - see setBrowserFullscreen. */
  onRequestFullscreen: (active: boolean) => void;
  /** The active tab's subtitle settings changed - either the user edited
   * them (see setActiveSubtitleSettings), or the active tab itself just
   * switched to one with different settings. WindowManager reacts by
   * attaching/detaching the subtitle overlay view. */
  onActiveSubtitleSettingsChanged: (settings: SubtitleSettings) => void;
  /** The active tab's page-translate settings changed - either the user
   * edited them (see setActivePageTranslateSettings), or the active tab
   * itself just switched to one with different settings. Purely a state
   * broadcast (see main/index.ts) - unlike subtitles there's no separate
   * overlay view to attach/detach, TabManager drives the tab's own
   * preload directly (see setActivePageTranslateSettings/wireEvents). */
  onActivePageTranslateSettingsChanged: (settings: PageTranslateSettings) => void;
  /** The active tab's chat server override changed - a tab switch, a
   * same-tab edit (see setActiveChatServerId), or a navigation (the room
   * itself changed, even if the server override didn't) all fire this, so
   * main/index.ts can resync the one active chat-service polling session
   * (see main/chatSession.ts) to whatever's now current. */
  onActiveChatServerChanged: (serverId: string | null) => void;
}

export class TabManager {
  private tabs = new Map<string, Tab>();
  private order: string[] = [];
  private activeId: string | null = null;
  /** Most-recently-closed last (a stack) - see closeTab/reopenClosedTab. */
  private closedTabUrls: string[] = [];

  /** Needed for Menu.popup({ window }) - see the context-menu handler in
   * wireEvents(). Nothing else here touches the window directly. */
  constructor(private win: BaseWindow, private callbacks: TabManagerCallbacks) {}

  newTab(url?: string): string {
    const id = randomUUID();
    const isDefaultLanding = url === undefined;
    const view = new WebContentsView({
      webPreferences: {
        // Only ever talks to main over plain ipcRenderer, in its own
        // isolated context - no contextBridge, nothing exposed into this
        // (untrusted) page's own JS. See preload/pageTranslate.ts.
        preload: path.join(__dirname, 'pageTranslate.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const tab: Tab = {
      id,
      view,
      title: 'New Tab',
      url: url ?? NEW_TAB_URL,
      favicon: null,
      loading: true,
      pendingErrorUrl: null,
      skipNextHistoryRecord: isDefaultLanding,
      subtitles: DEFAULT_SUBTITLE_SETTINGS,
      pageTranslate: DEFAULT_PAGE_TRANSLATE_SETTINGS,
      chatServerId: null,
    };
    this.tabs.set(id, tab);
    this.order.push(id);
    this.wireEvents(tab);
    void view.webContents.loadURL(tab.url);

    this.switchTab(id);
    this.callbacks.onTabsChanged();
    return id;
  }

  /** Recreates the tab list from a previous session (see
   * main/sessionRestore.ts) instead of the single fresh new-tab page
   * newTab() defaults to - called once at startup in place of that, never
   * alongside it. Each URL becomes a real tab via newTab(url), which
   * preserves order (it appends) but also switches to each one as it's
   * created; the explicit switchTab at the end corrects that to whichever
   * tab was actually active when the session was saved. */
  restoreTabs(urls: string[], activeIndex: number): void {
    if (urls.length === 0) {
      this.newTab();
      return;
    }
    const ids = urls.map((url) => this.newTab(url));
    const targetId = ids[activeIndex] ?? ids[0];
    this.switchTab(targetId);
  }

  closeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;

    // Skip a blank new-tab page - there's nothing meaningful to reopen.
    if (tab.url !== NEW_TAB_URL) {
      this.closedTabUrls.push(tab.url);
      if (this.closedTabUrls.length > MAX_CLOSED_TABS) this.closedTabUrls.shift();
    }

    const wasActive = this.activeId === id;
    this.order = this.order.filter((tabId) => tabId !== id);
    this.tabs.delete(id);
    tab.view.webContents.close();

    if (wasActive) {
      const next = this.order[0] ?? null;
      if (next) {
        this.switchTab(next);
      } else {
        // Never leave the browser with zero tabs.
        this.newTab();
        return;
      }
    }
    this.callbacks.onTabsChanged();
  }

  /** Cmd+Shift+T (see main/appMenu.ts) - no-ops if nothing's been closed
   * this session. */
  reopenClosedTab(): void {
    const url = this.closedTabUrls.pop();
    if (url) this.newTab(url);
  }

  switchTab(id: string): void {
    if (!this.tabs.has(id) || this.activeId === id) return;
    this.activeId = id;
    const tab = this.tabs.get(id)!;
    this.callbacks.onActiveViewChanged(tab.view);
    this.callbacks.onTabsChanged();
    this.callbacks.onActiveNavStateChanged();
    this.callbacks.onActiveUrlChanged(tab.url);
    this.callbacks.onActiveSubtitleSettingsChanged(tab.subtitles);
    this.callbacks.onActivePageTranslateSettingsChanged(tab.pageTranslate);
    this.callbacks.onActiveChatServerChanged(tab.chatServerId);
  }

  /** Cmd+1…9 (see main/appMenu.ts) - `index` is 0-based (0-7 for Cmd+1…8).
   * Cmd+9 always jumps to the LAST tab regardless of count, matching
   * Chrome's own convention rather than literally meaning "tab at index
   * 8" - callers pass 8 for that key and this resolves it. */
  switchToTabAtIndex(index: number): void {
    const targetIndex = index === 8 ? this.order.length - 1 : index;
    const id = this.order[targetIndex];
    if (id) this.switchTab(id);
  }

  navigate(input: string): void {
    const tab = this.activeTab();
    if (!tab) return;
    void tab.view.webContents.loadURL(resolveAddressBarInput(input));
  }

  goBack(): void {
    const wc = this.activeTab()?.view.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward(): void {
    const wc = this.activeTab()?.view.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(): void {
    const wc = this.activeTab()?.view.webContents;
    if (!wc) return;
    wc.isLoading() ? wc.stop() : wc.reload();
  }

  /** Detached mode opens DevTools in its own OS window rather than
   * docking inside our fixed-bounds page view, which has no room to
   * shrink to make space for a docked panel. */
  toggleDevTools(): void {
    const wc = this.activeTab()?.view.webContents;
    if (!wc) return;
    wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' });
  }

  zoomIn(): void {
    const wc = this.activeTab()?.view.webContents;
    if (wc) wc.setZoomLevel(Math.min(MAX_ZOOM_LEVEL, wc.getZoomLevel() + ZOOM_STEP));
  }

  zoomOut(): void {
    const wc = this.activeTab()?.view.webContents;
    if (wc) wc.setZoomLevel(Math.max(MIN_ZOOM_LEVEL, wc.getZoomLevel() - ZOOM_STEP));
  }

  zoomResetToDefault(): void {
    this.activeTab()?.view.webContents.setZoomLevel(0);
  }

  print(): void {
    this.activeTab()?.view.webContents.print();
  }

  /** Chromium's `view-source:` scheme is part of the content layer
   * Electron embeds - no custom handler needed, it just renders read-only
   * syntax-highlighted source like it does in Chrome. */
  viewSource(): void {
    const tab = this.activeTab();
    if (tab) this.newTab(`view-source:${tab.url}`);
  }

  /** Captures the active tab's current viewport, pixel for pixel - see
   * main/screenshot.ts for the compression step on top of this. */
  captureActivePage(): Promise<NativeImage> | null {
    const wc = this.activeTab()?.view.webContents;
    return wc ? wc.capturePage() : null;
  }

  getActiveView(): WebContentsView | null {
    return this.activeTab()?.view ?? null;
  }

  getActiveTabId(): string | null {
    return this.activeId;
  }

  getTabsPayload(): TabsUpdatedPayload {
    return {
      activeId: this.activeId,
      tabs: this.order.map((id) => {
        const tab = this.tabs.get(id)!;
        return {
          id: tab.id,
          title: tab.title,
          url: tab.url,
          favicon: tab.favicon,
          loading: tab.loading,
        };
      }),
    };
  }

  getActiveNavState(): NavState | null {
    const tab = this.activeTab();
    if (!tab) return null;
    const wc = tab.view.webContents;
    return {
      url: tab.url,
      title: tab.title,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: tab.loading,
    };
  }

  getActiveSubtitleSettings(): SubtitleSettings {
    return this.activeTab()?.subtitles ?? DEFAULT_SUBTITLE_SETTINGS;
  }

  setActiveSubtitleSettings(settings: SubtitleSettings): void {
    const tab = this.activeTab();
    if (!tab) return;
    tab.subtitles = settings;
    this.callbacks.onActiveSubtitleSettingsChanged(settings);
  }

  getActivePageTranslateSettings(): PageTranslateSettings {
    return this.activeTab()?.pageTranslate ?? DEFAULT_PAGE_TRANSLATE_SETTINGS;
  }

  /** Updates the active tab's page-translate settings and, if the
   * enabled/agent/language combination actually calls for it, drives that
   * tab's own preload directly (see preload/pageTranslate.ts) - there's no
   * separate overlay view to attach/detach the way subtitles has, so
   * there's nothing for WindowManager to do here beyond relaying the
   * broadcast (see onActivePageTranslateSettingsChanged). */
  setActivePageTranslateSettings(settings: PageTranslateSettings): void {
    const tab = this.activeTab();
    if (!tab) return;
    const wasEnabled = tab.pageTranslate.enabled;
    tab.pageTranslate = settings;
    this.callbacks.onActivePageTranslateSettingsChanged(settings);
    if (settings.enabled && settings.agentId) {
      tab.view.webContents.send(IPC.PAGE_TRANSLATE_ENABLE);
    } else if (wasEnabled) {
      tab.view.webContents.send(IPC.PAGE_TRANSLATE_DISABLE);
    }
  }

  /** Looks up which tab a page-translate IPC message (PAGE_TRANSLATE_EXTRACTED)
   * came from, by matching the sender's WebContents - main needs this
   * tab's current agentId/language to actually translate what it sent up,
   * and needs a WebContents to reply to (see ipc.ts). `null` if the tab's
   * since been closed out from under an in-flight request. */
  getTabByWebContents(wc: WebContents): { settings: PageTranslateSettings } | null {
    for (const tab of this.tabs.values()) {
      if (tab.view.webContents === wc) return { settings: tab.pageTranslate };
    }
    return null;
  }

  getActiveChatServerId(): string | null {
    return this.activeTab()?.chatServerId ?? null;
  }

  setActiveChatServerId(id: string | null): void {
    const tab = this.activeTab();
    if (!tab) return;
    tab.chatServerId = id;
    this.callbacks.onActiveChatServerChanged(id);
  }

  private activeTab(): Tab | undefined {
    return this.activeId ? this.tabs.get(this.activeId) : undefined;
  }

  private wireEvents(tab: Tab): void {
    const wc = tab.view.webContents;

    wc.on('did-start-loading', () => {
      tab.loading = true;
      this.callbacks.onTabsChanged();
      this.notifyIfActive(tab);
    });
    wc.on('did-stop-loading', () => {
      tab.loading = false;
      this.callbacks.onTabsChanged();
      this.notifyIfActive(tab);
    });
    // Fires as soon as a navigation is kicked off, well before it commits -
    // this is what lets the address bar show the destination immediately
    // instead of sitting blank/stale for the duration of the load.
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame) return;
      // Our own error-page load - keep showing the URL that actually
      // failed instead of the data: URL underneath the error page.
      if (details.url === tab.pendingErrorUrl) return;
      tab.url = details.url;
      this.callbacks.onTabsChanged();
      this.notifyIfActive(tab);
    });
    wc.on('page-title-updated', (_event: Event, title: string) => {
      tab.title = title;
      this.callbacks.onTabsChanged();
      this.notifyIfActive(tab);
      // Skip the auto-opened landing page's own first title (see
      // skipNextHistoryRecord) and whatever's currently showing an error
      // page - neither is a "visited page" for history purposes. Once
      // consumed, a later deliberate visit to the same URL records normally.
      if (tab.skipNextHistoryRecord) {
        tab.skipNextHistoryRecord = false;
      } else if (tab.url !== tab.pendingErrorUrl) {
        this.callbacks.onPageVisited(tab.url, title);
      }
    });
    wc.on('page-favicon-updated', (_event: Event, favicons: string[]) => {
      tab.favicon = favicons[0] ?? null;
      this.callbacks.onTabsChanged();
    });
    // The room (chat) only switches once a navigation actually commits -
    // did-start-navigation above already covers the address-bar update.
    wc.on('did-navigate', (_event: Event, url: string) => this.handleUrlChange(tab, url));
    wc.on('did-navigate-in-page', (_event: Event, url: string) => this.handleUrlChange(tab, url));

    // Fires once per real cross-document navigation (not hash changes/
    // pushState - those don't reload the preload, so there's no fresh
    // state to re-seed) - the preload re-runs fresh on every one of these,
    // meaning it's already forgotten this tab was translating. Re-tell it,
    // if this tab still has translate on, so a new document doesn't just
    // sit there untranslated until the user re-toggles it by hand.
    wc.on('dom-ready', () => {
      if (tab.pageTranslate.enabled && tab.pageTranslate.agentId) {
        wc.send(IPC.PAGE_TRANSLATE_ENABLE);
      }
    });

    // A failed navigation doesn't fire did-navigate - only this. Without
    // handling it, the tab was left showing nothing with its loading
    // spinner stuck on forever (did-stop-loading still fires, but there
    // was never anything to show).
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return;
      this.showErrorPage(tab, validatedURL, errorCode, errorDescription);
    });

    // The renderer process behind this tab died - distinct from
    // did-fail-load (a navigation failing, page process still fine).
    // Without this, a crashed tab was just a dead, blank view forever -
    // the WebContents object itself survives its renderer dying, so
    // loadURL on it (inside showCrashPage) spins up a fresh renderer
    // process rather than needing to rebuild the tab from scratch.
    wc.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return; // an intentional exit, not a crash
      if (details.reason === 'memory-eviction') {
        // Chromium reclaimed a backgrounded tab's memory - not a failure,
        // and showing a crash page for what the user will just read as
        // "the tab" being fine when they switch to it would be alarming
        // for no reason. Reload now so it's ready (or nearly) by the time
        // they do, same as how mobile browsers handle this silently.
        void wc.loadURL(tab.url);
        return;
      }
      this.showCrashPage(tab, tab.url, details.reason);
    });

    wc.on('found-in-page', (_event, result) => {
      if (tab.id === this.activeId) {
        this.callbacks.onFindResult(result.activeMatchOrdinal, result.matches);
      }
    });

    wc.on('enter-html-full-screen', () => {
      if (tab.id === this.activeId) this.callbacks.onRequestFullscreen(true);
    });
    wc.on('leave-html-full-screen', () => {
      if (tab.id === this.activeId) this.callbacks.onRequestFullscreen(false);
    });

    wc.on('context-menu', (_event, params) => {
      const items: MenuItemConstructorOptions[] = [];

      if (params.linkURL) {
        items.push(
          { label: 'Open Link in New Tab', click: () => this.newTab(params.linkURL) },
          { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
          { type: 'separator' },
        );
      }

      if (params.isEditable) {
        items.push(
          { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
          { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
          { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
          { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll },
          { type: 'separator' },
        );
      } else if (params.selectionText) {
        items.push({ label: 'Copy', role: 'copy' }, { type: 'separator' });
      }

      items.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        {
          label: 'Forward',
          enabled: wc.navigationHistory.canGoForward(),
          click: () => wc.navigationHistory.goForward(),
        },
        { label: 'Reload', click: () => wc.reload() },
        { type: 'separator' },
        { label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) },
      );

      Menu.buildFromTemplate(items).popup({ window: this.win });
    });

    // Without this, Electron's default behavior for window.open()/
    // target="_blank" (no handler registered at all) is to spin up a
    // brand new, undecorated native BrowserWindow completely outside this
    // app's own tabbed chrome - easy to lose track of and inconsistent
    // with how every real browser handles this. Deny the native window
    // and open the same URL as a normal tab instead - matches Chrome's
    // own default for a plain window.open(url)/target="_blank" call.
    //
    // Trade-off, deliberately accepted: sites that use window.open()
    // specifically for a controlled popup (e.g. an OAuth login flow that
    // holds onto the returned handle to redirect it or postMessage back
    // to the opener) get `null` back instead of a live window reference,
    // since denying here means Electron never returns one - those flows
    // may not work. Building real popup-window support (a distinct
    // chromeless window that still round-trips messages to its opener) is
    // a much bigger feature than "stop hijacking new windows" and isn't
    // what's being asked for here.
    wc.setWindowOpenHandler((details) => {
      this.newTab(details.url);
      return { action: 'deny' };
    });
  }

  private showErrorPage(tab: Tab, failedUrl: string, errorCode: number, errorDescription: string): void {
    const errorUrl = buildErrorPageUrl(failedUrl, errorCode, errorDescription);
    tab.pendingErrorUrl = errorUrl;
    tab.favicon = null;
    tab.loading = false;
    void tab.view.webContents.loadURL(errorUrl);
    this.callbacks.onTabsChanged();
    this.notifyIfActive(tab);
  }

  /** Same pendingErrorUrl mechanism as showErrorPage above (so
   * handleUrlChange recognizes this internal load and doesn't treat it as
   * a real navigation for history/chat purposes) - just a different page
   * builder and trigger. `failedUrl` is the tab's last known URL, reused
   * as both what to display and what "Try again" retries. */
  private showCrashPage(tab: Tab, failedUrl: string, reason: string): void {
    const crashUrl = buildCrashPageUrl(failedUrl, reason);
    tab.pendingErrorUrl = crashUrl;
    tab.favicon = null;
    tab.loading = false;
    void tab.view.webContents.loadURL(crashUrl);
    this.callbacks.onTabsChanged();
    this.notifyIfActive(tab);
  }

  private handleUrlChange(tab: Tab, url: string): void {
    if (url === tab.pendingErrorUrl) {
      // Our error page just finished loading - it already updated
      // title/favicon/loading; the URL it's "at" is an implementation
      // detail, not a real page the user navigated to.
      tab.pendingErrorUrl = null;
      this.callbacks.onTabsChanged();
      return;
    }
    tab.url = url;
    this.callbacks.onTabsChanged();
    if (tab.id === this.activeId) {
      this.callbacks.onActiveNavStateChanged();
      this.callbacks.onActiveUrlChanged(url);
    }
  }

  private notifyIfActive(tab: Tab): void {
    if (tab.id === this.activeId) {
      this.callbacks.onActiveNavStateChanged();
    }
  }
}
