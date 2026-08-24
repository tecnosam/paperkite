import { site } from '@/lib/site';

export type LiveStatus = {
  /** HyperLogLog estimate of unique chat rooms ever opened - see
   *  chat-service's GET /custom-metrics. Approximate (~0.2% margin), not
   *  an exact count, and counts rooms since garbage-collected out of the
   *  live server too, not just currently-active ones. */
  uniqueRooms: number;
  /** HyperLogLog estimate of unique usernames ever claimed - same
   *  endpoint and margin of error as uniqueRooms. */
  totalUsers: number;
  liveness: 'online' | 'degraded' | 'offline';
  latencyMs: number | null;
  checkedAt: string;
  /** true until chat-service is deployed and reachable - see
   *  site.publicServer.deployed. The UI must keep this visible wherever
   *  the numbers are shown. */
  demo: boolean;
};

// The shape of chat-service's GET /custom-metrics response (see
// chat-service/internal/metrics.Snapshot).
type CustomMetrics = {
  unique_rooms: number;
  unique_users: number;
};

// Deterministic-looking but slowly-drifting mock series, seeded off the
// current minute so a poll loop sees gentle movement instead of either a
// frozen number or distracting per-request jitter. Used only while
// site.publicServer.deployed is false.
export async function getLiveStatus(): Promise<LiveStatus> {
  if (site.publicServer.deployed) {
    return getRealStatus();
  }
  return getMockStatus();
}

async function getMockStatus(): Promise<LiveStatus> {
  const minute = Math.floor(Date.now() / 60_000);
  const wobble = (seed: number, span: number) => Math.floor(((Math.sin(minute / 7 + seed) + 1) / 2) * span);

  return {
    uniqueRooms: 40 + wobble(1, 55),
    totalUsers: 1284 + wobble(3, 60),
    liveness: 'online',
    latencyMs: 38 + wobble(2, 40),
    checkedAt: new Date().toISOString(),
    demo: true,
  };
}

// Liveness and latency come from /healthz; unique room/user counts come
// from /custom-metrics - two independent fetches (in parallel, via
// allSettled so one failing doesn't sink the other) because they answer
// different questions. A /custom-metrics failure degrades gracefully to
// 0 rather than affecting liveness - that endpoint being briefly down
// doesn't mean the chat server itself is unhealthy.
async function getRealStatus(): Promise<LiveStatus> {
  const start = performance.now();
  const [health, metricsResult] = await Promise.allSettled([
    fetch(`${site.publicServer.httpUrl}${site.publicServer.healthPath}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    }),
    fetch(`${site.publicServer.httpUrl}${site.publicServer.metricsPath}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    }).then((res): Promise<CustomMetrics | null> => (res.ok ? res.json() : Promise.resolve(null))),
  ]);
  const latencyMs = Math.round(performance.now() - start);

  const liveness: LiveStatus['liveness'] =
    health.status !== 'fulfilled' ? 'offline' : health.value.ok ? 'online' : 'degraded';
  const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value : null;

  return {
    uniqueRooms: metrics?.unique_rooms ?? 0,
    totalUsers: metrics?.unique_users ?? 0,
    liveness,
    latencyMs: health.status === 'fulfilled' ? latencyMs : null,
    checkedAt: new Date().toISOString(),
    demo: false,
  };
}
