import Link from 'next/link';
import { site } from '@/lib/site';
import { ArrowUpRightIcon, GithubIcon, KiteMark } from '@/components/icons';
import styles from './Footer.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`shell ${styles.grid}`}>
        <div className={styles.col}>
          <div className={styles.brand}>
            <KiteMark size={24} />
            <span>Paperkite</span>
          </div>
          <p className={styles.tagline}>{site.tagline}</p>
          <p className={styles.oss}>
            MIT licensed. Every line of the browser, protocol, and server is open source.
          </p>
        </div>

        <div className={styles.col}>
          <span className={styles.colTitle}>Product</span>
          <Link href="/#features" className={styles.link}>Features</Link>
          <Link href="/#agents" className={styles.link}>AI agents</Link>
          <Link href="/#private-servers" className={styles.link}>Private servers</Link>
        </div>

        <div className={styles.col}>
          <span className={styles.colTitle}>Developers</span>
          <Link href="/protocol" className={styles.link}>Protocol</Link>
          <Link href="/status" className={styles.link}>Live status</Link>
          <a href={site.githubRepo} target="_blank" rel="noreferrer" className={styles.link}>
            Source code
          </a>
        </div>

        <div className={styles.col}>
          <span className={styles.colTitle}>Elsewhere</span>
          <a href={site.githubReleases} target="_blank" rel="noreferrer" className={styles.link}>
            <GithubIcon size={14} /> Releases <ArrowUpRightIcon size={11} />
          </a>
          <a href={site.authorSite} target="_blank" rel="noreferrer" className={styles.link}>
            {site.authorName} <ArrowUpRightIcon size={11} />
          </a>
        </div>
      </div>

      <div className={`shell ${styles.bottom}`}>
        <span>© {new Date().getFullYear()} Paperkite.</span>
        <span className={styles.mono}>MIT License</span>
      </div>
    </footer>
  );
}
