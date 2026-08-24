export type DetectedOS = 'windows' | 'linux' | 'unknown';
export type DetectedArch = 'x64' | 'arm64' | 'unknown';

// Best-effort User-Agent sniffing, done server-side off the request
// header, to pick a sensible default landing page / pre-selected
// download - never the only way to reach a given platform's build, every
// option stays visible and clickable regardless of what this guesses.
// Not security-sensitive: worst case a wrong guess just costs one extra
// click, so simple substring checks are fine here - no need for a full
// UA-parsing library.
export function detectOS(userAgent: string | null): DetectedOS {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  // Android UAs also contain "linux" - has to be excluded explicitly.
  // This page is for desktop installs, so Android isn't routed anywhere
  // useful either way; it just falls through to "unknown".
  if (ua.includes('linux') && !ua.includes('android')) return 'linux';
  return 'unknown';
}

// CPU architecture is far less reliable to read from a plain
// User-Agent string than OS is - most browsers only expose it
// inconsistently, and it's the reason every download page still shows
// every architecture explicitly rather than silently picking one. x64 is
// by far the more common desktop architecture, so it's the sensible
// fallback guess when nothing in the UA string says otherwise.
export function detectArch(userAgent: string | null): DetectedArch {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (ua.includes('arm64') || ua.includes('aarch64')) return 'arm64';
  if (ua.includes('win64') || ua.includes('wow64') || ua.includes('x86_64') || ua.includes('x64')) return 'x64';
  return 'unknown';
}
