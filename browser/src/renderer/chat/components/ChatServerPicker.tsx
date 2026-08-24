import { useEffect, useRef, useState } from 'react';
import type { ChatServerConfig, ChatConnectionStatus } from '../../../shared/types';
import { ChevronDownIcon, ServerIcon } from '../icons';

interface ChatServerPickerProps {
  servers: ChatServerConfig[];
  defaultServerId: string | null;
  /** This tab's own pick, or null to follow the global default - see
   * Tab.chatServerId in main/tabManager.ts. */
  overrideServerId: string | null;
  status: ChatConnectionStatus;
  onSelect: (id: string | null) => void;
}

/** Per-tab chat-server picker, in the page-chat header - lets a tab join a
 * different configured server than the GLOBAL default (see
 * main/chatServerStore.ts) without affecting any other tab. Adding/removing
 * servers themselves happens in Settings > Chat Servers; this is purely a
 * per-tab "which one" switch, mirroring NewThreadDropdown's trigger+menu
 * shape. */
export function ChatServerPicker({ servers, defaultServerId, overrideServerId, status, onSelect }: ChatServerPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const defaultServer = servers.find((s) => s.id === defaultServerId) ?? null;
  const effectiveServer = (overrideServerId && servers.find((s) => s.id === overrideServerId)) || defaultServer;
  const label = effectiveServer ? effectiveServer.name : servers.length === 0 ? 'No chat servers' : 'No default set';

  return (
    <div className="chat-server-picker" ref={rootRef}>
      <button
        type="button"
        className={'chat-server-picker__trigger' + (open ? ' chat-server-picker__trigger--open' : '')}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Chat server for this tab"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={'chat-server-picker__dot chat-server-picker__dot--' + status.state} aria-hidden />
        <ServerIcon size={12} />
        <span className="chat-server-picker__label">{label}</span>
        <ChevronDownIcon size={10} />
      </button>

      {open && (
        <ul className="chat-server-picker__menu" role="listbox">
          {servers.length === 0 ? (
            <li className="chat-server-picker__empty">Add a server in Settings → Chat Servers</li>
          ) : (
            <>
              <li role="option" aria-selected={overrideServerId === null}>
                <button
                  type="button"
                  className={'chat-server-picker__item' + (overrideServerId === null ? ' chat-server-picker__item--active' : '')}
                  onClick={() => {
                    setOpen(false);
                    onSelect(null);
                  }}
                >
                  <span className="chat-server-picker__item-name">
                    Follow default{defaultServer ? ` (${defaultServer.name})` : ''}
                  </span>
                </button>
              </li>
              {servers.map((server) => (
                <li key={server.id} role="option" aria-selected={overrideServerId === server.id}>
                  <button
                    type="button"
                    className={
                      'chat-server-picker__item' + (overrideServerId === server.id ? ' chat-server-picker__item--active' : '')
                    }
                    onClick={() => {
                      setOpen(false);
                      onSelect(server.id);
                    }}
                  >
                    <span className="chat-server-picker__item-name">{server.name}</span>
                    {server.id === defaultServerId && <span className="chat-server-picker__item-badge">default</span>}
                  </button>
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
