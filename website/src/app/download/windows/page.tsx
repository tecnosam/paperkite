import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { getLatestBrowserRelease } from '@/lib/releases';
import { detectArch } from '@/lib/platform';
import { site } from '@/lib/site';
import { WindowsIcon, ChipIcon, InfoIcon, ArrowRightIcon, GithubIcon } from '@/components/icons';
import { AssetButton } from '../AssetButton';
import headerStyles from '../download.module.css';
import styles from '../platform.module.css';

export const metadata: Metadata = {
  title: 'Download Paperkite for Windows',
  description: 'Get the Paperkite browser for Windows: x64 and ARM64 builds.',
};

export const revalidate = 600;

export default async function WindowsDownloadPage() {
  const [release, ua] = await Promise.all([getLatestBrowserRelease(), headers().then((h) => h.get('user-agent'))]);
  const arch = detectArch(ua);

  return (
    <main className={headerStyles.page}>
      <div className={`shell ${headerStyles.header}`}>
        <Link href="/download" className={headerStyles.back}>
          ← All platforms
        </Link>
        <span className="eyebrow">
          <WindowsIcon size={13} /> Windows
        </span>
        <h1 className={headerStyles.h1}>Download Paperkite for Windows.</h1>
        <p className={headerStyles.lede}>
          {release ? (
            <>
              Version <span className="mono">{release.version}</span>. Choose the build that
              matches your CPU.
            </>
          ) : (
            'Choose the build that matches your CPU.'
          )}
        </p>
      </div>

      <div className={`shell ${styles.archGrid}`}>
        <section className={styles.archCard}>
          <div className={styles.archHead}>
            <ChipIcon size={16} />
            <h2>x64</h2>
            {arch === 'x64' && <span className={styles.badge}>Recommended for your device</span>}
          </div>
          <p className={styles.archNote}>Intel and AMD processors, used in almost every Windows PC today.</p>

          <div className={styles.assetList}>
            {release?.windows.x64.installer ? (
              <AssetButton asset={release.windows.x64.installer} label="Download installer" hint=".exe, recommended" primary />
            ) : (
              <p className={styles.unavailable}>Installer not available in the latest release.</p>
            )}
            {release?.windows.x64.zip && (
              <AssetButton asset={release.windows.x64.zip} label="Portable build" hint=".zip, no installer" />
            )}
          </div>
          {release?.windows.x64.checksums && (
            <a href={release.windows.x64.checksums.url} className={`mono ${styles.checksumLink}`}>
              Verify with SHA-256 checksums →
            </a>
          )}
        </section>

        <section className={styles.archCard}>
          <div className={styles.archHead}>
            <ChipIcon size={16} />
            <h2>ARM64</h2>
            {arch === 'arm64' && <span className={styles.badge}>Recommended for your device</span>}
          </div>
          <p className={styles.archNote}>Windows on ARM devices, including Surface Pro X and similar ARM-based laptops.</p>

          <div className={styles.caveat}>
            <InfoIcon size={13} />
            <span>
              Cross-compiled and not code-signed yet. Windows SmartScreen will likely warn before
              it opens. Portable zip only, no installer.
            </span>
          </div>

          <div className={styles.assetList}>
            {release?.windows.arm64.zip ? (
              <AssetButton asset={release.windows.arm64.zip} label="Portable build" hint=".zip" />
            ) : (
              <p className={styles.unavailable}>Not available in the latest release.</p>
            )}
          </div>
          {release?.windows.arm64.checksums && (
            <a href={release.windows.arm64.checksums.url} className={`mono ${styles.checksumLink}`}>
              Verify with SHA-256 checksums →
            </a>
          )}
        </section>
      </div>

      <div className={`shell ${styles.footer}`}>
        {release && (
          <a href={release.htmlUrl} target="_blank" rel="noreferrer" className={styles.footLink}>
            Release notes for {release.tag}
            <ArrowRightIcon size={12} />
          </a>
        )}
        <a href={site.githubReleases} target="_blank" rel="noreferrer" className={styles.footLink}>
          <GithubIcon size={13} />
          Browse all releases on GitHub
        </a>
      </div>
    </main>
  );
}
