/**
 * Imports a browser bookmark export - the Netscape Bookmark File Format,
 * the same HTML-ish format Chrome, Firefox, Safari, and Edge all export
 * (and import) - recreating the original folder structure rather than
 * dumping everything in flat.
 *
 * The format is famously not real HTML (unclosed <DT>/<p> tags throughout),
 * so this is a small hand-rolled token scanner rather than a DOM parse -
 * every browser's own importer does the same for the same reason. The
 * shape is a strict, well-known nesting:
 *
 *   <DT><H3>Folder name</H3>
 *   <DL><p>                       <- opens that folder's contents
 *       <DT><A HREF="url">Title</A>
 *       <DT><H3>Nested folder</H3>
 *       <DL><p> ... </DL><p>      <- nested folder's own contents
 *   </DL><p>                      <- closes the outer folder
 */
import { createFolder, addBookmark } from './bookmarkStore';

const TOKEN_RE = /<DT>\s*<H3([^>]*)>([^<]*)<\/H3>|<DT>\s*<A([^>]*)>([^<]*)<\/A>|<DL>\s*<p>|<\/DL>/gi;
const HREF_RE = /HREF\s*=\s*"([^"]*)"/i;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

interface ParsedFolder {
  name: string;
  parentIndex: number | null;
}

interface ParsedBookmark {
  title: string;
  url: string;
  parentIndex: number | null;
}

/** Single pass over the file, tracking folder nesting with a stack.
 * `<H3>` announces a folder but doesn't itself open a nesting level - the
 * `<DL><p>` right after it does, so it's tracked as "pending" until that
 * arrives (an empty folder's `<H3>` is immediately followed by an empty
 * `<DL><p>...</DL>`, which still opens and closes a level correctly). */
function parseNetscapeBookmarks(html: string): { folders: ParsedFolder[]; bookmarks: ParsedBookmark[] } {
  const folders: ParsedFolder[] = [];
  const bookmarks: ParsedBookmark[] = [];
  const stack: Array<number | null> = [null]; // null = the file's root list
  let pendingFolderIndex: number | null = null;

  for (const match of html.matchAll(TOKEN_RE)) {
    const [full, , folderName, bmAttrs, bmTitle] = match;
    if (folderName !== undefined) {
      const parentIndex = stack[stack.length - 1] ?? null;
      folders.push({ name: decodeHtmlEntities(folderName.trim()) || 'Untitled folder', parentIndex });
      pendingFolderIndex = folders.length - 1;
    } else if (bmTitle !== undefined) {
      const href = HREF_RE.exec(bmAttrs ?? '')?.[1];
      if (href) {
        const parentIndex = stack[stack.length - 1] ?? null;
        const url = decodeHtmlEntities(href);
        bookmarks.push({ title: decodeHtmlEntities(bmTitle.trim()) || url, url, parentIndex });
      }
    } else if (full.startsWith('<DL')) {
      stack.push(pendingFolderIndex);
      pendingFolderIndex = null;
    } else if (stack.length > 1) {
      stack.pop();
    }
  }

  return { folders, bookmarks };
}

export interface ImportSummary {
  bookmarkCount: number;
  folderCount: number;
  skipped: number;
}

/** Creates the parsed folders/bookmarks via bookmarkStore. Folders are
 * always parsed in parent-before-child order (a nested `<H3>` can only
 * appear textually after its parent's own `<H3><DL><p>`), so one forward
 * pass mapping parsed index -> real id is enough - no second pass needed. */
export function importBookmarksFromHtml(html: string): ImportSummary {
  const { folders, bookmarks } = parseNetscapeBookmarks(html);

  const realFolderId = new Map<number, string>();
  folders.forEach((folder, index) => {
    const parentId = folder.parentIndex !== null ? (realFolderId.get(folder.parentIndex) ?? null) : null;
    realFolderId.set(index, createFolder(folder.name, parentId).id);
  });

  let bookmarkCount = 0;
  let skipped = 0;
  for (const bookmark of bookmarks) {
    const folderId = bookmark.parentIndex !== null ? (realFolderId.get(bookmark.parentIndex) ?? null) : null;
    const added = addBookmark(bookmark.url, bookmark.title, folderId);
    if (added) bookmarkCount++;
    else skipped++;
  }

  return { bookmarkCount, folderCount: folders.length, skipped };
}
