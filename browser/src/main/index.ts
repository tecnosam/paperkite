import { app, BaseWindow, nativeTheme, session, desktopCapturer } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { WindowManager } from './windowManager';
import { registerIpcHandlers, resyncChatSession } from './ipc';
import { IPC } from '../shared/ipcChannels';
import { loadThemeSource } from './userStore';
import { installAppMenu } from './appMenu';
import { recordVisit } from './historyStore';
import { loadProxySettings, applyProxySettings } from './proxyStore';
import { trackDownload, getDownloads } from './downloadStore';
import { installPermissionHandlers } from './permissions';
import { disconnectAll } from './mcp/client';
import { startBuiltinMcpServer, stopBuiltinMcpServer, loadBuiltinMcpEnabledPreference } from './mcp/builtinServer';
import { loadSession, scheduleSessionSave, flushSessionSave } from './sessionRestore';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Must be set before the app is ready - live translate's audio capture
// (see setDisplayMediaRequestHandler below) needs this to get real audio
// instead of a silent buffer. Confirmed by hand: without it, getDisplayMedia
// resolves with what looks like a normal audio track, but every sample is
// zero - a documented Chromium quirk on macOS, not something that throws or
// warns. Chromium ignores feature names it doesn't recognize, so this is
// harmless on Windows/Linux even though the flags themselves are Mac-only.
app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');

async function createWindow(): Promise<void> {
  // Restore the saved theme preference before any view loads, so the
  // very first paint (including the username prompt) is already correct
  // instead of flashing light-then-dark.
  nativeTheme.themeSource = loadThemeSource();

  // Likewise, apply any saved proxy config before the first tab loads a
  // page, so the very first navigation already goes through it.
  await applyProxySettings(loadProxySettings());

  // Strips this app's own name/version and " Electron/x.y.z" out of the
  // User-Agent Chromium computes by default (confirmed by hand:
  // "... paperkite-browser/1.0.0 Chrome/150.0.7871.129 Electron/43.2.0 ...")
  // - both are a clean, trivial-to-sniff signal that this is an Electron
  // app rather than a real browser, sent on every single request and
  // readable via plain navigator.userAgent by any page. Derived from
  // Electron's own computed default rather than a hand-rolled platform
  // string, so it stays accurate (right Chrome version, right OS token)
  // across platforms and Chromium version bumps without needing to be
  // maintained here. Applies session-wide - see tabManager.ts/windowManager.ts,
  // neither uses a partitioned session, so this covers every tab.
  const defaultUserAgent = session.defaultSession.getUserAgent();
  const chromeOnlyUserAgent = defaultUserAgent
    .replace(` ${app.getName()}/${app.getVersion()}`, '')
    .replace(/ Electron\/\S+/, '');
  session.defaultSession.setUserAgent(chromeOnlyUserAgent);

  // `wm` is referenced inside the callbacks below before this statement
  // finishes, but those callbacks only ever run in response to later tab
  // events (created after this function returns), so the closure is safe.
  const wm: WindowManager = new WindowManager({
    onTabsChanged: () => {
      const payload = wm.tabs.getTabsPayload();
      wm.chromeView.webContents.send(IPC.TABS_UPDATED, payload);
      // Debounced (see sessionRestore.ts) - this fires far more often than
      // the tab list actually changes structurally.
      scheduleSessionSave(
        payload.tabs.map((t) => t.url),
        payload.tabs.findIndex((t) => t.id === payload.activeId),
      );
    },
    onActiveNavStateChanged: () => {
      const nav = wm.tabs.getActiveNavState();
      if (nav) wm.chromeView.webContents.send(IPC.NAV_STATE, nav);
    },
    onActiveUrlChanged: () => {
      resyncChatSession(wm);
      // Fires on a tab switch AND a same-tab navigation - either way, a
      // caption already on screen is about audio from the page just left
      // behind, not whatever's here now. Leaving it up would show a
      // translated line for content that no longer exists; the next chunk
      // (if translate's still on) replaces it soon enough regardless.
      wm.pushSubtitleText(null);
    },
    onPageVisited: (url, title) => recordVisit(url, title),
    onFindResult: (activeMatchOrdinal, matches) => {
      wm.chromeView.webContents.send(IPC.FIND_RESULT, { activeMatchOrdinal, matches });
    },
    onActiveSubtitleSettingsChanged: (settings) => {
      wm.chromeView.webContents.send(IPC.SUBTITLE_SETTINGS, settings);
    },
    onActivePageTranslateSettingsChanged: (settings) => {
      wm.chromeView.webContents.send(IPC.PAGE_TRANSLATE_SETTINGS, settings);
      // Fires on a real settings edit (nothing in flight yet either way)
      // AND on a tab switch (whatever the previous tab's status was
      // doesn't apply to whichever tab is showing now) - 'idle' is the
      // right reset for both; a real 'translating' push (see ipc.ts's
      // PAGE_TRANSLATE_EXTRACTED handler) always follows asynchronously
      // after this if one's actually about to start.
      wm.chromeView.webContents.send(IPC.PAGE_TRANSLATE_STATUS, { status: 'idle' });
    },
    // A tab switch (new tab's own override, or none - follow the global
    // default) or an explicit per-tab pick (see SET_ACTIVE_CHAT_SERVER in
    // ipc.ts) both land here - either way the effective chat-service target
    // may have changed, so resync.
    onActiveChatServerChanged: () => resyncChatSession(wm),
  });

  // Applies to the whole session (like proxy), not any one tab - every
  // page's downloads land here regardless of which tab triggered them.
  session.defaultSession.on('will-download', (_event, item) => {
    trackDownload(item, () => wm.chromeView.webContents.send(IPC.DOWNLOADS_UPDATED, getDownloads()));
  });

  // Same session-wide scope, for geolocation/camera/microphone requests
  // from any tab. Paperkite's own chrome view is exempted from the 'media'
  // prompt specifically - see permissions.ts's isTrustedWebContents doc
  // comment for why (its own getDisplayMedia call for live translate hits
  // this same hook).
  installPermissionHandlers(
    (request) => wm.chromeView.webContents.send(IPC.PERMISSION_REQUESTED, request),
    (webContents) => webContents.id === wm.chromeView.webContents.id,
  );

  // Fulfills the chrome renderer's getDisplayMedia({audio:true}) call for
  // live translate (see renderer/chrome/audioCapture.ts), no picker UI -
  // the renderer already knows exactly what it wants to capture, so
  // there's nothing for a user to choose.
  //
  // `audio: 'loopback'` (a bare string) looks like the obvious way to do
  // this, and is what earlier attempts used - but Electron's own type docs
  // say plainly that string form "is currently only supported on Windows".
  // On macOS it doesn't error, doesn't warn, it just silently hands back a
  // resolved audio track that's permanently all zeroes - confirmed by hand
  // with a raw AnalyserNode reading straight off the stream: maxAbs stayed
  // exactly 0 even with a loud oscillator tone genuinely playing and the
  // Screen & System Audio Recording permission genuinely granted. Neither
  // of those was ever the problem; the capture method itself was wrong for
  // this platform.
  //
  // The actually cross-platform mechanism `Streams.audio` also accepts is
  // a WebFrameMain - "will capture audio from that frame" - which is both
  // the fix and an upgrade: it captures the active tab specifically,
  // rather than the whole window's audio (which would have picked up a
  // background tab still playing something too).
  //
  // Two follow-up fixes, both confirmed by hand after the above:
  //
  // 1. `enableLocalEcho` - undocumented-by-omission gotcha: per Streams'
  // own doc comment, when `audio` is a WebFrameMain this defaults to
  // `false`, meaning the frame's audio is *diverted* into the capture
  // instead of also still reaching the speakers - the tab goes silent to
  // the user the moment translate turns on. Has to be explicitly set true.
  //
  // 2. `video` stays a desktopCapturer window source, not also the active
  // frame, even though the video track is discarded immediately anyway
  // (see audioCapture.ts) - passing the same live WebFrameMain for video
  // forces Chromium to stand up a real overlay-production GPU path for
  // that exact view for as long as capture runs, which was producing
  // "SharedImageManager::ProduceOverlay ... non-existent mailbox" errors
  // and made the subtitle overlay (a sibling WebContentsView sharing the
  // same window's GPU compositor context) stop rendering. The window
  // source is a much lower-impact, essentially static capture - fine
  // given nothing ever looks at these video frames.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const activeFrame = wm.tabs.getActiveView()?.webContents.mainFrame;
    if (!activeFrame) {
      callback({});
      return;
    }
    void desktopCapturer.getSources({ types: ['window'] }).then((sources) => {
      const ownWindow = sources.find((s) => s.name === app.getName()) ?? sources[0];
      if (!ownWindow) {
        callback({});
        return;
      }
      callback({ video: ownWindow, audio: activeFrame, enableLocalEcho: true });
    });
  });

  registerIpcHandlers(wm);
  installAppMenu(wm);
  wm.loadChromeUrl();
  wm.loadChatUrl();

  // Restores whatever was open last time (see sessionRestore.ts) instead
  // of always starting fresh - falls back to a single new-tab page on a
  // genuinely first launch, or if the session file is missing/corrupt.
  const previousSession = loadSession();
  if (previousSession) {
    wm.tabs.restoreTabs(previousSession.tabs, previousSession.activeIndex);
  } else {
    wm.tabs.newTab();
  }

  // On by default (per the approved design) - only skipped if the user
  // has explicitly turned it off before, in Settings.
  if (loadBuiltinMcpEnabledPreference()) void startBuiltinMcpServer(wm);
}

app.on('ready', () => {
  // Packaged builds get their dock icon from the .app bundle for free
  // (see forge.config.ts's packagerConfig.icon) - only an unpackaged
  // `electron-forge start` dev run needs this nudge, or the dock and
  // Cmd+Tab switcher show Electron's own generic icon instead of
  // Paperkite's for the whole session.
  if (!app.isPackaged && process.platform === 'darwin') {
    app.dock?.setIcon(path.join(app.getAppPath(), 'assets', 'icon.png'));
  }
  void createWindow();
});

// Stdio MCP servers are child processes - close every connection cleanly
// (and with it, those processes) rather than letting them dangle. Also
// stop the built-in server itself, not just outbound connections to it.
app.on('before-quit', () => {
  void disconnectAll();
  void stopBuiltinMcpServer();
  // The debounced session save (see sessionRestore.ts) must not lose the
  // final tab state to a quit landing inside its debounce window.
  flushSessionSave();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BaseWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
