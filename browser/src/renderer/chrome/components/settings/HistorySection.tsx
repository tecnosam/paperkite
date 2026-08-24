import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryEntry, HistoryPageResult } from '../../../../shared/types';
import { groupByDate } from '../../dateGroups';
import { SearchIcon, TrashIcon } from '../../icons';

interface HistorySectionProps {
  onOpenInNewTab: (url: string) => void;
}

const PAGE_SIZE = 40;
const SCROLL_THRESHOLD_PX = 120;
const SEARCH_DEBOUNCE_MS = 300;

function timeOfDay(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Owns its own data end to end - browsing history can run into the
 * thousands of entries, so unlike the other settings sections this one
 * never holds (or is handed) the full list. It fetches one page at a time
 * from main (see historyStore.getHistoryPage()) as the user scrolls or
 * searches, rather than the whole-list-broadcast pattern the rest of
 * Settings uses.
 */
export function HistorySection({ onOpenInNewTab }: HistorySectionProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const debouncedQueryRef = useRef(debouncedQuery);
  const loadingRef = useRef(loading);
  const hasMoreRef = useRef(hasMore);
  const entriesLengthRef = useRef(0);

  debouncedQueryRef.current = debouncedQuery;
  loadingRef.current = loading;
  hasMoreRef.current = hasMore;
  entriesLengthRef.current = entries.length;

  // Debounce the search box so every keystroke doesn't round-trip to main.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Subscribe once; each response carries the query it answers so a
  // response for a query the user has since changed away from (or a
  // response that arrives after a reset) is discarded rather than
  // corrupting the list.
  useEffect(() => {
    return window.paperkite.onHistoryPage((result: HistoryPageResult) => {
      if (result.query !== debouncedQueryRef.current) return;
      setEntries((current) => (result.offset === 0 ? result.entries : [...current, ...result.entries]));
      setHasMore(result.hasMore);
      setLoading(false);
    });
  }, []);

  // Reset and fetch page 0 whenever the (debounced) search query changes,
  // including the initial mount.
  useEffect(() => {
    setEntries([]);
    setHasMore(true);
    setLoading(true);
    window.paperkite.requestHistoryPage({ offset: 0, limit: PAGE_SIZE, query: debouncedQuery });
  }, [debouncedQuery]);

  const loadMore = () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    setLoading(true);
    window.paperkite.requestHistoryPage({ offset: entriesLengthRef.current, limit: PAGE_SIZE, query: debouncedQueryRef.current });
  };

  // The list itself doesn't scroll independently - .settings-panel__content
  // (the nearest scrolling ancestor) does, same as every other section.
  useEffect(() => {
    const scroller = rootRef.current?.closest('.settings-panel__content');
    if (!scroller) return;
    const onScroll = () => {
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - SCROLL_THRESHOLD_PX) {
        loadMore();
      }
    };
    scroller.addEventListener('scroll', onScroll);
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  const groups = useMemo(() => groupByDate(entries), [entries]);

  const deleteEntry = (id: string) => {
    window.paperkite.deleteHistoryEntry(id);
    setEntries((current) => current.filter((e) => e.id !== id));
  };

  const clearHistory = () => {
    window.paperkite.clearHistory();
    setEntries([]);
    setHasMore(false);
    setConfirmingClear(false);
  };

  return (
    <section className="settings-section" ref={rootRef}>
      <h2>Browsing history</h2>

      <div className="settings-search">
        <SearchIcon />
        <input
          value={query}
          spellCheck={false}
          placeholder="Search history"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {entries.length === 0 && !loading ? (
        <p className="settings-hint">{query ? 'No matches.' : 'No browsing history yet.'}</p>
      ) : (
        groups.map((group) => (
          <div key={group.label}>
            <div className="settings-list__date-header">{group.label}</div>
            <ul className="settings-list">
              {group.entries.map((entry) => (
                <li key={entry.id} className="settings-list__row">
                  <button
                    type="button"
                    className="settings-list__main"
                    onClick={() => onOpenInNewTab(entry.url)}
                    title="Open in a new tab"
                  >
                    <span className="settings-list__title">{entry.title || entry.url}</span>
                    <span className="settings-list__url">{entry.url}</span>
                  </button>
                  <span className="settings-list__time">{timeOfDay(entry.timestamp)}</span>
                  <button
                    type="button"
                    className="settings-list__delete"
                    aria-label="Delete entry"
                    onClick={() => deleteEntry(entry.id)}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {loading && <div className="settings-list__loading spinner" aria-label="Loading" />}

      {entries.length > 0 && (
        <div className="settings-clear">
          {confirmingClear ? (
            <>
              <span className="settings-hint">This can't be undone.</span>
              <button type="button" className="settings-clear__cancel" onClick={() => setConfirmingClear(false)}>
                Cancel
              </button>
              <button type="button" className="settings-clear__confirm" onClick={clearHistory}>
                Clear all history
              </button>
            </>
          ) : (
            <button type="button" className="settings-clear__start" onClick={() => setConfirmingClear(true)}>
              Clear all history
            </button>
          )}
        </div>
      )}
    </section>
  );
}
