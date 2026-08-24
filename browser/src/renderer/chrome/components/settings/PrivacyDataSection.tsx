import { useEffect, useState } from 'react';
import type { DataUsageSummary } from '../../../../shared/types';
import { GlobeIcon, StarIcon, ChatIcon, TrashIcon } from '../../icons';

type Category = 'history' | 'bookmarks' | 'agents';

interface CategoryDef {
  id: Category;
  label: string;
  description: string;
  countLabel: string;
}

const CATEGORIES: CategoryDef[] = [
  {
    id: 'history',
    label: 'Browsing history',
    description: 'Every page you’ve visited - also what powers the address bar’s suggestions.',
    countLabel: 'pages visited',
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    description: 'Saved pages and folders.',
    countLabel: 'bookmarks saved',
  },
  {
    id: 'agents',
    label: 'Agent chats',
    description: 'Private conversations with your configured AI agents.',
    countLabel: 'threads saved',
  },
];

function categoryIcon(id: Category) {
  switch (id) {
    case 'history':
      return <GlobeIcon size={15} />;
    case 'bookmarks':
      return <StarIcon size={14} />;
    case 'agents':
      return <ChatIcon size={15} />;
  }
}

function categoryCount(summary: DataUsageSummary | null, id: Category): number | null {
  if (!summary) return null;
  if (id === 'history') return summary.historyCount;
  if (id === 'bookmarks') return summary.bookmarkCount;
  return summary.agentThreadCount;
}

/** Settings > Privacy & Data - per-category "clear everything stored
 * locally" actions. Self-contained, like McpSection/AgentsSection - owns
 * its own IPC subscription rather than getting the summary as a prop.
 * Deliberately three separate actions rather than one "clear everything"
 * button - matches the existing per-section clear pattern (see
 * HistorySection) and means a misclick only ever costs one category, not
 * all of it. */
export function PrivacyDataSection() {
  const [summary, setSummary] = useState<DataUsageSummary | null>(null);
  const [confirming, setConfirming] = useState<Category | null>(null);

  useEffect(() => {
    const unsub = window.paperkite.onDataUsageSummary(setSummary);
    window.paperkite.requestDataUsageSummary();
    return unsub;
  }, []);

  const clear = (id: Category) => {
    if (id === 'history') window.paperkite.clearHistory();
    if (id === 'bookmarks') window.paperkite.clearAllBookmarks();
    if (id === 'agents') window.paperkite.clearAllAgentThreads();
    setConfirming(null);
    // Zero out optimistically - main doesn't push a fresh summary on its
    // own after a clear (only BOOKMARKS_UPDATED/AGENT_THREADS go out, for
    // whichever other section is showing that list), so ask again too.
    setSummary((current) =>
      current
        ? {
            historyCount: id === 'history' ? 0 : current.historyCount,
            bookmarkCount: id === 'bookmarks' ? 0 : current.bookmarkCount,
            agentThreadCount: id === 'agents' ? 0 : current.agentThreadCount,
          }
        : current,
    );
    window.paperkite.requestDataUsageSummary();
  };

  return (
    <section className="settings-section">
      <h2>Privacy &amp; data</h2>
      <p className="settings-hint">
        Everything below lives only on this device - nothing here is synced anywhere. Clearing a category can&rsquo;t
        be undone.
      </p>

      <div className="data-usage-list">
        {CATEGORIES.map((cat) => {
          const count = categoryCount(summary, cat.id);
          return (
            <div className="data-usage-card" key={cat.id}>
              <div className="data-usage-card__icon">{categoryIcon(cat.id)}</div>
              <div className="data-usage-card__main">
                <span className="data-usage-card__label">{cat.label}</span>
                <span className="data-usage-card__desc">{cat.description}</span>
              </div>
              <div className="data-usage-card__count">
                <span className="data-usage-card__count-number">{count ?? '–'}</span>
                <span className="data-usage-card__count-label">{cat.countLabel}</span>
              </div>
              {confirming === cat.id ? (
                <div className="data-usage-card__confirm">
                  <button type="button" className="settings-clear__cancel" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  <button type="button" className="settings-clear__confirm" onClick={() => clear(cat.id)}>
                    Clear
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="data-usage-card__clear"
                  disabled={!count}
                  aria-label={`Clear ${cat.label.toLowerCase()}`}
                  title={`Clear ${cat.label.toLowerCase()}`}
                  onClick={() => setConfirming(cat.id)}
                >
                  <TrashIcon size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
