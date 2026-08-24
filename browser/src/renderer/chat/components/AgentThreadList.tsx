import type { AgentConfig, AgentThread } from '../../../shared/types';
import { relativeTime } from '../../../shared/relativeTime';
import { TrashIcon } from '../icons';
import { ProviderBadge } from './ProviderBadge';
import { NewThreadDropdown } from './NewThreadDropdown';

interface AgentThreadListProps {
  agents: AgentConfig[];
  threads: AgentThread[];
  onSelectThread: (id: string) => void;
  onCreateThread: (agentId: string) => void;
  onDeleteThread: (id: string) => void;
}

export function AgentThreadList({ agents, threads, onSelectThread, onCreateThread, onDeleteThread }: AgentThreadListProps) {
  if (agents.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state__kite" aria-hidden>
          ✨
        </span>
        <p>Add an agent in Settings to start a private thread.</p>
      </div>
    );
  }

  return (
    <div className="agent-panel">
      <NewThreadDropdown agents={agents} onCreateThread={onCreateThread} />

      {threads.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__kite" aria-hidden>
            🪁
          </span>
          <p>No threads yet - start one above.</p>
        </div>
      ) : (
        <ul className="agent-thread-list">
          {threads.map((thread) => {
            const agent = agents.find((a) => a.id === thread.agentId);
            return (
              <li key={thread.id} className="agent-thread-list__row">
                <button type="button" className="agent-thread-list__main" onClick={() => onSelectThread(thread.id)}>
                  <span className="agent-thread-list__title">{thread.title}</span>
                  <span className="agent-thread-list__meta-row">
                    {agent ? (
                      <ProviderBadge provider={agent.provider} model={agent.model} />
                    ) : (
                      <span className="agent-thread-list__meta">Removed agent</span>
                    )}
                    <span className="agent-thread-list__meta">{relativeTime(thread.updatedAt)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="agent-thread-list__delete"
                  aria-label={`Delete thread "${thread.title}"`}
                  onClick={() => onDeleteThread(thread.id)}
                >
                  <TrashIcon size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
