import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  NavState,
  BookmarkEntry,
  BookmarkFolder,
  SubtitleSettings,
  PageTranslateSettings,
  PageTranslateStatusPayload,
  HistoryEntry,
} from '../../../shared/types';
import {
  BackIcon,
  ForwardIcon,
  ReloadIcon,
  StopIcon,
  ChatIcon,
  GearIcon,
  StarIcon,
  DownloadIcon,
  SubtitlesIcon,
  TranslateIcon,
  GlobeIcon,
} from '../icons';
import { BookmarkPopover } from './BookmarkPopover';
import { SubtitlePopover } from './SubtitlePopover';
import { PageTranslatePopover } from './PageTranslatePopover';

/** How long to wait after the last keystroke before asking main for
 * matching history - snappier than Settings' own history search (300ms,
 * see HistorySection.tsx) since this is inline typeahead, not a results
 * list the user is calmly scrolling. */
const SUGGEST_DEBOUNCE_MS = 120;
const MAX_SUGGESTIONS = 5;
const MAX_BOOKMARK_SUGGESTIONS = 3;
// Raw history matches fetched from main, before deduping by URL below -
// generous on purpose. Visiting the same page repeatedly is the common
// case (nothing dedupes on write, see historyStore.recordVisit), so the
// newest MAX_SUGGESTIONS matches alone could easily all be the same URL,
// leaving fewer than MAX_SUGGESTIONS truly distinct results after dedup.
const HISTORY_FETCH_LIMIT = 30;

interface AddressSuggestion {
  id: string;
  title: string;
  url: string;
  isBookmark: boolean;
}

interface ToolbarProps {
  navState: NavState | null;
  chatOpen: boolean;
  bookmarkEntry: BookmarkEntry | null;
  bookmarks: BookmarkEntry[];
  folders: BookmarkFolder[];
  bookmarkPopoverOpen: boolean;
  subtitleSettings: SubtitleSettings;
  subtitlePopoverOpen: boolean;
  pageTranslateSettings: PageTranslateSettings;
  pageTranslatePopoverOpen: boolean;
  pageTranslateStatus: PageTranslateStatusPayload;
  hasActiveDownload: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onNavigate: (input: string) => void;
  onToggleChat: () => void;
  onOpenSettings: () => void;
  onStarClick: () => void;
  onCloseBookmarkPopover: () => void;
  onRenameBookmark: (id: string, title: string) => void;
  onMoveBookmark: (id: string, folderId: string | null) => void;
  onRemoveBookmark: (id: string) => void;
  onCreateBookmarkFolder: (name: string, parentId: string | null) => void;
  onSubtitlesClick: () => void;
  onCloseSubtitlePopover: () => void;
  onChangeSubtitleSettings: (settings: SubtitleSettings) => void;
  onPageTranslateClick: () => void;
  onClosePageTranslatePopover: () => void;
  onChangePageTranslateSettings: (settings: PageTranslateSettings) => void;
  onOpenDownloads: () => void;
  /** Mirrors "are address bar suggestions currently showing" up to App.tsx,
   * which ORs it together with the bookmark/subtitle popover flags before
   * calling setToolbarPopoverOpen (see main/layout.ts's
   * TOOLBAR_POPOVER_HEIGHT) - without this, the dropdown's own DOM renders
   * fine but is invisibly clipped, since the native chrome view's bounds
   * never actually grow to make room for it. */
  onSuggestionsOpenChange: (open: boolean) => void;
}

export function Toolbar({
  navState,
  chatOpen,
  bookmarkEntry,
  bookmarks,
  folders,
  bookmarkPopoverOpen,
  subtitleSettings,
  subtitlePopoverOpen,
  pageTranslateSettings,
  pageTranslatePopoverOpen,
  pageTranslateStatus,
  hasActiveDownload,
  onBack,
  onForward,
  onReload,
  onNavigate,
  onToggleChat,
  onOpenSettings,
  onStarClick,
  onCloseBookmarkPopover,
  onRenameBookmark,
  onMoveBookmark,
  onRemoveBookmark,
  onCreateBookmarkFolder,
  onSubtitlesClick,
  onCloseSubtitlePopover,
  onChangeSubtitleSettings,
  onPageTranslateClick,
  onClosePageTranslatePopover,
  onChangePageTranslateSettings,
  onOpenDownloads,
  onSuggestionsOpenChange,
}: ToolbarProps) {
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [historyMatches, setHistoryMatches] = useState<HistoryEntry[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  // Mirrors the in-flight query so the HISTORY_PAGE handler (subscribed
  // once, not re-subscribed per keystroke) can tell a fresh response from
  // a stale one for a query the user's since typed past - same pattern
  // HistorySection.tsx uses for its own search.
  const pendingQueryRef = useRef('');

  // Only sync the address bar from nav state while the user isn't
  // actively typing in it - otherwise every navigation event would stomp
  // on whatever they're mid-way through entering.
  useEffect(() => {
    if (!editing) {
      setValue(displayUrl(navState?.url ?? ''));
    }
  }, [navState?.url, editing]);

  // Cmd/Ctrl+L (main/appMenu.ts) - focus() below triggers the input's own
  // onFocus handler, which already selects all text on focus.
  useEffect(() => window.paperkite.onFocusAddressBar(() => inputRef.current?.focus()), []);

  // History search for the suggestion dropdown below - reuses the exact
  // same REQUEST_HISTORY_PAGE/HISTORY_PAGE channel Settings > History uses
  // (see main/historyStore.ts's getHistoryPage - case-insensitive substring
  // match against title OR url already, nothing extra needed server-side).
  useEffect(() => {
    return window.paperkite.onHistoryPage((result) => {
      if (result.query !== pendingQueryRef.current) return; // stale - superseded by a later keystroke
      setHistoryMatches(result.entries);
    });
  }, []);

  useEffect(() => {
    const trimmed = value.trim();
    if (!editing || !trimmed) {
      setHistoryMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      pendingQueryRef.current = trimmed;
      window.paperkite.requestHistoryPage({ offset: 0, limit: HISTORY_FETCH_LIMIT, query: trimmed });
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, editing]);

  // Bookmarks are already held in full in App.tsx's own state (pushed on
  // every change, see BOOKMARKS_UPDATED) - filtering them client-side is
  // free, no IPC round trip needed the way history's search requires one.
  // Bookmarks lead (Chrome's own omnibox does the same - a bookmark match
  // is a stronger signal than a plain visit), deduped against history by
  // URL so the same page never shows up twice - and history itself is
  // deduped by URL too (see below), capped at MAX_SUGGESTIONS total.
  const suggestions = useMemo<AddressSuggestion[]>(() => {
    const trimmed = value.trim().toLowerCase();
    if (!editing || !trimmed) return [];

    const bookmarkMatches = bookmarks
      .filter((b) => b.title.toLowerCase().includes(trimmed) || b.url.toLowerCase().includes(trimmed))
      .slice(0, MAX_BOOKMARK_SUGGESTIONS)
      .map((b): AddressSuggestion => ({ id: `bm-${b.id}`, title: b.title, url: b.url, isBookmark: true }));

    // historyMatches is already newest-first (see historyStore.getHistoryPage),
    // so keeping only the first occurrence per URL is exactly an LRU
    // filter: the most recent visit to a repeatedly-visited page wins,
    // older visits to the same URL are dropped rather than cluttering the
    // list with duplicates.
    const seenUrls = new Set(bookmarkMatches.map((b) => b.url));
    const historyResults: AddressSuggestion[] = [];
    for (const h of historyMatches) {
      if (seenUrls.has(h.url)) continue;
      seenUrls.add(h.url);
      historyResults.push({ id: `h-${h.id}`, title: h.title, url: h.url, isBookmark: false });
      if (bookmarkMatches.length + historyResults.length >= MAX_SUGGESTIONS) break;
    }

    return [...bookmarkMatches, ...historyResults];
  }, [value, editing, bookmarks, historyMatches]);

  // A fresh keystroke invalidates whatever was highlighted - re-highlighting
  // by position rather than by identity would silently select the wrong
  // (now-different) suggestion.
  useEffect(() => setHighlightedIndex(-1), [value]);

  const hasSuggestions = suggestions.length > 0;
  useEffect(() => onSuggestionsOpenChange(hasSuggestions), [hasSuggestions, onSuggestionsOpenChange]);

  const submit = () => {
    if (value.trim()) onNavigate(value.trim());
    inputRef.current?.blur();
  };

  const selectSuggestion = (suggestion: AddressSuggestion) => {
    onNavigate(suggestion.url);
    inputRef.current?.blur();
  };

  return (
    <div className="toolbar">
      <div className="toolbar__nav">
        <button type="button" disabled={!navState?.canGoBack} onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
        <button type="button" disabled={!navState?.canGoForward} onClick={onForward} aria-label="Forward">
          <ForwardIcon />
        </button>
        <button type="button" onClick={onReload} aria-label={navState?.loading ? 'Stop' : 'Reload'}>
          {navState?.loading ? <StopIcon /> : <ReloadIcon />}
        </button>
      </div>

      <div className={'address-bar' + (editing ? ' address-bar--editing' : '')}>
        <input
          ref={inputRef}
          value={value}
          spellCheck={false}
          placeholder="Search or enter a URL"
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls="address-bar-suggestions"
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onBlur={() => setEditing(false)}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              if (suggestions.length === 0) return;
              e.preventDefault();
              setHighlightedIndex((i) => (i + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp') {
              if (suggestions.length === 0) return;
              e.preventDefault();
              setHighlightedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
            } else if (e.key === 'Enter') {
              const highlighted = suggestions[highlightedIndex];
              if (highlighted) selectSuggestion(highlighted);
              else submit();
            } else if (e.key === 'Escape') {
              e.currentTarget.blur();
            }
          }}
        />
        {suggestions.length > 0 && (
          <ul className="address-bar-suggestions" id="address-bar-suggestions" role="listbox">
            {suggestions.map((suggestion, i) => (
              <li key={suggestion.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlightedIndex}
                  tabIndex={-1}
                  className={
                    'address-bar-suggestions__item' + (i === highlightedIndex ? ' address-bar-suggestions__item--active' : '')
                  }
                  // mousedown (not click) + preventDefault stops the input
                  // from blurring first - a click alone would fire onBlur
                  // (unmounting this list) before the click itself lands.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSuggestion(suggestion);
                  }}
                  onMouseEnter={() => setHighlightedIndex(i)}
                >
                  {suggestion.isBookmark ? <StarIcon size={12} filled /> : <GlobeIcon size={12} />}
                  <span className="address-bar-suggestions__title">{suggestion.title || suggestion.url}</span>
                  <span className="address-bar-suggestions__url">{displayUrl(suggestion.url)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="toolbar__star-wrap">
        <button
          type="button"
          className={'toolbar__star' + (bookmarkEntry ? ' toolbar__star--active' : '')}
          disabled={!navState?.url || navState.url.startsWith('data:')}
          onClick={onStarClick}
          aria-label={bookmarkEntry ? 'Edit bookmark' : 'Bookmark this page'}
          aria-pressed={!!bookmarkEntry}
          title={bookmarkEntry ? 'Edit bookmark' : 'Bookmark this page'}
        >
          <StarIcon filled={!!bookmarkEntry} />
        </button>
        {bookmarkPopoverOpen && bookmarkEntry && (
          <BookmarkPopover
            entry={bookmarkEntry}
            folders={folders}
            onClose={onCloseBookmarkPopover}
            onRename={onRenameBookmark}
            onMove={onMoveBookmark}
            onRemove={onRemoveBookmark}
            onCreateFolder={onCreateBookmarkFolder}
          />
        )}
      </div>

      <div className="toolbar__star-wrap">
        <button
          type="button"
          className={'toolbar__star' + (subtitleSettings.enabled ? ' toolbar__star--active' : '')}
          disabled={!navState?.url || navState.url.startsWith('data:')}
          onClick={onSubtitlesClick}
          aria-label="Live subtitles"
          aria-pressed={subtitleSettings.enabled}
          title="Live subtitles"
        >
          <SubtitlesIcon size={15} />
        </button>
        {subtitlePopoverOpen && (
          <SubtitlePopover settings={subtitleSettings} onClose={onCloseSubtitlePopover} onChange={onChangeSubtitleSettings} />
        )}
      </div>

      <div className="toolbar__star-wrap">
        <button
          type="button"
          className={'toolbar__star' + (pageTranslateSettings.enabled ? ' toolbar__star--active' : '')}
          disabled={!navState?.url || navState.url.startsWith('data:')}
          onClick={onPageTranslateClick}
          aria-label="Translate page"
          aria-pressed={pageTranslateSettings.enabled}
          title={pageTranslateStatus.status === 'translating' ? 'Translating…' : 'Translate page'}
        >
          {pageTranslateStatus.status === 'translating' ? <span className="spinner" /> : <TranslateIcon size={15} />}
        </button>
        {pageTranslatePopoverOpen && (
          <PageTranslatePopover
            settings={pageTranslateSettings}
            status={pageTranslateStatus}
            onClose={onClosePageTranslatePopover}
            onChange={onChangePageTranslateSettings}
          />
        )}
      </div>

      <button
        type="button"
        className="toolbar__downloads"
        onClick={onOpenDownloads}
        aria-label="Downloads"
        title="Downloads"
      >
        <DownloadIcon />
        {hasActiveDownload && <span className="toolbar__downloads-badge" aria-hidden />}
      </button>

      <button type="button" className="toolbar__settings" onClick={onOpenSettings} aria-label="Settings" title="Settings">
        <GearIcon />
      </button>

      <button
        type="button"
        className={'toolbar__chat-toggle' + (chatOpen ? ' toolbar__chat-toggle--active' : '')}
        onClick={onToggleChat}
        aria-label="Toggle chat"
        title="Toggle page chat"
      >
        <ChatIcon />
      </button>
    </div>
  );
}

/** Strips the scheme for display, the way most address bars do. */
function displayUrl(url: string): string {
  if (url.startsWith('data:')) return ''; // the built-in new-tab page
  return url.replace(/^https?:\/\//, '');
}
