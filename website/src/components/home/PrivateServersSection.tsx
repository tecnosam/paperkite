import Link from 'next/link';
import { ArrowRightIcon, ServerIcon } from '@/components/icons';
import styles from './PrivateServersSection.module.css';

const lines = [
  { c: '$', t: 'git clone ' },
  { c: '', t: 'go build ./cmd/server' },
  { c: '', t: 'CHAT_JWT_SECRET=... ./server' },
  { c: '#', t: 'HTTP :8080 · gRPC :50051' },
];

export function PrivateServersSection() {
  return (
    <section id="private-servers" className={styles.section}>
      <div className={`shell ${styles.grid}`}>
        <div className={styles.terminal}>
          <div className={styles.terminalHead}>
            <span /><span /><span />
            <span className={styles.terminalTitle}>chat-service</span>
          </div>
          <div className={styles.terminalBody}>
            {lines.map((l, i) => (
              <div key={i} className={styles.line}>
                <span className={styles.prompt}>{l.c}</span>
                {l.t}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.copy}>
          <span className="eyebrow">
            <ServerIcon size={13} />
            Run your own
          </span>
          <h2 className={styles.title}>Don&apos;t trust our server. Run yours.</h2>
          <p className={styles.body}>
            The chat backend is a small, stateless Go service. Deploy it in a container, on a
            VPS, or on your laptop for a LAN. Point Paperkite at it from Settings, and every
            room on that instance runs on your infrastructure.
          </p>
          <Link href="/protocol" className={styles.link}>
            Read the connection details <ArrowRightIcon size={13} />
          </Link>
        </div>
      </div>
    </section>
  );
}
