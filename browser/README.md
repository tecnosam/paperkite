# Paperkite

An open-source browser shell built on Electron: a real, multi-tab browsing
window (BaseWindow + WebContentsView, no `<webview>`, no BrowserView) with a
per-page chat panel on the side. This milestone is **UI validation only** —
the chat panel is seeded from a bundled mock JSON file and there's no real
backend, no network calls for chat. Messages you send are real, though:
they're persisted to disk (see "Chat history" below), not just in-memory.

## Running it

```bash
npm install
npm start
```

On first launch you'll be asked to pick a username (stored in the app's
`userData` directory and reused silently after that). Then you get a
normal-ish browser: tabs (`Cmd/Ctrl+T` / `Cmd/Ctrl+W`), back/forward/reload
(`Cmd/Ctrl+R`), an address bar, and a chat toggle button (top right of the
toolbar) that slides open a 340px panel on the right.

## How it's put together

One `BaseWindow` hosts three `WebContentsView`s that the main process
positions explicitly on every resize and every chat-panel toggle:

- **chrome** — the tab strip + toolbar (React), pinned to the top, 92px tall.
- **page** — whichever tab is active; only one page view is ever attached
  to the window at a time, swapped on tab switch.
- **chat** — the chat panel (React), attached/detached from the window when
  toggled, 340px wide.

The bounds math lives in one place, [`src/main/layout.ts`](src/main/layout.ts),
kept deliberately dumb (pure function, no Electron calls) so it's easy to
read and extend. [`src/main/windowManager.ts`](src/main/windowManager.ts) is
the only place that touches `win.contentView` — the rule is: WindowManager
decides *what's attached and where*, [`src/main/tabManager.ts`](src/main/tabManager.ts)
decides *what a tab is* (its `WebContentsView`, navigation, title/favicon/loading).
That split is where you'd hook in per-tab screenshots or CDP later without
touching the layout code.

Everything the main process needs to talk to the two React apps goes
through `contextBridge` — see [`src/preload/chrome.ts`](src/preload/chrome.ts)
and [`src/preload/chat.ts`](src/preload/chat.ts) for the exposed APIs, and
[`src/shared/ipcChannels.ts`](src/shared/ipcChannels.ts) /
[`src/shared/types.ts`](src/shared/types.ts) for the channel names and
payload shapes both sides agree on. Both renderers run with
`contextIsolation`/`sandbox` on and `nodeIntegration` off, same as the page
views themselves.

## Chat history (disk-backed, with retention)

Seed messages live in [`src/data/seedMessages.json`](src/data/seedMessages.json),
bundled with the app. Shape:

```json
{
  "rooms": {
    "https://example.com/path": [
      { "username": "ada", "text": "hi", "timestamp": 1730000000000 }
    ]
  }
}
```

[`src/main/chatStore.ts`](src/main/chatStore.ts) only reads that file
**once** - on first launch, to seed `userData/chatHistory.json`. From then
on, that history file is the source of truth: it's read on startup and
rewritten after every new message or pin change, so your own messages (and
deletions) survive a restart.

Retention is enforced on load, after every send, and via an hourly sweep
while the app is open:
- each room keeps at most **256** messages, oldest evicted first;
- anything older than **30 days** is deleted;
- **pinned messages are exempt from both** - that's the point of pinning
  something (click the pin icon that appears on hover over a message).

To see it in action without sending 200+ messages by hand, two seed rooms
are built for exactly that: navigate to `example.com/busy-thread` (270
seeded messages - watch it settle at 256) or `example.com/old-thread`
(has messages seeded 35-40 days old, already gone by the time you look).

As a nice-to-have, sending a message schedules one canned reply from a
fake user a beat later, just so the panel doesn't feel dead.

## Room keys (URL normalization)

Chat rooms are keyed by URL, normalized by **one function**:
[`normalizeToRoomKey` in `src/shared/normalizeUrl.ts`](src/shared/normalizeUrl.ts).
It lowercases the scheme and host, drops the query string and fragment,
and trims a trailing slash — `https://News.Site.com/a/?x=1#y` becomes
`https://news.site.com/a`. Every room key in the app is derived from this
one function, so changing chat granularity later (per-query-string,
per-host instead of per-path, etc.) is a one-file change.

## Country flags

Each message shows a flag next to the author's name. Real messages get it
from the local user's OS-reported country (`app.getLocaleCountryCode()` —
no network lookup); the seed/canned cast get one from a small mock
directory in [`src/main/chatStore.ts`](src/main/chatStore.ts). Country is
attached to each `ChatMessage` at read/send time in main
([`src/shared/flagEmoji.ts`](src/shared/flagEmoji.ts) turns the ISO code
into the flag emoji, no image assets) rather than stored per-message in
the seed file.

## Settings

The gear icon in the toolbar opens Settings: change your username (with a
note that it won't relabel messages you've already sent — those keep the
name they were posted under), and three safety toggles (censor profanity,
censor nudity, filter hyperlinks), persisted alongside the username in
`user.json` and pushed live to both renderers on change.

## Dark mode

Follows the OS by default; override it in Settings → Appearance
(System/Light/Dark), persisted to `userData/theme.json` (deliberately its
own file, separate from the username/safety settings, so it can be read -
and the very first paint themed correctly - before a username exists).
Main resolves the actual light/dark value via `nativeTheme` and pushes it
to both renderers over IPC; they apply it as `data-theme` on `<html>`,
which [`theme.css`](src/renderer/shared/theme.css) keys all of its dark
variants off of. The palette keeps the same warm paper/ink/kite identity
inverted - a deep charcoal, not the generic cold blue-black - with the
coral and sky accents both brightened for contrast.

## Hyperlinks in chat

[`src/shared/linkSafety.ts`](src/shared/linkSafety.ts) classifies every
link in a message as **trusted** (a small allowlist of major domains, or
same-site as whatever page you're chatting on), **suspicious** (heuristics
for phishing-ish domains — raw IPs, punycode, throwaway TLDs, brand-name
impersonation), or **neutral** (everything else). With the hyperlinks
safety toggle on: trusted links are clickable (open in a new tab),
suspicious ones are auto-masked, neutral ones render as plain text. Off:
every link is clickable, unfiltered. This is a heuristic mock, not a real
threat-intel feed — it's built to be swapped for one later without
touching call sites. Profanity/nudity filtering
([`src/shared/contentFilters.ts`](src/shared/contentFilters.ts)) is the
same kind of small, clearly-labeled placeholder wordlist, applied as a
display-time transform — the stored message text is never mutated, so
toggling a filter off reveals the original text again.

## Scope

Per the milestone brief, deliberately **not** included: a real chat
backend/websockets/auth, MCP or AI agents, CDP automation or screenshots,
DRM, extension support, auto-update, code signing, or history/bookmarks/
downloads. Tabs are still in-memory only (not restored across restarts) -
chat history, the user profile, safety settings, and theme preference are
what's persisted to disk, all under the app's `userData` directory.
