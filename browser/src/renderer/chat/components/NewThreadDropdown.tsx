import { useEffect, useRef, useState } from 'react';
import type { AgentConfig } from '../../../shared/types';
import { ChevronDownIcon, PlusIcon } from '../icons';
import { ProviderBadge } from './ProviderBadge';

interface NewThreadDropdownProps {
  agents: AgentConfig[];
  onCreateThread: (agentId: string) => void;
}

/** Collapses the "start a new thread" agent picker into a single dropdown
 * trigger, so the list of configured agents doesn't permanently eat space
 * at the top of the thread list as it grows. Picking an agent creates and
 * opens a thread immediately - there's no separate confirm step, matching
 * how every other one-tap action in this panel already behaves. */
export function NewThreadDropdown({ agents, onCreateThread }: NewThreadDropdownProps) {
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

  return (
    <div className="new-thread-dropdown" ref={rootRef}>
      <button
        type="button"
        className={'new-thread-dropdown__trigger' + (open ? ' new-thread-dropdown__trigger--open' : '')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <PlusIcon size={11} />
        <span>New thread</span>
        <ChevronDownIcon size={11} />
      </button>

      {open && (
        <ul className="new-thread-dropdown__menu" role="listbox">
          {agents.map((agent) => (
            <li key={agent.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="new-thread-dropdown__item"
                onClick={() => {
                  setOpen(false);
                  onCreateThread(agent.id);
                }}
              >
                <span className="new-thread-dropdown__item-name">{agent.name}</span>
                <ProviderBadge provider={agent.provider} model={agent.model} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
