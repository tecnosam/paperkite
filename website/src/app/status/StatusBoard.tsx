'use client';

import { useEffect, useState } from 'react';
import type { LiveStatus } from '@/lib/status';
import { DotIcon } from '@/components/icons';
import styles from './StatusBoard.module.css';

const POLL_MS = 8000;

const livenessCopy: Record<LiveStatus['liveness'], string> = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
};

export function StatusBoard({ initial }: { initial: LiveStatus }) {
  const [status, setStatus] = useState<LiveStatus>(initial);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/status', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const next: LiveStatus = await res.json();
        setStatus(next);
        setPulse(true);
        setTimeout(() => setPulse(false), 400);
      } catch {
        // keep showing the last known status
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const checkedAt = new Date(status.checkedAt);

  return (
    <div className={styles.board}>
      {status.demo && (
        <div className={styles.demoBanner}>
          Demo data. chat-service does not push real metrics yet. This board will poll a live
          endpoint once it does (Prometheus, Redis, or an event broker, still being decided).
        </div>
      )}

      <div className={styles.grid}>
        <div className={styles.tile}>
          <span className={styles.label}>Liveness</span>
          <span className={`${styles.value} ${styles.livenessValue}`}>
            <DotIcon
              size={9}
              className={
                status.liveness === 'online'
                  ? styles.dotOnline
                  : status.liveness === 'degraded'
                    ? styles.dotDegraded
                    : styles.dotOffline
              }
            />
            {livenessCopy[status.liveness]}
          </span>
        </div>

        <div className={styles.tile}>
          <span className={styles.label}>Response time</span>
          <span className={`${styles.value} ${pulse ? styles.pulse : ''}`}>
            {status.latencyMs !== null ? `${status.latencyMs} ms` : 'N/A'}
          </span>
        </div>

        <div className={styles.tile}>
          <span className={styles.label}>Unique rooms</span>
          <span className={`${styles.value} ${pulse ? styles.pulse : ''}`}>{status.uniqueRooms.toLocaleString()}</span>
        </div>

        <div className={styles.tile}>
          <span className={styles.label}>Total users</span>
          <span className={`${styles.value} ${pulse ? styles.pulse : ''}`}>{status.totalUsers.toLocaleString()}</span>
        </div>
      </div>

      <p className={styles.footnote}>
        Last checked{' '}
        <time dateTime={status.checkedAt} suppressHydrationWarning>
          {checkedAt.toLocaleTimeString()}
        </time>{' '}
        · refreshes every {POLL_MS / 1000}s
      </p>
    </div>
  );
}
