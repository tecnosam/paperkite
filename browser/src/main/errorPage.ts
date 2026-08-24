/**
 * Chrome-like "this site can't be reached" / "this page has crashed" pages.
 * Electron/Chromium don't show anything useful in a bare WebContentsView on
 * a failed navigation or a dead renderer, so TabManager catches
 * `did-fail-load` / `render-process-gone` and loads one of these instead -
 * a self-contained data: URL, same trick as newTabPage.ts.
 */

type ErrorCategory = 'dns' | 'refused' | 'timeout' | 'invalid' | 'offline' | 'generic';

interface CategoryCopy {
  title: string;
  detail: (host: string) => string;
}

const COPY: Record<ErrorCategory, CategoryCopy> = {
  dns: {
    title: "This site can't be found",
    detail: (host) => `${host}'s server IP address could not be found.`,
  },
  refused: {
    title: "This site can't be reached",
    detail: (host) => `${host} refused to connect.`,
  },
  timeout: {
    title: "This site can't be reached",
    detail: (host) => `${host} took too long to respond.`,
  },
  invalid: {
    title: "This address isn't valid",
    detail: (host) => `"${host}" isn't a web address Paperkite can open.`,
  },
  offline: {
    title: "You're offline",
    detail: () => 'Check your internet connection and try again.',
  },
  generic: {
    title: "This site can't be reached",
    detail: (host) => `${host} unexpectedly closed the connection.`,
  },
};

/** Chromium's net error codes are small negative integers - this maps the
 * ones a browsing session actually runs into to a friendly category. Any
 * code not listed here (or a genuinely unmapped one) falls back to 'generic'. */
const ERROR_CODE_CATEGORY: Record<number, ErrorCategory> = {
  [-105]: 'dns', // ERR_NAME_NOT_RESOLVED
  [-137]: 'dns', // ERR_NAME_RESOLUTION_FAILED
  [-100]: 'refused', // ERR_CONNECTION_CLOSED
  [-101]: 'refused', // ERR_CONNECTION_RESET
  [-102]: 'refused', // ERR_CONNECTION_REFUSED
  [-109]: 'refused', // ERR_ADDRESS_UNREACHABLE
  [-118]: 'timeout', // ERR_CONNECTION_TIMED_OUT
  [-7]: 'timeout', // ERR_TIMED_OUT
  [-300]: 'invalid', // ERR_INVALID_URL
  [-8]: 'invalid', // ERR_INVALID_ARGUMENT
  [-106]: 'offline', // ERR_INTERNET_DISCONNECTED
  [-21]: 'offline', // ERR_NETWORK_CHANGED
};

function categoryFor(errorCode: number): ErrorCategory {
  return ERROR_CODE_CATEGORY[errorCode] ?? 'generic';
}

/** `render-process-gone`'s `reason` values (see tabManager.ts) - excludes
 * 'clean-exit' (not a crash, never reaches here) and 'memory-eviction'
 * (a background tab reclaimed for memory, not a failure - handled by a
 * silent reload instead, see tabManager.ts, never shows this page). */
const CRASH_COPY: Record<string, CategoryCopy> = {
  crashed: {
    title: 'This page has crashed',
    detail: () => 'Something went wrong and the page stopped working.',
  },
  'abnormal-exit': {
    title: 'This page has crashed',
    detail: () => "Its process exited unexpectedly - this wasn't something the page did on its own.",
  },
  oom: {
    title: 'This page ran out of memory',
    detail: () => 'It was using too much memory and had to be closed.',
  },
  killed: {
    title: 'This page was closed',
    detail: () => "Its process was terminated - this wasn't something the page did on its own.",
  },
  'launch-failed': {
    title: "This page couldn't load",
    detail: () => 'Its process failed to start.',
  },
  'integrity-failure': {
    title: "This page couldn't load",
    detail: () => 'A code integrity check failed.',
  },
};

function crashCopyFor(reason: string): CategoryCopy {
  return CRASH_COPY[reason] ?? CRASH_COPY.crashed;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Best-effort host for display - falls back to the raw URL if it doesn't
 * even parse (which is exactly the 'invalid' category's normal case). */
function hostOrUrl(failedUrl: string): string {
  try {
    return new URL(failedUrl).hostname || failedUrl;
  } catch {
    return failedUrl;
  }
}

/** Shared visual shell for both page types below - same markup/styling,
 * only the glyph/title/detail/code-line/retry-target actually differ, so
 * this is a mechanical extraction rather than a speculative one. All
 * inputs are expected already HTML-escaped by the caller. */
function renderPage(glyph: string, title: string, detail: string, code: string, retryUrl: string): string {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      html, body {
        height: 100%;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f4ecdc;
        color: #2b2620;
        font-family: Georgia, 'Times New Roman', serif;
      }
      @media (prefers-color-scheme: dark) {
        html, body {
          background: #1a1713;
          color: #f1e8d8;
        }
        .detail { color: #b3a48d !important; }
        .code { color: #6e6353 !important; }
        a.retry { background: #e46953 !important; color: #1a1713 !important; }
      }
      .wrap {
        max-width: 380px;
        padding: 0 32px;
        text-align: center;
      }
      .glyph {
        font-size: 44px;
        line-height: 1;
        margin-bottom: 16px;
        display: inline-block;
        opacity: 0.85;
        transform: rotate(-8deg);
      }
      h1 {
        font-weight: 400;
        font-size: 22px;
        letter-spacing: 0.01em;
        margin: 0 0 10px;
      }
      .detail {
        font-family: -apple-system, sans-serif;
        font-size: 13.5px;
        color: #6b6152;
        line-height: 1.5;
        margin: 0 0 4px;
      }
      .code {
        font-family: ui-monospace, monospace;
        font-size: 11px;
        color: #a89d89;
        margin: 0 0 22px;
      }
      a.retry {
        display: inline-block;
        font-family: -apple-system, sans-serif;
        font-size: 13px;
        font-weight: 600;
        text-decoration: none;
        color: #fdf6ec;
        background: #c44a3a;
        padding: 9px 20px;
        border-radius: 9px;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <span class="glyph" aria-hidden="true">${glyph}</span>
      <h1>${title}</h1>
      <p class="detail">${detail}</p>
      <p class="code">${code}</p>
      <a class="retry" href="${retryUrl}">Try again</a>
    </div>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function buildErrorPageUrl(failedUrl: string, errorCode: number, errorDescription: string): string {
  const copy = COPY[categoryFor(errorCode)];
  const safeHost = escapeHtml(hostOrUrl(failedUrl));
  const safeFailedUrl = escapeHtml(failedUrl);
  const safeCode = escapeHtml(errorDescription || `NET_ERROR(${errorCode})`);
  return renderPage('&#129030;', escapeHtml(copy.title), copy.detail(safeHost), safeCode, safeFailedUrl);
}

export function buildCrashPageUrl(failedUrl: string, reason: string): string {
  const copy = crashCopyFor(reason);
  const safeFailedUrl = escapeHtml(failedUrl);
  const safeReason = escapeHtml(reason);
  return renderPage('&#128165;', escapeHtml(copy.title), copy.detail(''), safeReason, safeFailedUrl);
}
