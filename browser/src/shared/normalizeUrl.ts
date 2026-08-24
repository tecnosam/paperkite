/**
 * THE URL normalization function. Every room key in the app is derived
 * from this, and only this. To change chat granularity later (e.g. room
 * per-query-string, room per-host instead of per-path), edit this
 * function and nothing else needs to change.
 *
 * Rules: lowercase scheme + host, drop fragment and query string, drop
 * a trailing slash, keep the path. `https://News.YCombinator.com/item?id=1#c`
 * -> `https://news.ycombinator.com/item`.
 */
export function normalizeToRoomKey(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // Not a parseable URL (e.g. "about:blank" edge cases) - fall back to
    // the raw string so callers always get a stable, non-throwing key.
    return rawUrl;
  }

  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  const host = parsed.hostname.toLowerCase();
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return `${scheme}://${host}${path}`;
}

/** Normalizes free-form domain input (for the trusted/untrusted domain
 * lists in Settings) down to a bare lowercase hostname - strips a scheme/
 * path/port if a full URL was pasted, so "https://Example.com/foo" and
 * "example.com" both normalize the same. */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}
