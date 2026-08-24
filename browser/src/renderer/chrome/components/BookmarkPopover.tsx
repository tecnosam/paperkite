import { useEffect, useRef, useState } from 'react';
import type { BookmarkEntry, BookmarkFolder } from '../../../shared/types';
import { flattenFolderTree } from '../bookmarkTree';
import { StarIcon, CloseIcon } from '../icons';

const NEW_FOLDER_SENTINEL = '__new_folder__';

interface BookmarkPopoverProps {
  entry: BookmarkEntry;
  folders: BookmarkFolder[];
  onClose: () => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onRemove: (id: string) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
}

/** Chrome-style "bookmark added" bubble - opens under the toolbar star
 * whenever it's clicked, whether that click just added the bookmark or is
 * re-opening the bubble to edit an existing one. Title edits and folder
 * moves save as you go (no separate Save step, just Done to dismiss);
 * Remove is the only destructive action, so it gets its own affordance. */
export function BookmarkPopover({ entry, folders, onClose, onRename, onMove, onRemove, onCreateFolder }: BookmarkPopoverProps) {
  const [title, setTitle] = useState(entry.title);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const pendingFolderName = useRef<string | null>(null);

  useEffect(() => {
    setTitle(entry.title);
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [entry.id]);

  // A folder created from this popover should end up selected once it
  // exists - createFolder is fire-and-forget over IPC (see ipc.ts), so
  // the new folder only becomes choosable once its broadcast lands here.
  useEffect(() => {
    const name = pendingFolderName.current;
    if (!name) return;
    const match = folders.find((f) => f.parentId === null && f.name.toLowerCase() === name.toLowerCase());
    if (match) {
      pendingFolderName.current = null;
      onMove(entry.id, match.id);
    }
  }, [folders, entry.id, onMove]);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [onClose]);

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== entry.title) onRename(entry.id, trimmed);
  };

  const flatFolders = flattenFolderTree(folders);

  const handleFolderChange = (value: string) => {
    if (value === NEW_FOLDER_SENTINEL) {
      setCreatingFolder(true);
      setNewFolderName('');
      return;
    }
    onMove(entry.id, value === '' ? null : value);
  };

  const submitNewFolder = () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setCreatingFolder(false);
      return;
    }
    pendingFolderName.current = trimmed;
    onCreateFolder(trimmed, null);
    setCreatingFolder(false);
  };

  return (
    <div className="bookmark-popover" ref={popoverRef}>
      <div className="bookmark-popover__header">
        <StarIcon size={14} filled />
        <span>Bookmark</span>
        <button type="button" className="bookmark-popover__close" aria-label="Close" onClick={onClose}>
          <CloseIcon size={11} />
        </button>
      </div>

      <label className="bookmark-popover__field">
        <span>Name</span>
        <input
          ref={titleRef}
          value={title}
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitTitle();
              onClose();
            }
          }}
        />
      </label>

      <label className="bookmark-popover__field">
        <span>Folder</span>
        {creatingFolder ? (
          <div className="bookmark-popover__new-folder">
            <input
              autoFocus
              value={newFolderName}
              spellCheck={false}
              placeholder="New folder name"
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNewFolder();
                if (e.key === 'Escape') setCreatingFolder(false);
              }}
            />
            <button type="button" onClick={submitNewFolder}>
              Create
            </button>
          </div>
        ) : (
          <select value={entry.folderId ?? ''} onChange={(e) => handleFolderChange(e.target.value)}>
            <option value="">No folder</option>
            {flatFolders.map(({ folder, depth }) => (
              <option key={folder.id} value={folder.id}>
                {'  '.repeat(depth)}
                {folder.name}
              </option>
            ))}
            <option value={NEW_FOLDER_SENTINEL}>+ New folder…</option>
          </select>
        )}
      </label>

      <div className="bookmark-popover__footer">
        <button
          type="button"
          className="bookmark-popover__remove"
          onClick={() => {
            onRemove(entry.id);
            onClose();
          }}
        >
          Remove
        </button>
        <button type="button" className="bookmark-popover__done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
