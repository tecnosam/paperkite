import type { BookmarkEntry, BookmarkFolder } from '../../shared/types';

export interface FlatFolder {
  folder: BookmarkFolder;
  depth: number;
}

/** Depth-first flattening of the folder tree (root folders first, then
 * each one's children before moving to the next root), for rendering an
 * indented `<select>` or a nested list. Guards against a corrupt/cyclic
 * parentId chain by tracking visited ids - shouldn't happen since nothing
 * in this app re-parents an existing folder, but a defensive stop beats
 * an infinite loop if a bookmarks.json file is ever hand-edited. */
export function flattenFolderTree(folders: BookmarkFolder[]): FlatFolder[] {
  const byParent = new Map<string | null, BookmarkFolder[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.createdAt - b.createdAt);

  const out: FlatFolder[] = [];
  const visited = new Set<string>();

  function visit(parentId: string | null, depth: number): void {
    for (const folder of byParent.get(parentId) ?? []) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      out.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  }

  visit(null, 0);
  return out;
}

/** "Work / Reading" style breadcrumb for a bookmark's folder, shown next
 * to search results since the tree itself is hidden while searching. */
export function folderPath(folders: BookmarkFolder[], folderId: string | null): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  let current = folderId ? byId.get(folderId) : undefined;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join(' / ');
}

/** How many folders and bookmarks a delete would cascade through - matches
 * bookmarkStore.ts's deleteFolder sweep exactly, so the confirm prompt's
 * count is never a lie. */
export function countFolderContents(
  folders: BookmarkFolder[],
  bookmarks: BookmarkEntry[],
  folderId: string,
): { folderCount: number; bookmarkCount: number } {
  const toDelete = new Set<string>([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && toDelete.has(f.parentId) && !toDelete.has(f.id)) {
        toDelete.add(f.id);
        grew = true;
      }
    }
  }
  const bookmarkCount = bookmarks.filter((b) => b.folderId && toDelete.has(b.folderId)).length;
  return { folderCount: toDelete.size - 1, bookmarkCount };
}
