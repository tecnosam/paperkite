import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { detectOS } from '@/lib/platform';
import { site } from '@/lib/site';
import { WindowsIcon, LinuxIcon, ArrowRightIcon } from '@/components/icons';
import styles from './download.module.css';

export const metadata: Metadata = {
  title: 'Download Paperkite',
  description: 'Get the Paperkite browser for Windows or Linux, x64 or ARM64.',
};

// Redirects straight to the matching platform page when the request's
// User-Agent confidently says Windows or Linux - see lib/platform.ts.
// Everything else (macOS, an unrecognized UA, a bot, or no UA header at
// all) falls through and renders the chooser below instead of guessing.
export default async function DownloadPage() {
  const ua = (await headers()).get('user-agent');
  const os = detectOS(ua);

  if (os === 'windows') redirect('/download/windows');
  if (os === 'linux') redirect('/download/linux');

  return (
    <main className={styles.page}>
      <div className={`shell ${styles.header}`}>
        <span className="eyebrow">Download</span>
        <h1 className={styles.h1}>Choose your platform.</h1>
        <p className={styles.lede}>
          We couldn&apos;t tell which OS you&apos;re on. Pick one below. Each platform page also
          lets you choose the right build for your CPU.
        </p>
      </div>

      <div className={`shell ${styles.chooserGrid}`}>
        <Link href="/download/windows" className={styles.chooserCard}>
          <WindowsIcon size={30} />
          <span className={styles.chooserTitle}>Windows</span>
          <span className={styles.chooserSub}>x64 · ARM64</span>
          <span className={styles.chooserCta}>
            Choose Windows <ArrowRightIcon size={13} />
          </span>
        </Link>
        <Link href="/download/linux" className={styles.chooserCard}>
          <LinuxIcon size={30} />
          <span className={styles.chooserTitle}>Linux</span>
          <span className={styles.chooserSub}>.deb · .rpm · .zip · x64 · ARM64</span>
          <span className={styles.chooserCta}>
            Choose Linux <ArrowRightIcon size={13} />
          </span>
        </Link>
      </div>

      <div className={`shell ${styles.macNote}`}>
        <p>
          Looking for macOS? Signed builds aren&apos;t published yet. Paperkite is open source.
          Build it{' '}
          <a href={site.githubRepo} target="_blank" rel="noreferrer">
            from source
          </a>{' '}
          in the meantime, or browse{' '}
          <a href={site.githubReleases} target="_blank" rel="noreferrer">
            all releases on GitHub
          </a>
          .
        </p>
      </div>
    </main>
  );
}
