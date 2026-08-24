/**
 * Preload script for the chat panel view. Exposes `window.paperkiteChat`,
 * a narrow, typed surface over the IPC contract in shared/ipcChannels.ts.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/ipcChannels';
import type {
  RoomChangedPayload,
  MessagesPayload,
  SafetySettings,
  ThemePayload,
  DomainTrustLists,
  MessageAttachment,
  ImageSavedResult,
  ScreenshotChainResult,
  AgentConfig,
  AgentThread,
  SendAgentMessagePayload,
  RetryAgentMessagePayload,
  AgentMessagesPayload,
  AgentMessageAddedPayload,
  AgentMessageChunkPayload,
  AgentMessageDonePayload,
  AgentMessageErrorPayload,
  AgentMessageStatusPayload,
  ChatServersPayload,
  ActiveChatServerPayload,
  ChatConnectionStatus,
} from '../shared/types';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  // commands
  sendMessage: (text: string) => ipcRenderer.send(IPC.SEND_MESSAGE, text),
  /** Opens a trusted chat link in a new browser tab. */
  openLink: (url: string) => ipcRenderer.send(IPC.OPEN_LINK, url),
  /** Tell main the UI has mounted and is ready to receive the current room. */
  ready: () => ipcRenderer.send(IPC.CHAT_READY),
  /** `null` clears this tab's override, going back to whatever the global
   * default is. */
  setActiveChatServer: (id: string | null) => ipcRenderer.send(IPC.SET_ACTIVE_CHAT_SERVER, id),
  requestChatServers: () => ipcRenderer.send(IPC.REQUEST_CHAT_SERVERS),
  /** "Go fix this server's username" - see UsernameTakenModal.tsx. Chrome
   * owns Settings (a separate renderer), so this is relayed through main. */
  requestOpenChatServerSettings: (serverId: string) => ipcRenderer.send(IPC.REQUEST_OPEN_CHAT_SERVER_SETTINGS, serverId),
  /** Asks main to capture the active tab's current viewport - result (or
   * null on failure) comes back on onScreenshotCaptured. */
  captureScreenshot: () => ipcRenderer.send(IPC.CAPTURE_SCREENSHOT),
  /** The image lightbox needs main to grow the chat view to full-window
   * size first - it's normally clipped to the CHAT_WIDTH sidebar. Call
   * with `false` when the lightbox closes. */
  setOverlayOpen: (open: boolean) => ipcRenderer.send(IPC.SET_CHAT_OVERLAY, open),
  /** Saves a screenshot's data URL to the Downloads folder - result comes
   * back on onImageSaved. */
  saveImage: (dataUrl: string) => ipcRenderer.send(IPC.SAVE_IMAGE, dataUrl),
  /** Asks main for the small window of screenshots before/after this one
   * (across every room) - result comes back on onScreenshotChain. */
  requestScreenshotChain: (attachmentId: string) => ipcRenderer.send(IPC.REQUEST_SCREENSHOT_CHAIN, attachmentId),
  /** Asks main for the current list of configured agents - result comes
   * back on onAgentsUpdated (same channel Settings uses to push updates). */
  requestAgents: () => ipcRenderer.send(IPC.REQUEST_AGENTS),
  requestAgentThreads: () => ipcRenderer.send(IPC.REQUEST_AGENT_THREADS),
  createAgentThread: (agentId: string) => ipcRenderer.send(IPC.CREATE_AGENT_THREAD, agentId),
  deleteAgentThread: (threadId: string) => ipcRenderer.send(IPC.DELETE_AGENT_THREAD, threadId),
  requestAgentMessages: (threadId: string) => ipcRenderer.send(IPC.REQUEST_AGENT_MESSAGES, threadId),
  sendAgentMessage: (payload: SendAgentMessagePayload) => ipcRenderer.send(IPC.SEND_AGENT_MESSAGE, payload),
  stopAgentMessage: (threadId: string) => ipcRenderer.send(IPC.STOP_AGENT_MESSAGE, threadId),
  retryAgentMessage: (payload: RetryAgentMessagePayload) => ipcRenderer.send(IPC.RETRY_AGENT_MESSAGE, payload),

  // events
  onRoomChanged: (cb: (payload: RoomChangedPayload) => void) => subscribe(IPC.ROOM_CHANGED, cb),
  onMessages: (cb: (payload: MessagesPayload) => void) => subscribe(IPC.MESSAGES, cb),
  onSafetySettings: (cb: (settings: SafetySettings) => void) => subscribe(IPC.SAFETY_SETTINGS, cb),
  onTheme: (cb: (payload: ThemePayload) => void) => subscribe(IPC.THEME, cb),
  onDomainTrust: (cb: (lists: DomainTrustLists) => void) => subscribe(IPC.DOMAIN_TRUST, cb),
  onChatServersUpdated: (cb: (payload: ChatServersPayload) => void) => subscribe(IPC.CHAT_SERVERS_UPDATED, cb),
  onActiveChatServer: (cb: (payload: ActiveChatServerPayload) => void) => subscribe(IPC.ACTIVE_CHAT_SERVER, cb),
  onChatConnectionStatus: (cb: (status: ChatConnectionStatus) => void) => subscribe(IPC.CHAT_CONNECTION_STATUS, cb),
  onScreenshotCaptured: (cb: (result: MessageAttachment | null) => void) => subscribe(IPC.SCREENSHOT_CAPTURED, cb),
  onImageSaved: (cb: (result: ImageSavedResult) => void) => subscribe(IPC.IMAGE_SAVED, cb),
  onScreenshotChain: (cb: (result: ScreenshotChainResult) => void) => subscribe(IPC.SCREENSHOT_CHAIN, cb),
  onAgentsUpdated: (cb: (configs: AgentConfig[]) => void) => subscribe(IPC.AGENTS_UPDATED, cb),
  onAgentThreads: (cb: (threads: AgentThread[]) => void) => subscribe(IPC.AGENT_THREADS, cb),
  onAgentMessages: (cb: (payload: AgentMessagesPayload) => void) => subscribe(IPC.AGENT_MESSAGES, cb),
  onAgentMessageAdded: (cb: (payload: AgentMessageAddedPayload) => void) => subscribe(IPC.AGENT_MESSAGE_ADDED, cb),
  onAgentMessageChunk: (cb: (payload: AgentMessageChunkPayload) => void) => subscribe(IPC.AGENT_MESSAGE_CHUNK, cb),
  onAgentMessageDone: (cb: (payload: AgentMessageDonePayload) => void) => subscribe(IPC.AGENT_MESSAGE_DONE, cb),
  onAgentMessageError: (cb: (payload: AgentMessageErrorPayload) => void) => subscribe(IPC.AGENT_MESSAGE_ERROR, cb),
  onAgentMessageStatus: (cb: (payload: AgentMessageStatusPayload) => void) => subscribe(IPC.AGENT_MESSAGE_STATUS, cb),
  onAgentMessageRetry: (cb: (payload: RetryAgentMessagePayload) => void) => subscribe(IPC.AGENT_MESSAGE_RETRY, cb),
};

export type PaperkiteChatApi = typeof api;

contextBridge.exposeInMainWorld('paperkiteChat', api);
