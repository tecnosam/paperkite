import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The chrome renderer's index.html lives in its own folder so Vite can
// resolve it as this renderer's root, independent of the chat renderer.
export default defineConfig({
  root: path.join(__dirname, 'src/renderer/chrome'),
  // See vite.renderer.chat.config.ts - each renderer's dev server needs
  // its own cacheDir, or the two concurrently-starting servers clobber
  // a shared default one.
  cacheDir: path.join(__dirname, 'node_modules/.vite-chrome'),
  build: {
    // electron-forge's own vite plugin sets `outDir: '.vite/renderer/chrome_window'`
    // (a path relative to `root`) before merging in this file - since
    // `root` above points into src/renderer/chrome, that relative path
    // would resolve to src/renderer/chrome/.vite/renderer/chrome_window
    // instead of <project root>/.vite/renderer/chrome_window, silently
    // building into a directory electron-packager never picks up (it
    // only packages `<project root>/.vite/**`). An absolute path here
    // resolves the same regardless of `root`, fixing that without
    // touching dev-server behavior.
    outDir: path.join(__dirname, '.vite/renderer/chrome_window'),
  },
  plugins: [react()],
});
