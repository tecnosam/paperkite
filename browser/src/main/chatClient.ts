/**
 * HTTP client for the external chat-service (see ../../chat-service/PROTOCOL.md
 * in this workspace - Paperkite is a CLIENT of that service, never the
 * service itself). Implements the endpoints a client needs: POST /connect,
 * POST /send, GET /poll, and GET /events (Server-Sent Events - the
 * protocol's recommended default transport for an interactive client like
 * this one; /poll is kept as chatSession.ts's fallback for when /events
 * isn't available, per the protocol's own "Choosing a transport" guidance).
 * No WebSocket client - the protocol doesn't have one.
 *
 * Plain `fetch` (built into Electron's Node runtime) - no HTTP dependency
 * needed for endpoints this simple, and Node's fetch Response.body is a
 * standard WHATWG ReadableStream, which is all /events needs to consume.
 */

const REQUEST_TIMEOUT_MS = 10_000;

export interface ChatIdentity {
  url: string;
  /** Always set, even when `token` is also present - `token` is only an
   * optimization for the /connect call itself (see connect()'s doc
   * comment); everywhere else in this app still needs to know the
   * identity's actual username (display, the isOwn check, dedup keys). */
  username: string;
  browser: string;
  session_id: string;
  region: string;
  /** A previously-issued JWT for this exact username, if this app has one
   * cached (see main/chatServerStore.ts's per-server token) - lets
   * connect() use PROTOCOL.md's "reuse an already-claimed identity" path
   * instead of asserting `username` fresh, which would 409 since the name
   * is already claimed (by this same app, from an earlier tab/session/
   * restart). Omitted for a server's very first connect, before any
   * token's been issued yet. */
  token?: string;
}

/** The wire shape from GET /poll, distinct from the app's own ChatMessage -
 * `sender`/`content` map to `username`/`text` in main/chatSession.ts, which
 * is the only place that translation happens. */
export interface ChatServerMessage {
  id: string;
  seq: number;
  room: string;
  sender: string;
  content: string;
  timestamp: number;
}

/** A 401 means the token itself is bad - per the protocol's own guidance,
 * "the fix is to call /connect again (new token), not to retry the same
 * token" - never a transient condition worth retry-looping. */
export class ChatAuthError extends Error {
  constructor() {
    super('chat-service rejected this token (401)');
  }
}

/** A 429 on /send - back off using the server's own Retry-After (seconds,
 * "currently a flat 60"), not a self-derived backoff. */
export class ChatRateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`chat-service rate limit exceeded - retry after ${retryAfterSeconds}s`);
  }
}

/** A 503 on /events - the server's live-connection cap (per-room or
 * server-wide) is already at capacity. Per the protocol: "try /poll
 * instead, or retry later" - not worth looping /events reconnect attempts
 * over, chatSession.ts falls back to polling instead. */
export class ChatCapacityError extends Error {
  constructor() {
    super('chat-service live-connection cap reached (503)');
  }
}

/** A 409 on /connect - the requested username is already claimed,
 * server-wide, permanently (case-insensitively) - see PROTOCOL.md's
 * Identity & Rooms section. Only possible on the `username` (claim) path;
 * the `token` (reuse) path never runs the claim check and so can never
 * 409. Unlike every other error here, retrying the exact same /connect
 * can never succeed; the only fix is a different username. */
export class ChatUsernameTakenError extends Error {
  constructor(public username: string) {
    super(`chat-service rejected username "${username}" - already taken (409)`);
  }
}

function withTimeout(): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/**
 * Two mutually-exclusive request shapes per PROTOCOL.md's /connect section:
 * present `token` to reuse an already-claimed identity (never runs the
 * claim check, so never 409s), or `username` to claim fresh (first time
 * ever using that name on this server). `token`, when present, always
 * wins server-side - `username` would be silently ignored even if also
 * sent - so this only ever sends one or the other, never both.
 */
export async function connect(baseUrl: string, identity: ChatIdentity): Promise<{ token: string; cursor: number }> {
  const { signal, cancel } = withTimeout();
  const { url, browser, session_id, region } = identity;
  const body = identity.token ? { token: identity.token, url, browser, session_id, region } : { username: identity.username, url, browser, session_id, region };
  try {
    const res = await fetch(`${baseUrl}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    // 401 here means the presented token is invalid, or valid-but-its-
    // username-somehow-no-longer-claimed (see PROTOCOL.md - a safety net
    // for an operational inconsistency, not expected in normal operation).
    // Only possible on the token path; reuse the same ChatAuthError poll/
    // events already use for "this session is no longer good."
    if (res.status === 401) throw new ChatAuthError();
    if (res.status === 409) throw new ChatUsernameTakenError(identity.username);
    if (!res.ok) throw new Error(`/connect failed (${res.status})`);
    return (await res.json()) as { token: string; cursor: number };
  } finally {
    cancel();
  }
}

export async function sendMessage(baseUrl: string, token: string, content: string): Promise<{ id: string }> {
  const { signal, cancel } = withTimeout();
  try {
    const res = await fetch(`${baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content }),
      signal,
    });
    if (res.status === 401) throw new ChatAuthError();
    if (res.status === 429) {
      const retryAfterSeconds = Number(res.headers.get('Retry-After')) || 60;
      throw new ChatRateLimitError(retryAfterSeconds);
    }
    if (!res.ok) throw new Error(`/send failed (${res.status})`);
    return (await res.json()) as { id: string };
  } finally {
    cancel();
  }
}

export interface PollResult {
  messages: ChatServerMessage[];
  cursor: number;
  nextPollMs: number;
}

/** 304 (no new messages) and 200 (new messages) both resolve here - the
 * caller doesn't need to distinguish them, just act on whatever `messages`
 * contains (possibly empty) and reschedule using `nextPollMs`. */
export async function poll(baseUrl: string, token: string, cursor: number): Promise<PollResult> {
  const { signal, cancel } = withTimeout();
  try {
    const res = await fetch(`${baseUrl}/poll?cursor=${cursor}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    // Both response codes set this - read it before branching so a 304
    // still gets the server's backoff hint.
    const headerNextPollMs = Number(res.headers.get('X-Next-Poll-Ms')) || 1000;

    if (res.status === 304) return { messages: [], cursor, nextPollMs: headerNextPollMs };
    if (res.status === 401) throw new ChatAuthError();
    if (!res.ok) throw new Error(`/poll failed (${res.status})`);

    const data = (await res.json()) as { messages: ChatServerMessage[]; cursor: number; next_poll_ms: number };
    return { messages: data.messages, cursor: data.cursor, nextPollMs: data.next_poll_ms || headerNextPollMs };
  } finally {
    cancel();
  }
}

/** Cheap liveness probe against GET /healthz - unauthenticated, plain
 * "ok" text response per PROTOCOL.md. Used by chatSession.ts to check
 * whether a server that announced an imminent restart (see the "system"
 * sender convention in PROTOCOL.md's "System messages" section) has
 * actually come back up yet, before attempting a real reconnect. */
export async function ping(baseUrl: string): Promise<boolean> {
  const { signal, cancel } = withTimeout();
  try {
    const res = await fetch(`${baseUrl}/healthz`, { signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    cancel();
  }
}

export interface EventStreamHandlers {
  /** Fired once per message, in order - both for the initial catch-up
   * batch (same buffered history /poll would return) and every
   * subsequently-published message, indistinguishably; the protocol
   * guarantees no gap and no duplicate delivery across that boundary. */
  onMessage: (message: ChatServerMessage) => void;
  /** Fired at most once, whenever the stream stops for any reason - a
   * 401/503 before it even opened, a mid-stream error, or the connection
   * just closing unexpectedly. Never fired for a deliberate close() call.
   * chatSession.ts is the only caller and always treats this as "stop
   * trying /events for this session, fall back to /poll" - see its own
   * doc comment on why this file doesn't retry /events itself. */
  onError: (err: unknown) => void;
}

export interface EventStream {
  close: () => void;
}

/** No `withTimeout()` here on purpose - unlike the other endpoints this is
 * meant to stay open indefinitely; the server's own 25s heartbeat comments
 * are what keep it alive through proxies, not a client-side timeout. */
export function openEventStream(baseUrl: string, token: string, cursor: number, handlers: EventStreamHandlers): EventStream {
  const controller = new AbortController();
  let errored = false;
  const reportError = (err: unknown) => {
    if (errored || controller.signal.aborted) return; // aborted = deliberate close(), not a failure
    errored = true;
    handlers.onError(err);
  };

  void (async () => {
    try {
      const res = await fetch(`${baseUrl}/events?cursor=${cursor}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (res.status === 401) throw new ChatAuthError();
      if (res.status === 503) throw new ChatCapacityError();
      if (!res.ok || !res.body) throw new Error(`/events failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line - a frame may still be
        // arriving mid-chunk, so only consume complete ones and leave the
        // rest in `buffer` for the next read.
        let frameEnd: number;
        while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          if (frame.startsWith(':')) continue; // heartbeat comment - ignore, per SSE spec
          const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          try {
            handlers.onMessage(JSON.parse(dataLine.slice(5).trim()) as ChatServerMessage);
          } catch {
            // Malformed frame - skip it rather than tearing down the whole
            // stream over one bad message.
          }
        }
      }
      // The server closed the stream cleanly (no error status) - still
      // means /events is no longer delivering, so this is reported the
      // same as any other stop condition.
      reportError(new Error('/events stream ended'));
    } catch (err) {
      reportError(err);
    }
  })();

  return { close: () => controller.abort() };
}
