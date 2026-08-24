import type { Metadata } from 'next';
import { ConnectionPanel } from '@/components/ConnectionPanel';
import { CodeBlock } from '@/components/CodeBlock';
import styles from './protocol.module.css';

export const metadata: Metadata = {
  title: 'Protocol | Paperkite',
  description: 'The wire protocol chat-service speaks: HTTP/JSON, gRPC, long-polling, and Server-Sent Events.',
};

const toc = [
  { id: 'overview', label: 'Overview' },
  { id: 'identity', label: 'Identity & rooms' },
  { id: 'connect', label: 'POST /connect' },
  { id: 'send', label: 'POST /send' },
  { id: 'poll', label: 'GET /poll' },
  { id: 'events', label: 'GET /events' },
  { id: 'grpc', label: 'gRPC' },
  { id: 'tips', label: 'Client tips' },
];

export default function ProtocolPage() {
  return (
    <main className={styles.page}>
      <div className={`shell ${styles.header}`}>
        <span className="eyebrow">Reference</span>
        <h1 className={styles.h1}>The chat-service wire protocol</h1>
        <p className={styles.lede}>
          Everything a client needs to talk to a Paperkite chat server, straight from{' '}
          <code className={styles.inlineCode}>PROTOCOL.md</code> in the chat-service repo. No
          WebSocket, no server-side sessions. A client&apos;s entire state is a JWT, a cursor,
          and, if polling, a backoff hint.
        </p>
      </div>

      <div className={`shell ${styles.layout}`}>
        <aside className={styles.sidebar}>
          <nav className={styles.toc}>
            <span className={styles.tocTitle}>On this page</span>
            {toc.map((t) => (
              <a key={t.id} href={`#${t.id}`}>{t.label}</a>
            ))}
          </nav>
          <ConnectionPanel />
        </aside>

        <div className={styles.content}>
          <section id="overview" className={styles.section}>
            <h2>Overview</h2>
            <p>
              The service exposes two transports. There&apos;s no WebSocket, but two ways to
              receive messages, both built on the same per-room buffer:
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Transport</th><th>Address</th><th>Purpose</th></tr>
                </thead>
                <tbody>
                  <tr><td className="mono">HTTP/JSON</td><td className="mono">:8080</td><td>Primary client protocol: connect, send, poll</td></tr>
                  <tr><td className="mono">gRPC</td><td className="mono">:50051</td><td>Alternative <code>SendMessage</code> RPC, same auth/semantics</td></tr>
                </tbody>
              </table>
            </div>
            <ul className={styles.list}>
              <li><code>GET /poll</code>: short-interval long-polling with a server-computed backoff hint.</li>
              <li><code>GET /events</code>: a real Server-Sent Events stream for instant delivery.</li>
            </ul>
            <p>
              Everything is stateless server-side aside from the in-memory per-room buffer and,
              for <code>/events</code>, the set of currently-connected live subscribers.
            </p>
          </section>

          <section id="identity" className={styles.section}>
            <h2>Identity & rooms</h2>
            <ul className={styles.list}>
              <li>
                A <strong>room</strong> is <code>md5(strip_trailing_slashes(url))</code>. Two
                clients on the same URL land in the same room. There is no separate
                &ldquo;create room&rdquo; step.
              </li>
              <li>
                <strong>Identity</strong> (username, browser, session_id, region) is asserted by
                the client at connect time and signed into a JWT. There&apos;s no password and
                no verification.
              </li>
              <li>
                <code>username</code> is the one exception: the first successful claim is
                permanent, server-wide, case-insensitive, and survives restarts. A second{' '}
                <code>username</code>-based connect for a taken name gets <code>409</code>.
              </li>
              <li>
                A client that already holds a <strong>token</strong> can skip the claim entirely.
                Present it instead of <code>username</code> to join another room or mint a
                fresh token, with no <code>409</code>.
              </li>
              <li>The JWT never expires and isn&apos;t centrally revoked. &ldquo;Disconnecting&rdquo; is a client deciding to stop polling.</li>
            </ul>
          </section>

          <section id="connect" className={styles.section}>
            <h2>POST /connect</h2>
            <p>Establishes an identity and issues a JWT for a room. Exactly one of <code>username</code> / <code>token</code> must be present.</p>
            <CodeBlock label="Request: claim a new username">{`{
  "url": "https://example.com/chat/room-1",
  "username": "alice",
  "browser": "Chrome/120",
  "session_id": "sess-abc123",
  "region": "us-east"
}`}</CodeBlock>
            <CodeBlock label="Response (200)">{`{
  "token": "eyJhbGciOi...",
  "cursor": 42
}`}</CodeBlock>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Status</th><th>Cause</th></tr></thead>
                <tbody>
                  <tr><td className="mono">400</td><td>missing required field, or invalid JSON</td></tr>
                  <tr><td className="mono">401</td><td>token invalid, or its username no longer claimed</td></tr>
                  <tr><td className="mono">409</td><td>username already claimed by anyone, ever</td></tr>
                  <tr><td className="mono">500</td><td>server-side failure claiming/signing</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="send" className={styles.section}>
            <h2>POST /send</h2>
            <p>Publishes to the room encoded in the caller&apos;s token. Room and sender are never taken from the body.</p>
            <CodeBlock label="Request">{`{ "content": "hello" }`}</CodeBlock>
            <CodeBlock label="Response (200)">{`{ "id": "1733950000000000000" }`}</CodeBlock>
            <p className={styles.note}>
              No rate limiting of any kind. <code>session_id</code> is fully client-asserted, so
              a server-side per-session limit would only throttle well-behaved clients. Abuse
              mitigation lives at the network edge.
            </p>
          </section>

          <section id="poll" className={styles.section}>
            <h2>GET /poll?cursor={'{seq}'}</h2>
            <p>Fetches messages published after <code>cursor</code>. <code>304</code> means nothing new. <code>200</code> carries a batch and an advanced cursor.</p>
            <CodeBlock label="Response (200)">{`{
  "messages": [
    {
      "id": "1733950000000000000",
      "seq": 43,
      "room": "5d41402abc4b2a76b9719d911017c592",
      "sender": "alice",
      "content": "hello",
      "timestamp": 1733950000123
    }
  ],
  "cursor": 43,
  "next_poll_ms": 1000
}`}</CodeBlock>
            <p className={styles.note}>
              The server buffers up to 256 messages per room for up to 120s. A stale cursor
              returns the entire available buffer, not an error. Treat it as partial history.
            </p>
          </section>

          <section id="events" className={styles.section}>
            <h2>GET /events?cursor={'{seq}'}</h2>
            <p>Upgrades to <code>text/event-stream</code>: catches up like <code>/poll</code>, then pushes every new message instantly.</p>
            <CodeBlock label="Stream: one message">{`data: {"id":"1733950000000000000","seq":43,"room":"5d41402ab...","sender":"alice","content":"hello","timestamp":1733950000123}
`}</CodeBlock>
            <p className={styles.note}>
              A server-wide cap on live connections returns <code>503</code> once hit. A client
              should fall back to <code>/poll</code> instead of looping reconnects. Delivery is
              best-effort once live. A slow subscriber can have messages dropped for it alone.
            </p>
          </section>

          <section id="grpc" className={styles.section}>
            <h2>gRPC</h2>
            <p><code>chat.Chat/SendMessage</code> is a second entry point for publishing, functionally identical to <code>POST /send</code>. The JWT travels in the message body, not metadata.</p>
            <CodeBlock label="proto/chat/chat.proto">{`service Chat {
  rpc SendMessage(SendMessageRequest) returns (SendMessageResponse);
}

message SendMessageRequest {
  string token   = 1; // JWT from /connect
  string content = 2;
}

message SendMessageResponse {
  string id = 1;
}`}</CodeBlock>
            <p className={styles.note}>
              No gRPC poll or streaming RPC exists yet. gRPC clients still need the HTTP
              <code> /poll</code> loop to receive messages. Server reflection is enabled, so
              <code> grpcurl</code>/<code>evans</code> work without the <code>.proto</code> file.
            </p>
          </section>

          <section id="tips" className={styles.section}>
            <h2>Client tips</h2>
            <ul className={styles.list}>
              <li><strong>Choosing a transport:</strong> use <code>/events</code> for an interactive client. Fall back to <code>/poll</code> on a <code>503</code>, a stream error, or an unplanned disconnect.</li>
              <li><strong>Polling loop:</strong> start at 1s, then follow <code>X-Next-Poll-Ms</code> exactly. The server already computed a backoff from room activity. Pause on <code>visibilitychange</code>.</li>
              <li><strong>Auth:</strong> persist the token durably. It never expires. On <code>401</code>, reconnect with <code>token</code>, not <code>username</code>.</li>
              <li><strong>Multi-instance:</strong> the buffer and SSE fan-out are per-process today. <code>/events</code> needs sticky sessions behind a load balancer.</li>
              <li>Don&apos;t build a WebSocket client. Don&apos;t parse <code>id</code> as a timestamp, even though it currently is one.</li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
