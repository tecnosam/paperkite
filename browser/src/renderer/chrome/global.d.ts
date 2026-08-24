import type { PaperkiteChromeApi } from '../../preload/chrome';

declare global {
  interface Window {
    paperkite: PaperkiteChromeApi;
  }
}

export {};
