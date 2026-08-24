/**
 * A minimal application menu, mainly so standard browser shortcuts exist
 * at all (Electron doesn't wire any of these up by default). New Tab and
 * Close Tab are the important ones: without this menu, Electron's
 * *default* menu would still bind Cmd/Ctrl+W to "close the window" -
 * defining it here ourselves, bound to closing the active tab instead,
 * is what makes it do the right thing.
 *
 * Menu accelerators fire regardless of which child WebContentsView (chrome/
 * page/chat) currently has focus, since they're handled by the native OS
 * menu system on the BaseWindow, not by any one view's own JS - that's
 * what lets Cmd+T/Cmd+R already work no matter where focus is, and why the
 * newer shortcuts below (zoom, find, back/forward, etc.) work the same way.
 */
import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { WindowManager } from './windowManager';
import { IPC } from '../shared/ipcChannels';

export function installAppMenu(wm: WindowManager): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => wm.tabs.newTab() },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const id = wm.tabs.getActiveTabId();
            if (id) wm.tabs.closeTab(id);
          },
        },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => wm.tabs.reopenClosedTab() },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => wm.tabs.print() },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find in Page…', accelerator: 'CmdOrCtrl+F', click: () => wm.openFindBar() },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: isMac ? 'CmdOrCtrl+[' : 'Alt+Left', click: () => wm.tabs.goBack() },
        { label: 'Forward', accelerator: isMac ? 'CmdOrCtrl+]' : 'Alt+Right', click: () => wm.tabs.goForward() },
        { label: 'Reload Page', accelerator: 'CmdOrCtrl+R', click: () => wm.tabs.reload() },
        { type: 'separator' },
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+L',
          click: () => wm.chromeView.webContents.send(IPC.FOCUS_ADDRESS_BAR),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => wm.tabs.zoomIn() },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => wm.tabs.zoomOut() },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => wm.tabs.zoomResetToDefault() },
        { type: 'separator' },
        { label: 'View Page Source', accelerator: 'CmdOrCtrl+U', click: () => wm.tabs.viewSource() },
        { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Alt+I', click: () => wm.tabs.toggleDevTools() },
        { type: 'separator' },
        {
          label: 'Toggle Full Screen',
          // Electron's built-in 'togglefullscreen' role targets
          // BrowserWindow.getFocusedWindow() specifically - this app never
          // creates a BrowserWindow (only the BaseWindow + WebContentsViews
          // in WindowManager), so it's not reliable here. Driving it
          // through wm.setBrowserFullscreen() instead goes through the
          // exact same enter/leave-full-screen handling a page's own
          // fullscreen request does (see tabManager.ts).
          accelerator: isMac ? 'Control+Command+F' : 'F11',
          click: () => wm.setBrowserFullscreen(!wm.win.isFullScreen()),
        },
      ],
    },
    {
      label: 'Tab',
      submenu: Array.from({ length: 9 }, (_, i) => ({
        label: `Switch to Tab ${i + 1}`,
        // Cmd+9 is conventionally "last tab", not literally the 9th - see
        // TabManager.switchToTabAtIndex, which resolves index 8 that way.
        accelerator: `CmdOrCtrl+${i + 1}`,
        click: () => wm.tabs.switchToTabAtIndex(i),
      })),
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
