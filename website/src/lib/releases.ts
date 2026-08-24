export type BrowserAsset = {
  name: string;
  url: string;
  /** Bytes, straight from the GitHub API - formatted for display where shown. */
  size: number;
};

export type WindowsAssets = {
  /** The proper Setup.exe installer - only ever built for x64 today, see
   *  BrowserRelease's doc comment. */
  installer: BrowserAsset | null;
  zip: BrowserAsset | null;
  checksums: BrowserAsset | null;
};

export type LinuxAssets = {
  deb: BrowserAsset | null;
  rpm: BrowserAsset | null;
  zip: BrowserAsset | null;
  checksums: BrowserAsset | null;
};

// macOS is deliberately absent here - CI doesn't build it yet (no Apple
// Developer signing certs, see .github/workflows/release-browser.yml's
// own comment), so there's nothing to parse out of the release assets.
// Add a `macos` field here (and wire up a /download/macos page) once a
// real signed build exists.
export type BrowserRelease = {
  version: string;
  tag: string;
  publishedAt: string;
  /** Link to the release itself on GitHub, for "view full changelog" etc. */
  htmlUrl: string;
  windows: {
    x64: WindowsAssets;
    /** Cross-compiled, not code-signed - ships as a zip only, no
     *  installer. See the windows download page for the user-facing
     *  caveat this implies (likely SmartScreen warnings). */
    arm64: { zip: BrowserAsset | null; checksums: BrowserAsset | null };
  };
  linux: {
    x64: LinuxAssets;
    arm64: LinuxAssets;
  };
};

type GithubAsset = { name: string; browser_download_url: string; size: number };
type GithubRelease = {
  tag_name: string;
  published_at: string;
  html_url: string;
  assets: GithubAsset[];
  draft: boolean;
  prerelease: boolean;
};

function toAsset(a: GithubAsset | undefined): BrowserAsset | null {
  if (!a) return null;
  return { name: a.name, url: a.browser_download_url, size: a.size };
}

function find(assets: GithubAsset[], pattern: RegExp): GithubAsset | undefined {
  return assets.find((a) => pattern.test(a.name));
}

// Fetches and parses the most recent browser-v* GitHub release into a
// structured shape the download pages render directly. Filenames are
// matched by the stable substrings electron-forge/CI actually produce
// (see .github/workflows/release-browser.yml) - e.g. "win32-x64-" or
// "_amd64.deb" - not the exact version number, so a version bump alone
// never needs a matching code change here.
//
// Returns null on any failure (network error, no matching release, bad
// response) rather than throwing - callers render a graceful fallback
// (a plain link to the GitHub releases page) instead of a broken page.
export async function getLatestBrowserRelease(): Promise<BrowserRelease | null> {
  try {
    // /releases, not /latest - same reasoning as deploy/setup-droplet.sh:
    // this is a monorepo with browser-v*/chat-service-v*/website-v* tags
    // interleaved, and /latest is scoped to the single most recent tag
    // across ALL of them, not just this component's.
    const res = await fetch(`https://api.github.com/repos/tecnosam/paperkite/releases`, {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 600 }, // release cadence is nowhere near this fast
    });
    if (!res.ok) return null;

    const releases: GithubRelease[] = await res.json();
    const release = releases.find((r) => !r.draft && !r.prerelease && r.tag_name.startsWith('browser-v'));
    if (!release) return null;

    const assets = release.assets;
    return {
      version: release.tag_name.replace(/^browser-v/, ''),
      tag: release.tag_name,
      publishedAt: release.published_at,
      htmlUrl: release.html_url,
      windows: {
        x64: {
          installer: toAsset(find(assets, /\.Setup\.exe$/)),
          zip: toAsset(find(assets, /win32-x64-.*\.zip$/)),
          checksums: toAsset(find(assets, /win32-x64-checksums\.txt$/)),
        },
        arm64: {
          zip: toAsset(find(assets, /win32-arm64-.*\.zip$/)),
          checksums: toAsset(find(assets, /win32-arm64-checksums\.txt$/)),
        },
      },
      linux: {
        x64: {
          deb: toAsset(find(assets, /_amd64\.deb$/)),
          rpm: toAsset(find(assets, /x86_64\.rpm$/)),
          zip: toAsset(find(assets, /linux-x64-.*\.zip$/)),
          checksums: toAsset(find(assets, /linux-x64-checksums\.txt$/)),
        },
        arm64: {
          deb: toAsset(find(assets, /_arm64\.deb$/)),
          rpm: toAsset(find(assets, /arm64\.rpm$/)),
          zip: toAsset(find(assets, /linux-arm64-.*\.zip$/)),
          checksums: toAsset(find(assets, /linux-arm64-checksums\.txt$/)),
        },
      },
    };
  } catch {
    return null;
  }
}

/** Formats a byte count as e.g. "84.2 MB" for display next to a download link. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}
