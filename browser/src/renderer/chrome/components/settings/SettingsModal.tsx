import { useEffect, useState } from 'react';
import type { SafetySettings, ThemeSource, BookmarkEntry, BookmarkFolder, DomainTrustLists, ProxySettings } from '../../../../shared/types';
import { CloseIcon } from '../../icons';
import { GeneralSection } from './GeneralSection';
import { SafetySection } from './SafetySection';
import { HistorySection } from './HistorySection';
import { BookmarksSection } from './BookmarksSection';
import { DomainsSection } from './DomainsSection';
import { NetworkSection } from './NetworkSection';
import { PermissionsSection } from './PermissionsSection';
import { AgentsSection } from './AgentsSection';
import { McpSection } from './McpSection';
import { LiveTranslateSection } from './LiveTranslateSection';
import { ChatServersSection } from './ChatServersSection';
import { PrivacyDataSection } from './PrivacyDataSection';

interface SettingsModalProps {
  safety: SafetySettings;
  themeSource: ThemeSource;
  bookmarks: BookmarkEntry[];
  bookmarkFolders: BookmarkFolder[];
  domainTrust: DomainTrustLists;
  proxySettings: ProxySettings;
  /** Set together with `focusToken` when Settings was opened via the chat
   * panel's "fix this server's username" CTA (see App.tsx's
   * pendingChatServerFocus) - jumps straight to Chat Servers with this
   * server's edit form already open, instead of the user having to
   * navigate there and find it themselves. `null` for a normal open. */
  focusChatServerId: string | null;
  /** Increments on every CTA trigger, including re-clicking the same
   * server - the deep-link effect below is keyed on this rather than
   * `focusChatServerId` so it still fires in that case. */
  focusToken: number;
  onClose: () => void;
  onSaveSafety: (settings: SafetySettings) => void;
  onSaveTheme: (source: ThemeSource) => void;
  onDeleteBookmark: (id: string) => void;
  onRenameBookmark: (id: string, title: string) => void;
  onMoveBookmark: (id: string, folderId: string | null) => void;
  onCreateBookmarkFolder: (name: string, parentId: string | null) => void;
  onRenameBookmarkFolder: (id: string, name: string) => void;
  onDeleteBookmarkFolder: (id: string) => void;
  onOpenInNewTab: (url: string) => void;
  onSaveDomainTrust: (lists: DomainTrustLists) => void;
  onSaveProxySettings: (settings: ProxySettings) => void;
}

type SectionId =
  | 'general'
  | 'safety'
  | 'privacy'
  | 'history'
  | 'bookmarks'
  | 'domains'
  | 'permissions'
  | 'agents'
  | 'mcp'
  | 'chatServers'
  | 'liveTranslate'
  | 'network';

const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'safety', label: 'Safety' },
  { id: 'privacy', label: 'Privacy & Data' },
  { id: 'history', label: 'History' },
  { id: 'bookmarks', label: 'Bookmarks' },
  { id: 'domains', label: 'Domains' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'agents', label: 'Agents' },
  { id: 'mcp', label: 'MCP' },
  { id: 'chatServers', label: 'Chat Servers' },
  { id: 'liveTranslate', label: 'Live Translate' },
  { id: 'network', label: 'Network' },
];

export function SettingsModal(props: SettingsModalProps) {
  const [section, setSection] = useState<SectionId>(props.focusChatServerId ? 'chatServers' : 'general');
  const { onClose, focusToken } = props;

  // Re-jump on every new CTA trigger (see focusToken's own doc comment) -
  // covers Settings already being open on a different section when the
  // CTA fires, which the lazy initial state above wouldn't catch.
  useEffect(() => {
    if (focusToken > 0) setSection('chatServers');
  }, [focusToken]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel__header">
          <h1>Settings</h1>
          <button type="button" className="settings-panel__close" aria-label="Close settings" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>

        <div className="settings-panel__body">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={'settings-nav__item' + (section === id ? ' settings-nav__item--active' : '')}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="settings-panel__content">
            {section === 'general' && <GeneralSection themeSource={props.themeSource} onSaveTheme={props.onSaveTheme} />}
            {section === 'safety' && <SafetySection safety={props.safety} onSaveSafety={props.onSaveSafety} />}
            {section === 'privacy' && <PrivacyDataSection />}
            {section === 'history' && <HistorySection onOpenInNewTab={props.onOpenInNewTab} />}
            {section === 'bookmarks' && (
              <BookmarksSection
                bookmarks={props.bookmarks}
                folders={props.bookmarkFolders}
                onDeleteBookmark={props.onDeleteBookmark}
                onRenameBookmark={props.onRenameBookmark}
                onMoveBookmark={props.onMoveBookmark}
                onCreateFolder={props.onCreateBookmarkFolder}
                onRenameFolder={props.onRenameBookmarkFolder}
                onDeleteFolder={props.onDeleteBookmarkFolder}
                onOpenInNewTab={props.onOpenInNewTab}
              />
            )}
            {section === 'domains' && (
              <DomainsSection domainTrust={props.domainTrust} onSaveDomainTrust={props.onSaveDomainTrust} />
            )}
            {section === 'permissions' && <PermissionsSection />}
            {section === 'agents' && <AgentsSection />}
            {section === 'mcp' && <McpSection />}
            {section === 'chatServers' && <ChatServersSection focusServerId={props.focusChatServerId} focusToken={props.focusToken} />}
            {section === 'liveTranslate' && <LiveTranslateSection />}
            {section === 'network' && (
              <NetworkSection proxySettings={props.proxySettings} onSaveProxySettings={props.onSaveProxySettings} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
