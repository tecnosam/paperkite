/**
 * Owns the single BaseWindow and the three views layered inside it:
 * chrome (tab strip + toolbar), the active tab's page, and the chat
 * panel. This is the piece most likely to grow next (screenshots, CDP,
 * multiple windows), so the rule it follows is kept simple on purpose:
 *
 *   - WindowManager decides WHAT is attached and WHERE (bounds).
 *   - TabManager decides which WebContentsView exists for a given tab.
 *   - Nobody else touches `win.contentView` directly.
 */
import { app, BaseWindow, WebContentsView, nativeTheme } from 'electron';
import path from 'node:path';
import { computeLayout, easeOutCubic, CHAT_WIDTH, type ViewBounds } from './layout';
import { TabManager } from './tabManager';
import { IPC } from '../shared/ipcChannels';
import { buildSubtitleOverlayUrl, buildSetSubtitleTextScript } from './subtitleOverlay';
import type { SubtitleSettings, PageTranslateSettings } from '../shared/types';

const CHAT_ANIMATION_MS = 220;
const FRAME_MS = 1000 / 60;

/** Matches --paper / dark --paper from renderer/shared/theme.css. Setting
 * the BaseWindow's own background to this (instead of the Electron
 * default) means the single, instantaneous page-resize jump in
 * animateChatPanel() never flashes an unstyled background underneath. */
export const PAPER_LIGHT = '#f4ecdc';
export const PAPER_DARK = '#1a1713';

/** The BaseWindow `icon` option only actually shows up in the Windows/
 * Linux taskbar - macOS ignores it and derives the dock icon from the
 * packaged .app bundle instead (see main/index.ts's dev-mode dock-icon
 * call for the one place macOS needs a nudge: unpackaged `electron-forge
 * start` runs, where there's no bundle to pull an icon from at all).
 * `app.getAppPath()` resolves to the project root in dev and the packaged
 * app's root otherwise, so this one path works in both. */
const APP_ICON_PATH = path.join(app.getAppPath(), 'assets', 'icon.png');

function boundsEqual(a: ViewBounds | null, b: ViewBounds): boolean {
  return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Notifications WindowManager forwards up so the ipc layer can push
 * fresh state to the chrome/chat renderers. */
export interface WindowManagerCallbacks {
  onTabsChanged: () => void;
  onActiveNavStateChanged: () => void;
  onActiveUrlChanged: (url: string) => void;
  onPageVisited: (url: string, title: string) => void;
  onFindResult: (activeMatchOrdinal: number, matches: number) => void;
  /** The active tab's subtitle settings changed - push fresh state to the
   * chrome renderer so an open popover (or one opened later) reflects it.
   * WindowManager itself handles attaching/detaching the overlay view;
   * this is purely for keeping the UI in sync. */
  onActiveSubtitleSettingsChanged: (settings: SubtitleSettings) => void;
  /** The active tab's page-translate settings changed - push fresh state
   * to the chrome renderer. Unlike subtitles, there's no overlay view for
   * WindowManager to attach/detach here (TabManager drives the tab's own
   * preload directly - see setActivePageTranslateSettings), so this is
   * purely a state broadcast. */
  onActivePageTranslateSettingsChanged: (settings: PageTranslateSettings) => void;
  /** The active tab's chat-server override changed (tab switch or an
   * explicit per-tab pick) - main/index.ts reacts by resyncing the one
   * active chat-service polling session (see main/chatSession.ts) to
   * whatever server/room this tab now resolves to. */
  onActiveChatServerChanged: (serverId: string | null) => void;
}

export class WindowManager {
  readonly win: BaseWindow;
  readonly chromeView: WebContentsView;
  readonly chatView: WebContentsView;
  readonly subtitleView: WebContentsView;
  readonly tabs: TabManager;

  private chatOpen = false;
  /** The chat panel's current width in px - not just 0/CHAT_WIDTH, since
   * this is tweened across animateChatPanel()'s frames. */
  private chatWidth = 0;
  /** Width reserved from the page view for chat - only ever 0 or
   * CHAT_WIDTH, changed exactly once per toggle (never tweened). See
   * computeLayout()'s doc comment for why this is kept separate from
   * chatWidth. */
  private chatSlotWidth = 0;
  private chatAttached = false;
  private chatAnimationToken = 0;
  private chromeFullscreen = false;
  private findBarOpen = false;
  private chatFullscreen = false;
  private toolbarPopoverOpen = false;
  private browserFullscreen = false;
  private activePageView: WebContentsView | null = null;
  private subtitleAttached = false;

  private lastChromeBounds: ViewBounds | null = null;
  private lastPageBounds: ViewBounds | null = null;
  private lastChatBounds: ViewBounds | null = null;
  private lastSubtitleBounds: ViewBounds | null = null;

  constructor(callbacks: WindowManagerCallbacks) {
    this.win = new BaseWindow({
      width: 1280,
      height: 820,
      minWidth: 720,
      minHeight: 480,
      backgroundColor: nativeTheme.shouldUseDarkColors ? PAPER_DARK : PAPER_LIGHT,
      icon: APP_ICON_PATH,
    });

    this.chromeView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'chrome.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    // Transparent so a toolbar popover's reserved strip (see
    // TOOLBAR_POPOVER_HEIGHT) shows the page/chat underneath instead of an
    // opaque gap pushing them down - the toolbar/tab-strip/find-bar/modals
    // all paint their own opaque backgrounds in CSS (see .chrome__bar and
    // friends in styles.css), so this only actually shows through in the
    // reserved-but-otherwise-empty space. Same confirmed-working trick as
    // the subtitle overlay below.
    this.chromeView.setBackgroundColor('#00000000');
    this.chatView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'chat.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    // No preload - this view only ever displays text WindowManager pushes
    // into it (see syncSubtitleOverlay), never calls back into main, so
    // there's nothing an IPC bridge would buy it. See subtitleOverlay.ts.
    this.subtitleView = new WebContentsView({
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    // Transparent so the active tab's page shows through everywhere except
    // the caption text itself - confirmed working (WebContentsView-over-
    // WebContentsView, not just window-over-desktop) via a standalone spike
    // on this exact platform/Electron version before committing to this
    // approach; Electron's docs only describe the window-transparency case.
    this.subtitleView.setBackgroundColor('#00000000');
    void this.subtitleView.webContents.loadURL(buildSubtitleOverlayUrl());

    // Chrome is always attached; chat, the page, and subtitle views are
    // attached conditionally (chat on toggle, page on tab switch, subtitle
    // on translation toggle) in relayout()/syncSubtitleOverlay().
    this.win.contentView.addChildView(this.chromeView);

    this.tabs = new TabManager(this.win, {
      onTabsChanged: callbacks.onTabsChanged,
      onActiveNavStateChanged: callbacks.onActiveNavStateChanged,
      onActiveUrlChanged: callbacks.onActiveUrlChanged,
      onActiveViewChanged: (view) => this.setActivePageView(view),
      onPageVisited: callbacks.onPageVisited,
      onFindResult: callbacks.onFindResult,
      onRequestFullscreen: (active) => this.setBrowserFullscreen(active),
      onActiveSubtitleSettingsChanged: (settings) => {
        this.syncSubtitleOverlay(settings);
        callbacks.onActiveSubtitleSettingsChanged(settings);
      },
      onActivePageTranslateSettingsChanged: callbacks.onActivePageTranslateSettingsChanged,
      onActiveChatServerChanged: callbacks.onActiveChatServerChanged,
    });

    this.win.on('resize', () => this.relayout());

    // The single source of truth for browserFullscreen - fires no matter
    // how OS fullscreen was triggered (our own setBrowserFullscreen call,
    // the View menu's built-in accelerator, or the user clicking the
    // native green-dot/traffic-light control directly), so this can't get
    // out of sync with reality the way tracking it ourselves could.
    this.win.on('enter-full-screen', () => {
      this.browserFullscreen = true;
      // Raise the active page above chrome/chat - browserFullscreen makes
      // the page cover the whole window (unlike the normal case, or even
      // a toolbar popover's reserved strip, where chrome stays on top -
      // see raiseChrome), so it needs to actually be on top now. Per
      // Electron's own View.addChildView docs, re-adding a view already
      // present in its parent just reorders it to the top - no need to
      // removeChildView first, and NOT removing it first is what actually
      // matters here: see setChromeFullscreen's doc comment for why a
      // genuine detach+reattach cycle (as opposed to a bare reorder) is
      // what caused a real, hard-to-track resize-sync bug.
      if (this.activePageView) {
        this.win.contentView.addChildView(this.activePageView);
        this.lastPageBounds = null;
      }
      // ...and re-raise the subtitle overlay above THAT, or fullscreen
      // video would cover the captions instead of the other way around.
      this.raiseSubtitleOverlay();
      this.relayout();
    });
    this.win.on('leave-full-screen', () => {
      this.browserFullscreen = false;
      // Undo enter-full-screen's page-above-chrome raise, or a toolbar
      // popover opened after leaving fullscreen would render behind the
      // page instead of over it.
      this.raiseChrome();
      this.relayout();
    });
  }

  loadChromeUrl(): void {
    if (CHROME_WINDOW_VITE_DEV_SERVER_URL) {
      void this.chromeView.webContents.loadURL(CHROME_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      void this.chromeView.webContents.loadFile(
        path.join(__dirname, `../renderer/${CHROME_WINDOW_VITE_NAME}/index.html`),
      );
    }
  }

  loadChatUrl(): void {
    if (CHAT_WINDOW_VITE_DEV_SERVER_URL) {
      void this.chatView.webContents.loadURL(CHAT_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      void this.chatView.webContents.loadFile(
        path.join(__dirname, `../renderer/${CHAT_WINDOW_VITE_NAME}/index.html`),
      );
    }
  }

  isChatOpen(): boolean {
    return this.chatOpen;
  }

  /**
   * Blocks the browser behind the username prompt: grows the chrome view
   * to the full window and raises it above the page/chat views so its
   * `position: fixed` modal overlay actually covers everything, instead
   * of being clipped to the normal CHROME_HEIGHT strip.
   */
  setChromeFullscreen(active: boolean): void {
    if (this.chromeFullscreen === active) return;
    this.chromeFullscreen = active;
    // Reorders chrome to the top via a bare re-add, not a detach+reattach -
    // per Electron's own View.addChildView docs, "if the same View is
    // added to a parent which already contains it, it will be reordered
    // such that it becomes the topmost view", so removeChildView first
    // was never actually needed just to reorder.
    this.win.contentView.addChildView(this.chromeView);
    this.lastChromeBounds = null; // force setBounds even if the target happens to match a stale cached value
    this.relayout();
    // See nudgeWindowResize's own doc comment - a real resize notification
    // to the chrome renderer isn't reliable through view-bounds changes
    // alone for a jump this dramatic (normal strip <-> full window).
    this.nudgeWindowResize();
  }

  toggleChat(): void {
    this.chatOpen = !this.chatOpen;
    this.animateChatPanel(this.chatOpen);
  }

  /**
   * Reserves FIND_BAR_HEIGHT below the toolbar for the find-in-page bar
   * (see computeLayout's doc comment) and tells chrome to render into it.
   * No-ops while the fullscreen modal overlay is up - there'd be nothing
   * visible to find behind it anyway.
   */
  openFindBar(): void {
    if (this.chromeFullscreen || this.findBarOpen) return;
    this.findBarOpen = true;
    this.relayout();
    this.chromeView.webContents.send(IPC.FIND_BAR_OPEN);
  }

  closeFindBar(): void {
    if (!this.findBarOpen) return;
    this.findBarOpen = false;
    this.relayout();
    this.tabs.getActiveView()?.webContents.stopFindInPage('clearSelection');
  }

  /** Renderer-driven (a toolbar popover's open/close happens entirely in
   * chrome's own React state) - mirrors openFindBar/closeFindBar's
   * reservation, just triggered over IPC instead of a main-side menu
   * accelerator. Shared by every toolbar popover (bookmark, subtitles,
   * the address bar's autocomplete dropdown) - the renderer already ORs
   * its own open flags together before calling this, so main only ever
   * sees "some popover wants the space" or not. */
  setToolbarPopoverOpen(open: boolean): void {
    if (this.toolbarPopoverOpen === open) return;
    this.toolbarPopoverOpen = open;
    this.relayout();
  }

  /**
   * Real browser fullscreen - the View menu's Toggle Full Screen, or a
   * page's own `element.requestFullscreen()` (see tabManager.ts). Just
   * flips the OS window's own fullscreen state; the enter-full-screen/
   * leave-full-screen listeners in the constructor do the actual view
   * raising and relayout, since they're the single source of truth for
   * browserFullscreen regardless of what triggered the OS transition.
   */
  setBrowserFullscreen(active: boolean): void {
    this.win.setFullScreen(active);
  }

  /**
   * Grows the chat view to cover the whole window (and raises it above
   * chrome/page) for the full-screen image lightbox, or for a blocking
   * chat-side notice like UsernameTakenModal - the chat view is normally
   * just a CHAT_WIDTH-wide sidebar, with no room for either on its own.
   * Mirrors setChromeFullscreen, including reordering via a bare re-add
   * rather than detach+reattach (see its doc comment for why).
   */
  setChatFullscreen(active: boolean): void {
    if (this.chatFullscreen === active) return;
    // Guards against relayout() silently no-op'ing setBounds on a detached
    // view - can happen if the chat panel is closed when this fires. Most
    // callers (ipc.ts's chatSession status handler, for a notice that can
    // arrive at any time regardless of whether the panel's open) already
    // call wm.toggleChat() first when needed, but this stays defensive
    // rather than trusting every future caller to remember that.
    if (active && !this.chatAttached) return;
    this.chatFullscreen = active;
    this.win.contentView.addChildView(this.chatView); // already attached - just reorders to the top
    this.lastChatBounds = null; // force setBounds even if the target happens to match a stale cached value
    this.relayout();
    // See nudgeWindowResize's own doc comment.
    this.nudgeWindowResize();
  }

  /** Applies a per-tab subtitle-settings change: attaches/detaches the
   * overlay view. The actual caption text comes from ipc.ts's audio ->
   * whisper -> translate pipeline calling pushSubtitleText below, not from
   * anything WindowManager drives itself. Called both when the user
   * actually changes the settings and when the active tab itself switches
   * to one with different settings (see TabManager.switchTab). */
  setSubtitleSettings(settings: SubtitleSettings): void {
    this.tabs.setActiveSubtitleSettings(settings);
  }

  /** Applies a per-tab page-translate settings change - TabManager does
   * all the actual work (driving the tab's own preload directly), this is
   * just the same thin pass-through setSubtitleSettings is, kept for
   * consistency since ipc.ts otherwise only ever talks to `wm`, never
   * `wm.tabs` directly. */
  setPageTranslateSettings(settings: PageTranslateSettings): void {
    this.tabs.setActivePageTranslateSettings(settings);
  }

  /** Shows (or clears, with `null`) one caption line - called once per
   * chunk as ipc.ts's transcription/translation pipeline produces text.
   * A no-op while the overlay isn't attached, so a stray late chunk from
   * just before the user switched tabs/turned it off can't flash text
   * onto a view nobody's looking at. */
  pushSubtitleText(text: string | null): void {
    if (!this.subtitleAttached) return;
    void this.subtitleView.webContents.executeJavaScript(buildSetSubtitleTextScript(text));
  }

  private syncSubtitleOverlay(settings: SubtitleSettings): void {
    if (settings.enabled === this.subtitleAttached) return; // e.g. switching between two tabs that both have it on

    if (settings.enabled) {
      this.subtitleAttached = true;
      // addChildView always appends on top, so this is already the
      // topmost view - no separate raise needed here.
      this.win.contentView.addChildView(this.subtitleView);
      this.lastSubtitleBounds = null;
      this.relayout();
    } else {
      // Clear while still "attached" (per pushSubtitleText's own guard) so
      // the next tab that enables it doesn't briefly show a stale line,
      // then actually detach.
      this.pushSubtitleText(null);
      this.subtitleAttached = false;
      this.win.contentView.removeChildView(this.subtitleView);
    }
  }

  /** No-op while detached - relayout()/syncSubtitleOverlay() only call
   * this when the view is (about to be) attached anyway. Reorders via a
   * bare re-add, not detach+reattach - see setChromeFullscreen's doc
   * comment for why. */
  private raiseSubtitleOverlay(): void {
    if (!this.subtitleAttached) return;
    this.win.contentView.addChildView(this.subtitleView);
    this.lastSubtitleBounds = null;
  }

  /** Keeps chrome above page/chat so a toolbar popover's reserved (but
   * transparent) strip actually renders on top of them instead of behind
   * - addChildView always appends on top, so anything attached/re-attached
   * after chrome (a newly active tab's page view, the chat panel opening)
   * would otherwise leave chrome buried underneath. Not needed for
   * chromeFullscreen/setChromeFullscreen, which already does its own raise.
   * Reorders via a bare re-add, not detach+reattach - see
   * setChromeFullscreen's doc comment for why. */
  private raiseChrome(): void {
    this.win.contentView.addChildView(this.chromeView);
    this.lastChromeBounds = null;
  }

  /**
   * Slides the chat panel open/closed by tweening its native view width
   * over a few frames, rather than snapping it - a plain CSS transition
   * can't reach here since WebContentsView bounds aren't part of the DOM.
   * Interrupting mid-slide (fast double-toggle) just re-tweens from
   * wherever the width currently is, via the animation token below.
   *
   * The page view's width is deliberately NOT part of the per-frame tween
   * (see chatSlotWidth) - it jumps once, either right before this starts
   * (opening) or right after it ends (closing), so a live webpage's native
   * view is only ever resized once per toggle instead of ~13 times over
   * the animation, which is what caused the visible stutter.
   */
  private animateChatPanel(opening: boolean): void {
    const token = ++this.chatAnimationToken;
    if (opening && !this.chatAttached) {
      this.win.contentView.addChildView(this.chatView);
      this.chatAttached = true;
      // Re-attaching after a previous close - force the next relayout() to
      // actually call setBounds rather than trusting stale cached bounds
      // from before it was detached.
      this.lastChatBounds = null;
      // ...and put chrome back on top of it - addChildView just appended
      // chat above chrome, and a toolbar popover's reserved strip needs to
      // render over the chat panel too, not behind it.
      this.raiseChrome();
    }
    if (opening) {
      // Reserve the slot (and resize the page view) once, up front, so the
      // per-frame steps below only ever touch the chat view's own bounds.
      this.chatSlotWidth = CHAT_WIDTH;
      this.relayout();
    }

    const startWidth = this.chatWidth;
    const endWidth = opening ? CHAT_WIDTH : 0;
    const startTime = Date.now();

    const step = () => {
      if (token !== this.chatAnimationToken) return; // superseded by a newer toggle

      const t = Math.min(1, (Date.now() - startTime) / CHAT_ANIMATION_MS);
      this.chatWidth = startWidth + (endWidth - startWidth) * easeOutCubic(t);
      this.relayout();

      if (t < 1) {
        setTimeout(step, FRAME_MS);
      } else if (!opening) {
        if (this.chatAttached) {
          this.win.contentView.removeChildView(this.chatView);
          this.chatAttached = false;
        }
        // Give the page view its full width back now that chat is fully
        // hidden - the one-time jump mirrors the open-side reservation above.
        this.chatSlotWidth = 0;
        this.relayout();
      }
    };
    step();
  }

  /** Swaps which tab's page view is attached to the window. */
  private setActivePageView(view: WebContentsView | null): void {
    if (this.activePageView) {
      this.win.contentView.removeChildView(this.activePageView);
    }
    this.activePageView = view;
    // The newly-attached view has never had setBounds called on it, so the
    // relayout() dedup guard (which compares against the PREVIOUS view's
    // last-applied bounds) must not skip it even if the numbers happen to
    // match what the old view already had.
    this.lastPageBounds = null;
    if (view) {
      // addChildView appends on top, so the newly active page view would
      // otherwise end up above chrome/subtitle - both need to stay above
      // it (chrome for a toolbar popover's reserved strip, subtitle for
      // captions), so re-raise them every time the active tab switches.
      this.win.contentView.addChildView(view);
      this.raiseChrome();
      this.raiseSubtitleOverlay();
    }
    this.relayout();
  }

  private relayout(): void {
    const { width, height } = this.win.getContentBounds();
    const layout = computeLayout(
      width,
      height,
      this.chatSlotWidth,
      this.chatWidth,
      this.chromeFullscreen,
      this.findBarOpen,
      this.chatFullscreen,
      this.toolbarPopoverOpen,
      this.browserFullscreen,
    );

    // Skip setBounds calls whose bounds haven't actually changed - during
    // the chat-slide animation this keeps every frame from re-resizing the
    // chrome/page views (only chat's bounds move), which is the expensive
    // part native-side, especially for the page view (see animateChatPanel).
    if (!boundsEqual(this.lastChromeBounds, layout.chrome)) {
      this.chromeView.setBounds(layout.chrome);
      this.lastChromeBounds = layout.chrome;
    }
    if (this.activePageView && !boundsEqual(this.lastPageBounds, layout.page)) {
      this.activePageView.setBounds(layout.page);
      this.lastPageBounds = layout.page;
    }
    if (this.chatAttached && !boundsEqual(this.lastChatBounds, layout.chat)) {
      this.chatView.setBounds(layout.chat);
      this.lastChatBounds = layout.chat;
    }
    if (this.subtitleAttached && !boundsEqual(this.lastSubtitleBounds, layout.subtitle)) {
      this.subtitleView.setBounds(layout.subtitle);
      this.lastSubtitleBounds = layout.subtitle;
    }
  }

  /**
   * Confirmed by hand (via webContents.executeJavaScript reading the
   * renderer's own window.innerHeight straight back, bypassing every layer
   * of this class's own bookkeeping) that WebContentsView.setBounds() is
   * NOT reliable for chrome/chat's own fullscreen toggles: Electron's
   * View.getBounds() readback and the native frame both update correctly,
   * but the renderer process itself sometimes never receives the resize -
   * it keeps reporting the OLD innerHeight/innerWidth indefinitely, while
   * still actually occupying (and hit-testing clicks across) the NEW area.
   * Neither a redundant same-value setBounds() nor a deliberately-different
   * intermediate setBounds() immediately before the real one fixed it -
   * both point at Chromium itself dropping/deduping the resize somewhere
   * between the view-bounds layer and the renderer, not at anything this
   * class's own bookkeeping gets wrong.
   *
   * A real OS-level window resize is a far more heavily-tested Chromium
   * code path than WebContentsView bounds alone, and every child view's
   * bounds are recomputed from the window's own content size on every
   * resize anyway (see the `resize` listener in the constructor) - so
   * nudging the actual BaseWindow by a pixel and back forces the exact
   * same relayout() through a completely different, more reliable path.
   * Called after any transition that toggles a view between two dramatically
   * different sizes (chrome/chat's fullscreen toggles) - not after every
   * single relayout(), since real window resizes are comparatively
   * expensive and every other bounds change (chat sliding open/closed, a
   * toolbar popover) has never shown this symptom.
   */
  private nudgeWindowResize(): void {
    const [w, h] = this.win.getContentSize();
    this.win.setContentSize(w, Math.max(1, h - 1));
    this.win.setContentSize(w, h);
  }
}
