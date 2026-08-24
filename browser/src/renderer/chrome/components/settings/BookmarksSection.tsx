import { useEffect, useMemo, useRef, useState } from 'react';
import type { BookmarkEntry, BookmarkFolder, BookmarkImportResult } from '../../../../shared/types';
import { relativeTime } from '../../../../shared/relativeTime';
import { flattenFolderTree, folderPath, countFolderContents } from '../../bookmarkTree';
import { SearchIcon, TrashIcon, EditIcon, FolderIcon, ChevronRightIcon, PlusIcon, DownloadIcon } from '../../icons';

interface BookmarksSectionProps {
  bookmarks: BookmarkEntry[];
  folders: BookmarkFolder[];
  onDeleteBookmark: (id: string) => void;
  onRenameBookmark: (id: string, title: string) => void;
  onMoveBookmark: (id: string, folderId: string | null) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onOpenInNewTab: (url: string) => void;
}

export function BookmarksSection({
  bookmarks,
  folders,
  onDeleteBookmark,
  onRenameBookmark,
  onMoveBookmark,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onOpenInNewTab,
}: BookmarksSectionProps) {
  const [query, setQuery] = useState('');
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [confirmingDeleteFolder, setConfirmingDeleteFolder] = useState<string | null>(null);
  // undefined = not creating a folder anywhere; null = creating at the
  // root (from the top "New folder" button); a string = creating nested
  // under that folder's id (from a folder row's own "+" button).
  const [creatingUnder, setCreatingUnder] = useState<string | null | undefined>(undefined);
  const [importResult, setImportResult] = useState<BookmarkImportResult | null>(null);

  useEffect(() => window.paperkite.onBookmarkImportResult(setImportResult), []);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const foldersByParent = useMemo(() => {
    const map = new Map<string | null, BookmarkFolder[]>();
    for (const f of folders) {
      const siblings = map.get(f.parentId) ?? [];
      siblings.push(f);
      map.set(f.parentId, siblings);
    }
    for (const siblings of map.values()) siblings.sort((a, b) => a.createdAt - b.createdAt);
    return map;
  }, [folders]);

  const bookmarksByFolder = useMemo(() => {
    const map = new Map<string | null, BookmarkEntry[]>();
    for (const b of bookmarks) {
      const siblings = map.get(b.folderId) ?? [];
      siblings.push(b);
      map.set(b.folderId, siblings);
    }
    return map;
  }, [bookmarks]);

  const searchResults = searching ? bookmarks.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)) : [];

  const isEmpty = bookmarks.length === 0 && folders.length === 0;

  return (
    <section className="settings-section">
      <h2>Bookmarks</h2>

      <div className="bookmarks-toolbar">
        <div className="settings-search bookmarks-toolbar__search">
          <SearchIcon />
          <input value={query} spellCheck={false} placeholder="Search bookmarks" onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button
          type="button"
          className="bookmarks-toolbar__new-folder"
          onClick={() => {
            setImportResult(null);
            window.paperkite.importBookmarks();
          }}
        >
          <DownloadIcon size={12} />
          Import
        </button>
        <button type="button" className="bookmarks-toolbar__new-folder" onClick={() => setCreatingUnder(null)}>
          <PlusIcon size={11} />
          New folder
        </button>
      </div>

      {importResult && (
        <p className={'mcp-test-result' + (importResult.ok ? '' : ' mcp-test-result--error')}>
          {importResult.ok
            ? `Imported ${importResult.bookmarkCount} bookmark${importResult.bookmarkCount === 1 ? '' : 's'} in ${importResult.folderCount} folder${importResult.folderCount === 1 ? '' : 's'}${importResult.skipped > 0 ? ` (${importResult.skipped} already bookmarked, skipped)` : ''}.`
            : (importResult.error ?? "That file doesn't look like a bookmark export.")}
        </p>
      )}

      {creatingUnder === null && (
        <NewFolderRow
          depth={0}
          onCreate={(name) => {
            onCreateFolder(name, null);
            setCreatingUnder(undefined);
          }}
          onCancel={() => setCreatingUnder(undefined)}
        />
      )}

      {isEmpty && !searching ? (
        <p className="settings-hint">No bookmarks yet - star a page from the address bar to save it here.</p>
      ) : searching ? (
        searchResults.length === 0 ? (
          <p className="settings-hint">No matches.</p>
        ) : (
          <ul className="settings-list">
            {searchResults.map((entry) =>
              editingBookmarkId === entry.id ? (
                <InlineNameField
                  key={entry.id}
                  initial={entry.title || entry.url}
                  onSave={(title) => {
                    onRenameBookmark(entry.id, title);
                    setEditingBookmarkId(null);
                  }}
                  onCancel={() => setEditingBookmarkId(null)}
                />
              ) : (
                <BookmarkRow
                  key={entry.id}
                  entry={entry}
                  folders={folders}
                  path={folderPath(folders, entry.folderId)}
                  onOpen={() => onOpenInNewTab(entry.url)}
                  onEdit={() => setEditingBookmarkId(entry.id)}
                  onDelete={() => onDeleteBookmark(entry.id)}
                  onMove={(folderId) => onMoveBookmark(entry.id, folderId)}
                />
              ),
            )}
          </ul>
        )
      ) : (
        <FolderChildren
          parentId={null}
          depth={0}
          foldersByParent={foldersByParent}
          bookmarksByFolder={bookmarksByFolder}
          allFolders={folders}
          allBookmarks={bookmarks}
          collapsed={collapsed}
          onToggleCollapse={(id) =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          editingBookmarkId={editingBookmarkId}
          onEditBookmark={setEditingBookmarkId}
          editingFolderId={editingFolderId}
          onEditFolder={setEditingFolderId}
          confirmingDeleteFolder={confirmingDeleteFolder}
          onConfirmingDeleteFolder={setConfirmingDeleteFolder}
          creatingUnder={creatingUnder}
          onCreatingUnder={setCreatingUnder}
          onOpenBookmark={onOpenInNewTab}
          onDeleteBookmark={onDeleteBookmark}
          onRenameBookmark={onRenameBookmark}
          onMoveBookmark={onMoveBookmark}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
        />
      )}
    </section>
  );
}

interface TreeSharedProps {
  allFolders: BookmarkFolder[];
  allBookmarks: BookmarkEntry[];
  foldersByParent: Map<string | null, BookmarkFolder[]>;
  bookmarksByFolder: Map<string | null, BookmarkEntry[]>;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  editingBookmarkId: string | null;
  onEditBookmark: (id: string | null) => void;
  editingFolderId: string | null;
  onEditFolder: (id: string | null) => void;
  confirmingDeleteFolder: string | null;
  onConfirmingDeleteFolder: (id: string | null) => void;
  creatingUnder: string | null | undefined;
  onCreatingUnder: (id: string | null | undefined) => void;
  onOpenBookmark: (url: string) => void;
  onDeleteBookmark: (id: string) => void;
  onRenameBookmark: (id: string, title: string) => void;
  onMoveBookmark: (id: string, folderId: string | null) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
}

interface FolderChildrenProps extends TreeSharedProps {
  parentId: string | null;
  depth: number;
}

function FolderChildren(props: FolderChildrenProps) {
  const { parentId, depth, foldersByParent, bookmarksByFolder } = props;
  const childFolders = foldersByParent.get(parentId) ?? [];
  const childBookmarks = bookmarksByFolder.get(parentId) ?? [];

  return (
    <>
      {childFolders.map((folder) => (
        <FolderRow key={folder.id} {...props} folder={folder} depth={depth} />
      ))}
      {props.creatingUnder === parentId && parentId !== null && (
        <NewFolderRow
          depth={depth}
          onCreate={(name) => {
            props.onCreateFolder(name, parentId);
            props.onCreatingUnder(undefined);
          }}
          onCancel={() => props.onCreatingUnder(undefined)}
        />
      )}
      {childBookmarks.map((entry) =>
        props.editingBookmarkId === entry.id ? (
          <InlineNameField
            key={entry.id}
            depth={depth}
            initial={entry.title || entry.url}
            onSave={(title) => {
              props.onRenameBookmark(entry.id, title);
              props.onEditBookmark(null);
            }}
            onCancel={() => props.onEditBookmark(null)}
          />
        ) : (
          <BookmarkRow
            key={entry.id}
            entry={entry}
            depth={depth}
            folders={props.allFolders}
            onOpen={() => props.onOpenBookmark(entry.url)}
            onEdit={() => props.onEditBookmark(entry.id)}
            onDelete={() => props.onDeleteBookmark(entry.id)}
            onMove={(folderId) => props.onMoveBookmark(entry.id, folderId)}
          />
        ),
      )}
    </>
  );
}

interface FolderRowProps extends TreeSharedProps {
  folder: BookmarkFolder;
  depth: number;
}

function FolderRow(props: FolderRowProps) {
  const { folder, depth, collapsed, onToggleCollapse, allFolders, allBookmarks } = props;
  const isCollapsed = collapsed.has(folder.id);
  const isEditing = props.editingFolderId === folder.id;
  const isConfirmingDelete = props.confirmingDeleteFolder === folder.id;
  const indent = { paddingLeft: 8 + depth * 18 };

  if (isEditing) {
    return (
      <InlineNameField
        depth={depth}
        initial={folder.name}
        onSave={(name) => {
          props.onRenameFolder(folder.id, name);
          props.onEditFolder(null);
        }}
        onCancel={() => props.onEditFolder(null)}
      />
    );
  }

  const { folderCount, bookmarkCount } = isConfirmingDelete ? countFolderContents(allFolders, allBookmarks, folder.id) : { folderCount: 0, bookmarkCount: 0 };

  return (
    <>
      <li className="settings-list__row bookmark-folder-row" style={indent}>
        <button type="button" className="settings-list__main bookmark-folder-row__main" onClick={() => onToggleCollapse(folder.id)}>
          <span className={'bookmark-folder-row__chevron' + (isCollapsed ? '' : ' bookmark-folder-row__chevron--open')}>
            <ChevronRightIcon />
          </span>
          <FolderIcon />
          <span className="settings-list__title">{folder.name}</span>
        </button>
        {isConfirmingDelete ? (
          <span className="bookmark-folder-row__confirm">
            <span>
              Delete{folderCount > 0 ? ` folder + ${folderCount} subfolder${folderCount === 1 ? '' : 's'}` : ' folder'}
              {bookmarkCount > 0 ? ` (${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'})` : ''}?
            </span>
            <button type="button" className="bookmark-folder-row__confirm-yes" onClick={() => props.onDeleteFolder(folder.id)}>
              Delete
            </button>
            <button type="button" className="bookmark-folder-row__confirm-no" onClick={() => props.onConfirmingDeleteFolder(null)}>
              Cancel
            </button>
          </span>
        ) : (
          <>
            <button
              type="button"
              className="settings-list__delete"
              aria-label={`New folder inside ${folder.name}`}
              onClick={() => props.onCreatingUnder(folder.id)}
            >
              <PlusIcon size={11} />
            </button>
            <button type="button" className="settings-list__delete" aria-label={`Rename ${folder.name}`} onClick={() => props.onEditFolder(folder.id)}>
              <EditIcon />
            </button>
            <button
              type="button"
              className="settings-list__delete"
              aria-label={`Delete ${folder.name}`}
              onClick={() => props.onConfirmingDeleteFolder(folder.id)}
            >
              <TrashIcon />
            </button>
          </>
        )}
      </li>
      {!isCollapsed && <FolderChildren {...props} parentId={folder.id} depth={depth + 1} />}
    </>
  );
}

interface BookmarkRowProps {
  entry: BookmarkEntry;
  folders: BookmarkFolder[];
  depth?: number;
  path?: string;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (folderId: string | null) => void;
}

function BookmarkRow({ entry, folders, depth = 0, path, onOpen, onEdit, onDelete, onMove }: BookmarkRowProps) {
  const flatFolders = useMemo(() => flattenFolderTree(folders), [folders]);
  const indent = { paddingLeft: 8 + depth * 18 };

  return (
    <li className="settings-list__row" style={indent}>
      <button type="button" className="settings-list__main" onClick={onOpen} title="Open in a new tab">
        <span className="settings-list__title">{entry.title || entry.url}</span>
        <span className="settings-list__url">{entry.url}</span>
        {path && <span className="bookmark-row__path">{path}</span>}
      </button>
      <span className="settings-list__time">{relativeTime(entry.timestamp)}</span>
      <select
        className="bookmark-row__move"
        value={entry.folderId ?? ''}
        title="Move to folder"
        onChange={(e) => onMove(e.target.value === '' ? null : e.target.value)}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">Unfiled</option>
        {flatFolders.map(({ folder, depth: d }) => (
          <option key={folder.id} value={folder.id}>
            {'  '.repeat(d)}
            {folder.name}
          </option>
        ))}
      </select>
      <button type="button" className="settings-list__delete" aria-label="Rename bookmark" onClick={onEdit}>
        <EditIcon />
      </button>
      <button type="button" className="settings-list__delete" aria-label="Remove bookmark" onClick={onDelete}>
        <TrashIcon />
      </button>
    </li>
  );
}

interface InlineNameFieldProps {
  initial: string;
  depth?: number;
  onSave: (value: string) => void;
  onCancel: () => void;
}

function InlineNameField({ initial, depth = 0, onSave, onCancel }: InlineNameFieldProps) {
  const [draft, setDraft] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const save = () => {
    const trimmed = draft.trim();
    onSave(trimmed || initial);
  };

  return (
    <li className="settings-list__row settings-list__row--editing" style={{ paddingLeft: 8 + depth * 18 }}>
      <input
        ref={inputRef}
        className="settings-list__name-input"
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') onCancel();
        }}
      />
    </li>
  );
}

interface NewFolderRowProps {
  depth: number;
  onCreate: (name: string) => void;
  onCancel: () => void;
}

function NewFolderRow({ depth, onCreate, onCancel }: NewFolderRowProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter fires submit() and (via onCreate) unmounts this row - if that
  // unmount triggers a native blur before React finishes, onBlur's submit()
  // would otherwise fire a second time and create a duplicate folder.
  const submitted = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (submitted.current) return;
    const trimmed = name.trim();
    if (trimmed) {
      submitted.current = true;
      onCreate(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <li className="settings-list__row settings-list__row--editing" style={{ paddingLeft: 8 + depth * 18 }}>
      <FolderIcon />
      <input
        ref={inputRef}
        className="settings-list__name-input"
        value={name}
        spellCheck={false}
        placeholder="Folder name"
        onChange={(e) => setName(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
      />
    </li>
  );
}
