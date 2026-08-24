/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

// The default forge-vite-env.d.ts only declares MAIN_WINDOW_*. We have two
// renderers (chrome_window, chat_window), so their generated globals need
// declaring here too.
declare const CHROME_WINDOW_VITE_DEV_SERVER_URL: string;
declare const CHROME_WINDOW_VITE_NAME: string;
declare const CHAT_WINDOW_VITE_DEV_SERVER_URL: string;
declare const CHAT_WINDOW_VITE_NAME: string;
