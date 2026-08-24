import { site } from '@/lib/site';
import { DotIcon } from '@/components/icons';
import styles from './ConnectionPanel.module.css';

export function ConnectionPanel() {
  const { publicServer } = site;
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.badge}>
          <DotIcon size={7} className={publicServer.deployed ? styles.dotLive : styles.dotPending} />
          {publicServer.deployed ? 'Live' : 'Not deployed yet'}
        </span>
        <span className={styles.title}>Public chat-service</span>
      </div>

      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>HTTP</dt>
          <dd className="mono">{publicServer.httpUrl}</dd>
        </div>
        <div className={styles.row}>
          <dt>gRPC</dt>
          <dd className="mono">{publicServer.grpcHost}</dd>
        </div>
        <div className={styles.row}>
          <dt>Health</dt>
          <dd className="mono">{publicServer.httpUrl}{publicServer.healthPath}</dd>
        </div>
      </dl>

      {!publicServer.deployed && (
        <p className={styles.note}>
          These addresses are placeholders. The maintainers have not stood up a public instance
          yet. Point at your own server in the meantime (see &ldquo;Run your own&rdquo; below),
          or check <a href="/status">/status</a> once this is live.
        </p>
      )}
    </div>
  );
}
