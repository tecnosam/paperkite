import { useEffect, useState } from 'react';
import type {
  ChatMessage,
  SafetySettings,
  ThemePayload,
  DomainTrustLists,
  MessageAttachment,
  ChatServerConfig,
  ChatConnectionStatus,
} from '../../shared/types';
import { DEFAULT_SAFETY_SETTINGS, DEFAULT_DOMAIN_TRUST_LISTS } from '../../shared/types';
import { MessageList } from './components/MessageList';
import { MessageInput } from './components/MessageInput';
import { SetUsernameCta } from './components/SetUsernameCta';
import { ChatServerPicker } from './components/ChatServerPicker';
import { ImageLightbox } from './components/ImageLightbox';
import { UsernameTakenModal } from './components/UsernameTakenModal';
import { AgentPanel } from './components/AgentPanel';
import { ChatBubbleIcon, SparkleIcon } from './icons';

type Mode = 'page' | 'agents';

export function App() {
  const [mode, setMode] = useState<Mode>('page');
  const [url, setUrl] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [safety, setSafety] = useState<SafetySettings>(DEFAULT_SAFETY_SETTINGS);
  const [theme, setTheme] = useState<ThemePayload>({ source: 'system', isDark: false });
  const [domainTrust, setDomainTrust] = useState<DomainTrustLists>(DEFAULT_DOMAIN_TRUST_LISTS);
  const [lightboxAttachment, setLightboxAttachment] = useState<MessageAttachment | null>(null);

  const [chatServers, setChatServers] = useState<ChatServerConfig[]>([]);
  const [defaultServerId, setDefaultServerId] = useState<string | null>(null);
  const [overrideServerId, setOverrideServerId] = useState<string | null>(null);
  const [effectiveServerId, setEffectiveServerId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ChatConnectionStatus>({ state: 'idle', url: null });
  // Pin state lives entirely client-side now - the chat-service protocol has
  // no concept of it (see shared/types.ts's ChatMessage doc comment).
  // Keyed by message id, reset whenever the room itself changes below.
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  // Lets the username-taken modal be dismissed without fixing it (see
  // usernameTakenKey below) - keyed so a NEW instance of the same failure
  // (server switched away and back, or a different rejected name) shows
  // again rather than staying permanently dismissed.
  const [dismissedUsernameTakenKey, setDismissedUsernameTakenKey] = useState<string | null>(null);

  useEffect(() => {
    const unsubs = [
      window.paperkiteChat.onRoomChanged((payload) => setUrl(payload.url)),
      window.paperkiteChat.onMessages((payload) => {
        // Ignore a stale delivery for a room we've since navigated away from.
        setUrl((current) => {
          if (current === '' || current === payload.url) setMessages(payload.list);
          return current;
        });
      }),
      window.paperkiteChat.onSafetySettings(setSafety),
      window.paperkiteChat.onTheme(setTheme),
      window.paperkiteChat.onDomainTrust(setDomainTrust),
      window.paperkiteChat.onChatServersUpdated((payload) => {
        setChatServers(payload.servers);
        setDefaultServerId(payload.defaultServerId);
      }),
      window.paperkiteChat.onActiveChatServer((payload) => {
        setOverrideServerId(payload.overrideServerId);
        setEffectiveServerId(payload.effectiveServerId);
      }),
      window.paperkiteChat.onChatConnectionStatus(setConnectionStatus),
    ];
    window.paperkiteChat.ready();
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  // Identity is per-server now, not a single global username (see
  // shared/types.ts's ChatServerConfig.username) - "am I connected as
  // someone" means "does the room's effective server have a username set."
  const effectiveServer = chatServers.find((s) => s.id === effectiveServerId) ?? null;
  const myUsername = effectiveServer?.username ?? null;

  const usernameTakenKey =
    connectionStatus.state === 'error' && connectionStatus.reason === 'username-taken' && effectiveServer
      ? `${effectiveServer.id}:${effectiveServer.username}`
      : null;
  const showUsernameTakenModal = usernameTakenKey !== null && usernameTakenKey !== dismissedUsernameTakenKey;

  // A new room starts with nothing pinned - carrying pins over from
  // whatever page was open before would just be confusing.
  useEffect(() => setPinnedIds(new Set()), [url]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme.isDark ? 'dark' : 'light';
  }, [theme.isDark]);

  // The lightbox and the username-taken modal only render full-screen
  // because main grows the chat view to cover the whole window while
  // either's open - see WindowManager.setChatFullscreen. Only one is ever
  // shown at a time in practice, but OR them together regardless so
  // neither accidentally shrinks the view out from under the other.
  useEffect(() => {
    window.paperkiteChat.setOverlayOpen(lightboxAttachment !== null || showUsernameTakenModal);
  }, [lightboxAttachment, showUsernameTakenModal]);

  const togglePin = (id: string) => {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const currentPageHost = safeHostname(url);
  // Sending only actually works once chatSession.ts has a live token (see
  // main/chatSession.ts's sendChatMessage) - gating on username alone let
  // a message through while still connecting/erroring/unconfigured, which
  // just threw "Not connected to a chat server" in the main process with
  // no feedback in the UI at all. Gate on the real connection state too.
  const inputDisabled = !myUsername || connectionStatus.state !== 'connected';

  return (
    <div className="chat">
      <header className="chat__header">
        <div className="chat__header-row">
          <div className="chat__header-info">
            <span className="chat__label">{mode === 'page' ? 'Page chat' : 'Agents'}</span>
            <span className="chat__url">{mode === 'page' ? url.replace(/^https?:\/\//, '') : 'Private, page-independent'}</span>
          </div>
          <div className="chat__mode-toggle" role="radiogroup" aria-label="Chat mode">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'page'}
              aria-label="Page chat"
              title="Page chat"
              className={'chat__mode-btn' + (mode === 'page' ? ' chat__mode-btn--active' : '')}
              onClick={() => setMode('page')}
            >
              <ChatBubbleIcon size={14} />
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'agents'}
              aria-label="AI agents"
              title="AI agents"
              className={'chat__mode-btn' + (mode === 'agents' ? ' chat__mode-btn--active' : '')}
              onClick={() => setMode('agents')}
            >
              <SparkleIcon size={14} />
            </button>
          </div>
        </div>
        {mode === 'page' && (
          <ChatServerPicker
            servers={chatServers}
            defaultServerId={defaultServerId}
            overrideServerId={overrideServerId}
            status={connectionStatus}
            onSelect={(id) => window.paperkiteChat.setActiveChatServer(id)}
          />
        )}
      </header>

      {mode === 'page' ? (
        <>
          <MessageList
            messages={messages}
            username={myUsername}
            safety={safety}
            currentPageHost={currentPageHost}
            url={url}
            domainTrust={domainTrust}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            onImageClick={setLightboxAttachment}
          />

          {effectiveServer && !effectiveServer.username ? (
            <SetUsernameCta
              serverName={effectiveServer.name}
              onOpenSettings={() => window.paperkiteChat.requestOpenChatServerSettings(effectiveServer.id)}
            />
          ) : (
            <MessageInput
              disabled={inputDisabled}
              placeholder={inputPlaceholderFor(effectiveServer, connectionStatus)}
              onSend={(content) => window.paperkiteChat.sendMessage(content)}
            />
          )}
        </>
      ) : (
        <AgentPanel onImageClick={setLightboxAttachment} />
      )}

      {lightboxAttachment && <ImageLightbox attachment={lightboxAttachment} onClose={() => setLightboxAttachment(null)} />}
      {showUsernameTakenModal && effectiveServer && (
        <UsernameTakenModal
          serverName={effectiveServer.name}
          username={effectiveServer.username ?? ''}
          onOpenSettings={() => window.paperkiteChat.requestOpenChatServerSettings(effectiveServer.id)}
          onDismiss={() => setDismissedUsernameTakenKey(usernameTakenKey)}
        />
      )}
    </div>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Explains *why* the input is disabled, rather than one generic message
 * for every case - showing the same text whether the panel was mid-connect
 * or genuinely erroring would read as if there were only ever one thing
 * standing between the user and sending. The "no username yet" case is
 * handled separately, by SetUsernameCta replacing this input entirely
 * rather than a placeholder on a disabled textarea - by the time this
 * runs, effectiveServer is known to either be null or have a username. */
function inputPlaceholderFor(effectiveServer: ChatServerConfig | null, status: ChatConnectionStatus): string {
  if (!effectiveServer) return 'No chat server configured';
  switch (status.state) {
    case 'connecting':
      return 'Connecting…';
    case 'error':
      return status.error ?? 'Not connected - try again shortly';
    case 'idle':
      return 'No chat server configured';
    case 'connected':
      return 'Say something about this page…';
  }
}
