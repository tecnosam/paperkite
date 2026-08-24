/**
 * Single place to swap placeholder URLs for real ones once the project
 * has a public repo, a deployed chat-service, and a stats backend.
 */
export const site = {
  name: 'Paperkite',
  tagline: 'A browser with a room for everyone already reading the page.',

  githubRepo: 'https://github.com/tecnosam/paperkite',
  githubReleases: 'https://github.com/tecnosam/paperkite/releases',

  authorSite: 'https://samuelabolo.dev',
  authorName: 'Samuel Abolo',

  // chat-service terminates its own TLS now (golang.org/x/crypto/acme/
  // autocert, no reverse proxy in front of it) - see
  // chat-service/deploy/README.md's "Domain and TLS" section. Confirmed
  // live: `curl https://paperkite-chat-service.samuelabolo.dev/healthz`.
  //
  // grpcHost is left as a placeholder on purpose: chat-service-server
  // only binds :443/:8080 for HTTP, and the recommended DigitalOcean
  // firewall rule blocks direct access to :50051 from outside. gRPC
  // isn't actually reachable at this host yet - it'd need its own
  // exposure (a direct-IP allowlist rule, or fronting it separately).
  // Not needed for the browser or website, which only ever speak HTTP -
  // see PROTOCOL.md, gRPC is documented as an alternate path for
  // server-side integrations, not something either of those clients use.
  publicServer: {
    httpUrl: 'https://paperkite-chat-service.samuelabolo.dev',
    grpcHost: 'TODO-not-yet-exposed:50051',
    healthPath: '/healthz',
    // Unauthenticated HyperLogLog cardinality estimates (unique_rooms,
    // unique_users) - see chat-service/internal/api's MetricsHandler doc
    // comment and internal/hll's package doc comment for the ~0.2%
    // margin of error. Consumed by src/lib/status.ts.
    metricsPath: '/custom-metrics',
    deployed: true,
  },

  nav: [
    { label: 'Features', href: '/#features' },
    { label: 'Protocol', href: '/protocol' },
    { label: 'Status', href: '/status' },
  ],
} as const;
