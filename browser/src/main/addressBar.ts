/**
 * Turns whatever the user typed into the address bar into a navigable URL:
 * a URL with a scheme is used as-is, a bare domain gets `https://`
 * prepended, and anything else is treated as a search query.
 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOOKS_LIKE_HOST = /^[^\s]+\.[^\s]{2,}$|^localhost(:\d+)?$/i;
const SEARCH_ENGINE_URL = 'https://www.google.com/search?q=';

export function resolveAddressBarInput(rawInput: string): string {
  const input = rawInput.trim();

  if (HAS_SCHEME.test(input)) {
    return input;
  }
  if (!input.includes(' ') && LOOKS_LIKE_HOST.test(input)) {
    return `https://${input}`;
  }
  return `${SEARCH_ENGINE_URL}${encodeURIComponent(input)}`;
}
