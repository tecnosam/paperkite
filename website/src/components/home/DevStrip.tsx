import Link from 'next/link';
import { ArrowRightIcon, PulseIcon } from '@/components/icons';
import styles from './DevStrip.module.css';

export function DevStrip() {
  return (
    <section className={styles.section}>
      <div className={`shell ${styles.grid}`}>
        <Link href="/protocol" className={styles.card}>
          <span className={styles.mono}>PROTOCOL.md</span>
          <h3>Read the wire protocol</h3>
          <p>HTTP/JSON, gRPC, SSE, and long-poll: how rooms, identity, and delivery work.</p>
          <span className={styles.cta}>
            View protocol <ArrowRightIcon size={13} />
          </span>
        </Link>

        <Link href="/status" className={styles.card}>
          <span className={styles.mono}>
            <PulseIcon size={12} /> live
          </span>
          <h3>Check the public server status</h3>
          <p>Unique rooms, total users, liveness, and response time for the server we host.</p>
          <span className={styles.cta}>
            View status <ArrowRightIcon size={13} />
          </span>
        </Link>
      </div>
    </section>
  );
}
