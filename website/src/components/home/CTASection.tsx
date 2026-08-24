import { site } from '@/lib/site';
import { ArrowRightIcon, GithubIcon, KiteMark } from '@/components/icons';
import styles from './CTASection.module.css';

export function CTASection() {
  return (
    <section className={styles.section}>
      <div className={`shell ${styles.inner}`}>
        <KiteMark size={44} className={styles.kite} />
        <h2 className={styles.title}>Download Paperkite.</h2>
        <p className={styles.body}>
          Paperkite is free and open source. Read the source before you trust it with anything.
        </p>
        <div className={styles.ctas}>
          <a href={site.githubReleases} target="_blank" rel="noreferrer" className="btn btn--primary">
            Download for free
            <ArrowRightIcon size={15} />
          </a>
          <a href={site.githubRepo} target="_blank" rel="noreferrer" className="btn btn--ghost">
            <GithubIcon size={16} />
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
