import type { Metadata } from 'next';
import { getLiveStatus } from '@/lib/status';
import { ConnectionPanel } from '@/components/ConnectionPanel';
import { StatusBoard } from './StatusBoard';
import styles from './status.module.css';

export const metadata: Metadata = {
  title: 'Live status | Paperkite',
  description: 'Unique rooms, total users, liveness, and response time for the public Paperkite chat server.',
};

export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const initial = await getLiveStatus();

  return (
    <main className={styles.page}>
      <div className={`shell ${styles.header}`}>
        <span className="eyebrow">Live status</span>
        <h1 className={styles.h1}>Is the public server up?</h1>
        <p className={styles.lede}>
          Pulled straight from the same server your browser talks to. Refreshes on its own
          every few seconds.
        </p>
      </div>

      <div className={`shell ${styles.layout}`}>
        <StatusBoard initial={initial} />
        <ConnectionPanel />
      </div>
    </main>
  );
}
