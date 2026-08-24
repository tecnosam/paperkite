/**
 * Preload attached to every ordinary browsing tab (see main/tabManager.ts) -
 * distinct from chrome.ts/chat.ts: no contextBridge, nothing exposed to the
 * page's own (untrusted) JS. This script talks to main directly over
 * ipcRenderer, in its own isolated context, and manipulates the DOM
 * directly (contextIsolation only isolates JS globals, not DOM access -
 * this is the standard way to build content-script-like behavior in
 * Electron).
 *
 * Job: walk the DOM for translatable text nodes, hand their content to
 * main (which owns the actual LLM call - see main/translatePage.ts), and
 * splice the translations back into the exact same nodes by a stable id -
 * never by re-querying the DOM by position, which would be fragile against
 * anything else mutating the page in the meantime. Stays live via a
 * MutationObserver so SPA content that renders in after the initial walk
 * (infinite scroll, client-side routing) gets picked up too.
 */
import { ipcRenderer } from 'electron';
import { IPC } from '../shared/ipcChannels';
import type { PageTranslateTextEntry } from '../shared/types';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'CODE', 'PRE', 'IFRAME']);
// Batches rapid-fire DOM changes (common during SPA hydration/streaming)
// into one re-walk instead of firing per mutation record.
const MUTATION_DEBOUNCE_MS = 400;

// Per-node bookkeeping - reset on every ENABLE (including the automatic
// one main sends on each fresh navigation, see tabManager.ts) since a new
// document means none of the previous document's nodes exist anymore.
let counter = 0;
let nodesById = new Map<string, { node: Text; original: string }>();
let seen = new WeakSet<Text>();
// Original text -> every node id currently showing that exact text -
// lets one translation fan out to every node that shares it (repeated
// boilerplate - nav links, buttons - is extremely common) instead of
// re-requesting/re-paying for the same line over and over.
let idsByText = new Map<string, Set<string>>();
// Original text -> translation already resolved this document - a node
// discovered LATER (via the mutation observer) with text already in here
// gets the cached answer applied immediately, no round trip to main at all.
let translatedCache = new Map<string, string>();

let observer: MutationObserver | null = null;
let mutationTimer: ReturnType<typeof setTimeout> | null = null;
let enabled = false;

function resetState(): void {
  counter = 0;
  nodesById = new Map();
  seen = new WeakSet();
  idsByText = new Map();
  translatedCache = new Map();
}

function shouldSkip(parent: HTMLElement | null): boolean {
  if (!parent) return true;
  if (SKIP_TAGS.has(parent.tagName)) return true;
  if (parent.closest('[translate="no"], .notranslate')) return true;
  if (parent.isContentEditable) return true;
  return false;
}

function collectTextNode(textNode: Text, toTranslate: Set<string>): void {
  if (seen.has(textNode)) return;
  seen.add(textNode);
  if (!textNode.textContent || !textNode.textContent.trim()) return;
  if (shouldSkip(textNode.parentElement)) return;

  const original = textNode.textContent;
  const id = `pk-${counter++}`;
  nodesById.set(id, { node: textNode, original });
  const existingIds = idsByText.get(original);
  if (existingIds) existingIds.add(id);
  else idsByText.set(original, new Set([id]));

  const cached = translatedCache.get(original);
  if (cached !== undefined) textNode.textContent = cached;
  else toTranslate.add(original);
}

/** Recurses through regular children and, for any element that has one,
 * its open shadow root too - a plain TreeWalker can't cross that boundary
 * at all, so a page built with web components (increasingly common - most
 * design-system-driven sites use them for at least some chrome) would
 * otherwise have entire sections silently invisible to this, a real cause
 * of "translate did nothing". Closed shadow roots stay genuinely
 * invisible - same as they are to everything else outside the component
 * itself, nothing to be done about that from here. */
function collectFrom(root: ParentNode, toTranslate: Set<string>): void {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      collectTextNode(child as Text, toTranslate);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      collectFrom(el, toTranslate);
      if (el.shadowRoot) collectFrom(el.shadowRoot, toTranslate);
    }
  }
}

/** Walks for text nodes not yet tracked, records every one it finds, and
 * returns only the unique original texts that still need translating -
 * anything already resolved in translatedCache is applied inline on the
 * spot instead of being sent back up. */
function walkForNewText(): PageTranslateTextEntry[] {
  if (!document.body) return [];
  const toTranslate = new Set<string>();
  collectFrom(document.body, toTranslate);
  // `id` doubles as the original text itself - see PageTranslateTextEntry's
  // doc comment. Deduped for free by virtue of `toTranslate` being a Set.
  return Array.from(toTranslate).map((text) => ({ id: text, text }));
}

function applyTranslations(entries: PageTranslateTextEntry[]): void {
  for (const { id: originalText, text: translated } of entries) {
    translatedCache.set(originalText, translated);
    const ids = idsByText.get(originalText);
    if (!ids) continue; // the node(s) it was for got removed before the translation came back
    for (const nodeId of ids) {
      const entry = nodesById.get(nodeId);
      if (entry) entry.node.textContent = translated;
    }
  }
}

function revertAll(): void {
  for (const { node, original } of nodesById.values()) node.textContent = original;
}

function startObserving(): void {
  observer = new MutationObserver(() => {
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      const fresh = walkForNewText();
      // Not `initial` - later top-ups stay quiet in the UI (see
      // PageTranslateStatus's doc comment) and, unlike the initial walk,
      // aren't worth a round trip at all when there's genuinely nothing new.
      if (fresh.length > 0) ipcRenderer.send(IPC.PAGE_TRANSLATE_EXTRACTED, { entries: fresh, initial: false });
    }, MUTATION_DEBOUNCE_MS);
  });
  // childList only, deliberately - NOT characterData. Applying a
  // translation is itself a text-content mutation on an EXISTING node;
  // watching characterData would mean every applied translation
  // re-triggers the observer for that same node, needing extra
  // self-mutation filtering to avoid a loop. childList (new nodes being
  // added) never fires for content we overwrite in place, so there's
  // nothing to filter - new content is exactly what this needs to catch
  // anyway (SPA-rendered nodes), not edits to text already handled.
  observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserving(): void {
  observer?.disconnect();
  observer = null;
  if (mutationTimer) {
    clearTimeout(mutationTimer);
    mutationTimer = null;
  }
}

function whenBodyReady(cb: () => void): void {
  if (document.body) cb();
  else document.addEventListener('DOMContentLoaded', () => cb(), { once: true });
}

ipcRenderer.on(IPC.PAGE_TRANSLATE_ENABLE, () => {
  enabled = true;
  // Undo any previous translation pass (e.g. the user switched target
  // language/agent while already on) BEFORE resetting state - otherwise
  // the next walk would read a node's currently-displayed TRANSLATED text
  // as its "original", permanently losing the true source text on every
  // settings change.
  revertAll();
  resetState();
  whenBodyReady(() => {
    if (!enabled) return; // turned off again before the DOM was even ready
    const fresh = walkForNewText();
    // Always reported, even empty - this is what lets main's status ever
    // reach 'done' for a page with nothing translatable on it at all,
    // rather than sitting on 'translating' forever (see ipc.ts's
    // PAGE_TRANSLATE_EXTRACTED handler).
    ipcRenderer.send(IPC.PAGE_TRANSLATE_EXTRACTED, { entries: fresh, initial: true });
    startObserving();
  });
});

ipcRenderer.on(IPC.PAGE_TRANSLATE_DISABLE, () => {
  enabled = false;
  stopObserving();
  revertAll();
});

ipcRenderer.on(IPC.PAGE_TRANSLATE_APPLY, (_event, entries: PageTranslateTextEntry[]) => {
  if (!enabled) return; // a stale reply for a page since turned off/navigated away from
  applyTranslations(entries);
});
