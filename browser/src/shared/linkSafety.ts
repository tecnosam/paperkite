/**
 * Heuristic link classification for chat messages. This is a UI-milestone
 * mock, not a real threat-intel feed: no network calls, just an allowlist
 * plus a handful of "looks phishy" signals. Swap for a real service later
 * without touching call sites - everything funnels through classifyLink().
 */

/** A small set of large, commonly-referenced domains treated as safe to
 * click without a second thought. Subdomains match too (docs.google.com). */
const TRUSTED_DOMAINS = [
  'google.com',
  'youtube.com',
  'facebook.com',
  'wikipedia.org',
  'github.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'apple.com',
  'microsoft.com',
  'amazon.com',
  'reddit.com',
  'nytimes.com',
  'bbc.com',
  'stackoverflow.com',
];

/** TLDs disproportionately used for throwaway phishing/spam domains. */
const SUSPICIOUS_TLDS = ['.zip', '.top', '.xyz', '.click', '.work', '.gq', '.tk', '.ml', '.cf', '.country', '.rest'];

/** Brand names that only look legitimate on their real domain - anywhere
 * else, they're almost always an impersonation attempt. */
const IMPERSONATED_BRANDS = ['paypal', 'apple', 'google', 'amazon', 'microsoft', 'netflix', 'facebook', 'bank'];

export type LinkTrust = 'trusted' | 'suspicious' | 'neutral';

/** User-managed lists layered on top of everything below - see
 * shared/types.ts's DomainTrustLists and main/domainTrustStore.ts. An
 * untrusted match always wins (even over the built-in TRUSTED_DOMAINS or
 * same-site check); a trusted match always bypasses the heuristics. */
export interface UserDomainLists {
  trusted: string[];
  untrusted: string[];
}

export const NO_USER_DOMAIN_LISTS: UserDomainLists = { trusted: [], untrusted: [] };

function matchesUserList(hostname: string, list: string[]): boolean {
  return list.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isTrustedDomain(hostname: string): boolean {
  return TRUSTED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function isSameSite(hostname: string, currentPageHost: string): boolean {
  if (!currentPageHost) return false;
  return hostname === currentPageHost || hostname.endsWith(`.${currentPageHost}`);
}

function looksSuspicious(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true; // raw IP
  if (hostname.startsWith('xn--')) return true; // punycode / IDN homograph
  if (SUSPICIOUS_TLDS.some((tld) => hostname.endsWith(tld))) return true;
  if ((hostname.match(/-/g) ?? []).length >= 3) return true; // brand-secure-login-verify.com

  const isRealBrandDomain = isTrustedDomain(hostname);
  if (!isRealBrandDomain && IMPERSONATED_BRANDS.some((brand) => hostname.includes(brand))) return true;

  return false;
}

/** Classifies a URL for the currently-active tab's page (for "same site"
 * trust). `currentPageHost` should be a bare hostname, e.g. "github.com".
 * `userLists` is checked before anything else built-in - see UserDomainLists. */
export function classifyLink(
  url: string,
  currentPageHost: string,
  userLists: UserDomainLists = NO_USER_DOMAIN_LISTS,
): LinkTrust {
  const hostname = hostnameOf(url);
  if (!hostname) return 'suspicious'; // unparseable - treat as unsafe

  if (matchesUserList(hostname, userLists.untrusted)) return 'suspicious';
  if (matchesUserList(hostname, userLists.trusted)) return 'trusted';

  if (looksSuspicious(hostname)) return 'suspicious';
  if (isTrustedDomain(hostname) || isSameSite(hostname, currentPageHost)) return 'trusted';
  return 'neutral';
}

/** Censors a suspicious link for display: keeps just enough of the start
 * and end that it still reads as "a link", asterisks out everything else
 * so the actual destination can't be read (or clicked - this is text,
 * never rendered as a real anchor). */
export function maskSuspiciousLink(url: string): string {
  const keepStart = 8; // covers "https://" (or most of "http://")
  const keepEnd = 4;
  if (url.length <= keepStart + keepEnd + 3) return '*'.repeat(url.length);

  const middleLength = url.length - keepStart - keepEnd;
  return url.slice(0, keepStart) + '*'.repeat(middleLength) + url.slice(url.length - keepEnd);
}

const URL_PATTERN = /https?:\/\/[^\s]+/gi;

export interface TextSegment {
  kind: 'text';
  value: string;
}
export interface LinkSegment {
  kind: 'link';
  url: string;
  trust: LinkTrust;
}
export type MessageSegment = TextSegment | LinkSegment;

/** Splits message text into plain-text and link segments, classifying
 * each link against the current page's host. */
export function splitMessageIntoSegments(
  text: string,
  currentPageHost: string,
  userLists: UserDomainLists = NO_USER_DOMAIN_LISTS,
): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, index) });
    }
    segments.push({ kind: 'link', url, trust: classifyLink(url, currentPageHost, userLists) });
    lastIndex = index + url.length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}
