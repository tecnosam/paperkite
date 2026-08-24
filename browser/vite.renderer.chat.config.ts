import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: path.join(__dirname, 'src/renderer/chat'),
  // Vite's default cacheDir resolves to the nearest node_modules from
  // `root` upward - since src/renderer/chat has no node_modules of its
  // own, that's the same top-level node_modules/.vite the chrome
  // renderer's dev server also defaults to. Both dev servers start
  // concurrently, so without distinct cacheDirs they race to
  // pre-bundle deps into the same directory and clobber each other's
  // cache - whichever one loses serves stale/404 chunks on first load
  // (this is what a "window refuses to open, but a manual reload fixes
  // it" report almost always is).
  cacheDir: path.join(__dirname, 'node_modules/.vite-chat'),
  build: {
    // See vite.renderer.chrome.config.ts's matching comment - forge's
    // relative `.vite/renderer/chat_window` outDir would otherwise
    // resolve against `root` above and land inside
    // src/renderer/chat/.vite/..., which electron-packager never
    // includes in the packaged app.
    outDir: path.join(__dirname, '.vite/renderer/chat_window'),
  },
  plugins: [react()],
});
