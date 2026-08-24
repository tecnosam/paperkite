'use client';

import { useState } from 'react';
import Link from 'next/link';
import { site } from '@/lib/site';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ArrowUpRightIcon, GithubIcon, KiteMark } from '@/components/icons';
import styles from './Navbar.module.css';

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className={styles.header}>
      <div className={`shell ${styles.bar}`}>
        <Link href="/" className={styles.brand} onClick={() => setOpen(false)}>
          <KiteMark size={26} />
          <span>Paperkite</span>
        </Link>

        <nav className={`${styles.nav} ${open ? styles.navOpen : ''}`}>
          {site.nav.map((item) => (
            <Link key={item.href} href={item.href} className={styles.navLink} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
          <a href={site.authorSite} target="_blank" rel="noreferrer" className={styles.navLink}>
            {site.authorName}
            <ArrowUpRightIcon size={12} />
          </a>
          <a
            href={site.githubReleases}
            target="_blank"
            rel="noreferrer"
            className={`${styles.navLink} ${styles.navLinkMobileCta}`}
          >
            <GithubIcon size={16} />
            Releases
          </a>
        </nav>

        <div className={styles.actions}>
          <ThemeToggle />
          <a href={site.githubReleases} target="_blank" rel="noreferrer" className={styles.iconLink} title="GitHub releases">
            <GithubIcon size={17} />
          </a>
          <Link href="/download" className="btn btn--primary">
            Download
          </Link>
          <button
            type="button"
            className={styles.burger}
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  );
}
