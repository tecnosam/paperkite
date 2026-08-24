import type { PaperkiteChatApi } from '../../preload/chat';

declare global {
  interface Window {
    paperkiteChat: PaperkiteChatApi;
  }
}

export {};
