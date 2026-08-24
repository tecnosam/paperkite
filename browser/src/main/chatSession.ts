/**
 * Owns the single active chat-service session - one live transport at a
 * time (SSE or, as a fallback, polling), for whatever the active tab's
 * room is (same architecture the old local-only chat had, see chatStore.ts
 * and main/index.ts's onActiveUrlChanged), so switching tabs, navigating,
 * or changing which server a tab uses all mean "tear down the old session,
 * start a new one" rather than juggling several concurrent connections.
 *
 * See ../../chat-service/PROTOCOL.md for the wire protocol this
 * implements the client side of via chatClient.ts. Key behaviors pulled
 * straight from its "Client Tips" section:
 *  - `/events` (SSE) is the protocol's recommended default transport for an
 *    interactive client - tried first on every connect. `/poll` is the
 *    fallback, used only once /events fails to open or drops (a 503 at the
 *    server's live-connection cap, an auth hiccup that isn't a clean 401,
 *    or any other stream error) - not retried in a loop, per the
 *    protocol's own "rather than looping reconnect attempts forever"
 *    guidance. See startEventStream()'s doc comment.
 *  - Poll delay always comes from the server's own next_poll_ms, never a
 *    self-derived backoff curve.
 *  - Always advance the stored cursor to the response's cursor, even on a
 *    batch that looks like a stale/partial-history jump - there's no way
 *    to recover skipped messages and re-polling with the old cursor just
 *    returns the same truncated buffer again. The same cursor is shared
 *    across both transports, so falling back from SSE to polling (or vice
 *    versa, on the next reconnect) resumes from exactly where the other
 *    left off - no replay, no gap.
 *  - `/connect` prefers reusing a cached `token` over asserting `username`
 *    fresh, whenever main/chatServerStore.ts has one - a `username` claim
 *    only ever succeeds once per server, ever, so every subsequent connect
 *    for an identity this app already holds (a second tab, a different
 *    room, a restart) MUST reuse the token or it 409s. See
 *    onTokenIssued/onTokenInvalid below and startSession's doc comment.
 *  - A 401 means reconnect (fresh token), never retry-loop the same one -
 *    except when the identity being reconnected WAS a cached token, where
 *    a same-token retry would just 401 again forever (see the 401-handling
 *    in pollOnce/startEventStream's onError).
 */
import * as chatClient from './chatClient';
import type { ChatServerMessage } from './chatClient';

const INITIAL_POLL_DELAY_MS = 1000;
/** After a genuine network/server error (not a 401) - the protocol has no
 * guidance here since it's not a documented error path, just "don't stop
 * polling forever over one hiccup." */
const ERROR_RETRY_DELAY_MS = 5000;
/** Caps how many messages this session accumulates in memory for replay
 * to a freshly-mounted chat renderer (see CHAT_READY in ipc.ts) - mirrors
 * the old chatStore.ts's per-room cap so a very long-lived session doesn't
 * grow unbounded. */
const MAX_BUFFERED_MESSAGES = 256;

/** Reserved sender for server-generated operational notices - see
 * PROTOCOL.md's "System messages" section. The server itself never lets
 * a real client claim this name (internal/username reserves it), so
 * seeing it here is always genuine. */
const SYSTEM_SENDER = 'system';
/** How long after a restart notice's own retryAfterMs to wait before the
 * *first* reconnect attempt, randomized per client - every session that
 * was connected when the server went down otherwise wakes up and hits
 * /healthz at the exact same instant, which is its own little thundering
 * herd against a server that's likely still warming up. */
const RESTART_INITIAL_JITTER_MS = 2000;
/** If the server isn't actually back up yet at the first reconnect
 * attempt, fall back to real exponential backoff (doubling, capped, with
 * jitter) for subsequent attempts - same reasoning, spread out over time
 * instead of every disconnected client retrying in lockstep. */
const RESTART_RETRY_BASE_MS = 1000;
const RESTART_RETRY_CAP_MS = 30_000;

export interface ChatSessionStatus {
  state: 'idle' | 'connecting' | 'connected' | 'error';
  url: string | null;
  error?: string;
  /** Set only when state is 'error' and it's specifically the server-side
   * username claim already being taken - see shared/types.ts's
   * ChatConnectionStatus (the same shape, re-exported to the renderer
   * as-is by ipc.ts). */
  reason?: 'username-taken';
}

export interface ChatSessionCallbacks {
  onStatusChanged: (status: ChatSessionStatus) => void;
  /** Fired with the FULL accumulated buffer (not just the new delta) each
   * time it changes - mirrors how the old chatStore-backed MESSAGES
   * broadcast always sent the whole room list, which the renderer's
   * stale-room guard already expects. */
  onMessages: (url: string, messages: ChatServerMessage[]) => void;
  /** Fired after every successful /connect (whether it asserted `username`
   * fresh or reused a cached `token`) with the token the server just
   * issued - the caller should persist it against this server (see
   * main/chatServerStore.ts's setChatServerToken) so the NEXT connect for
   * it - a second tab, a different room, this same server after an app
   * restart - can present `token` instead of re-asserting `username`,
   * which would otherwise 409 since it's already claimed. */
  onTokenIssued: (serverId: string, token: string) => void;
  /** Fired when a cached token this session was using turns out to be no
   * longer good (a 401, on /connect or later on /poll or /events) - the
   * caller should forget it (see clearChatServerToken) so the next connect
   * attempt for this server falls back to a fresh `username` claim rather
   * than retrying the same bad token forever. Per the protocol this is a
   * rare "operational inconsistency" (e.g. the server's claims registry
   * was reset without also rotating its signing secret), not expected in
   * normal operation - and even the fresh-claim fallback will itself 409
   * if the underlying claim is still intact server-side, since only the
   * token was lost, not the claim. There's no fully-automatic recovery
   * from that per PROTOCOL.md; this just stops the bad token from being
   * retried forever, it doesn't guarantee the next attempt succeeds. */
  onTokenInvalid: (serverId: string) => void;
}

let callbacks: ChatSessionCallbacks | null = null;
let generation = 0;
let pollTimer: NodeJS.Timeout | null = null;
/** Set while /events is the active transport; null whenever we're on the
 * polling fallback (or not connected at all). Mutually exclusive with
 * `pollTimer` being non-null - only one transport is ever live. */
let eventStream: chatClient.EventStream | null = null;
let token: string | null = null;
let cursor = 0;
let currentServerId: string | null = null;
let currentBaseUrl: string | null = null;
let currentIdentity: chatClient.ChatIdentity | null = null;
let buffered: ChatServerMessage[] = [];
/** Lets syncChatSession skip a needless reconnect when called again with
 * an unchanged (server, room, username) tuple - it's called from several
 * independent triggers (tab switch, nav, server override change, default
 * change, username set) any of which might fire without the effective
 * target actually changing. Keyed by server id (not baseUrl) so two
 * different configured servers that happen to share a baseUrl are never
 * treated as the same sync target. */
let lastSyncKey: string | null = null;
let lastStatus: ChatSessionStatus = { state: 'idle', url: null };
/** True while a poll request is actually in flight (as opposed to merely
 * scheduled) - lets sendChatMessage avoid firing a redundant concurrent
 * poll, which could double up messages in `buffered` (there's no de-dup
 * by id). See sendChatMessage's own doc comment for why this exists. */
let pollInFlight = false;
/** Outgoing messages held while a restart sequence is in progress (see
 * beginRestartSequence) - flushed by attemptRestartReconnect once the
 * server answers /healthz again. Deliberately NOT cleared by teardown()'s
 * generic reset; see beginRestartSequence/attemptRestartReconnect, which
 * never call teardown() themselves, for why it survives across a restart. */
let sendQueue: string[] = [];
/** Non-null exactly while this session is between a restart notice and a
 * successful reconnect - sendChatMessage checks this to decide whether to
 * queue instead of send. Cleared by teardown() (a real stop or a target
 * switch abandons any pending restart-recovery attempt) and by a
 * successful attemptRestartReconnect. */
let restartTimer: NodeJS.Timeout | null = null;
/** Number of failed post-restart /healthz probes so far this sequence -
 * drives backoffDelay()'s exponential growth. Reset to 0 whenever a new
 * restart sequence begins or a probe finally succeeds. */
let restartAttempt = 0;

export function initChatSession(cb: ChatSessionCallbacks): void {
  callbacks = cb;
}

function setStatus(status: ChatSessionStatus): void {
  lastStatus = status;
  callbacks?.onStatusChanged(status);
}

export function getLastStatus(): ChatSessionStatus {
  return lastStatus;
}

export function getBufferedMessages(): ChatServerMessage[] {
  return buffered;
}

function teardown(): void {
  generation++; // invalidates any in-flight connect/poll/stream from the old session
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (eventStream) {
    eventStream.close();
    eventStream = null;
  }
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  pollInFlight = false;
  token = null;
  cursor = 0;
  currentServerId = null;
  currentBaseUrl = null;
  currentIdentity = null;
  buffered = [];
  // A real stop, or switching to a different server/room, abandons
  // whatever this session still had queued for its *old* target - sending
  // it once reconnected would land in the wrong room, or nowhere at all.
  sendQueue = [];
  restartAttempt = 0;
}

export function stopChatSession(): void {
  if (lastSyncKey === null) return; // already idle - avoid a redundant status push
  teardown();
  lastSyncKey = null;
  setStatus({ state: 'idle', url: null });
}

/** The single entry point every trigger in main/index.ts calls through -
 * resolves to either "nothing to connect to" (stop) or "connect to this
 * exact target" (start, but only if it actually changed since last call). */
export function syncChatSession(server: { id: string; baseUrl: string } | null, identity: chatClient.ChatIdentity | null): void {
  if (!server || !identity) {
    stopChatSession();
    return;
  }
  const key = `${server.id}::${identity.url}::${identity.username}`;
  if (key === lastSyncKey) return;
  lastSyncKey = key;
  startSession(server.id, server.baseUrl, identity);
}

/** `identity.token`, if the caller (ipc.ts's resyncChatSession) found one
 * cached for this server, is what actually avoids the 409 - see
 * chatClient.connect()'s doc comment for the wire-level detail. This
 * function itself doesn't decide which path to use; it just reports
 * whatever token comes back (on success) so it stays cached for next time. */
function startSession(serverId: string, baseUrl: string, identity: chatClient.ChatIdentity): void {
  teardown();
  const myGeneration = generation;
  currentServerId = serverId;
  currentBaseUrl = baseUrl;
  currentIdentity = identity;
  setStatus({ state: 'connecting', url: identity.url });

  void chatClient
    .connect(baseUrl, identity)
    .then(({ token: newToken, cursor: startCursor }) => {
      if (myGeneration !== generation) return; // superseded by a newer sync
      token = newToken;
      cursor = startCursor;
      callbacks?.onTokenIssued(serverId, newToken);
      setStatus({ state: 'connected', url: identity.url });
      startEventStream(myGeneration, serverId, baseUrl, newToken, identity);
    })
    .catch((err: unknown) => {
      if (myGeneration !== generation) return;
      if (err instanceof chatClient.ChatAuthError && identity.token) {
        // The cached token itself was the thing rejected - forget it so
        // the next attempt (a fresh resync, not auto-retried here) claims
        // a new one instead of presenting the same bad token again.
        callbacks?.onTokenInvalid(serverId);
      }
      setStatus({
        state: 'error',
        url: identity.url,
        error: messageFor(err),
        reason: err instanceof chatClient.ChatUsernameTakenError ? 'username-taken' : undefined,
      });
    });
}

/** Tries the SSE fast path (per PROTOCOL.md's "Choosing a transport"
 * guidance: /events is the recommended default for an interactive client).
 * `onMessage` fires per-message rather than with a batch like polling does,
 * but still folds into the same `buffered` array and the same
 * onMessages(url, fullBuffer) callback shape the renderer already expects.
 *
 * `onError` fires at most once, whenever /events stops delivering for any
 * reason - never retried directly: a 401 either reconnects fresh (a
 * `username`-based identity, safe to redo as-is) or, if this session was
 * using a cached `token`, stops rather than looping (see the identical
 * reasoning in pollOnce's catch block). Anything else (503 at the
 * server's cap, a dropped connection, ...) falls back to polling from
 * wherever `cursor` currently sits. This deliberately doesn't loop
 * retrying /events itself, per the protocol's own advice not to loop
 * reconnect attempts forever - the next real resync (tab switch, nav,
 * server change, ...) is what gets it a fresh shot at /events again. */
function startEventStream(myGeneration: number, serverId: string, baseUrl: string, tok: string, identity: chatClient.ChatIdentity): void {
  eventStream = chatClient.openEventStream(baseUrl, tok, cursor, {
    onMessage: (message) => {
      if (myGeneration !== generation) return;
      cursor = Math.max(cursor, message.seq);
      ingestMessages(myGeneration, identity.url, [message]);
    },
    onError: (err) => {
      if (myGeneration !== generation) return;
      eventStream = null;
      if (err instanceof chatClient.ChatAuthError) {
        if (identity.token) {
          callbacks?.onTokenInvalid(serverId);
          setStatus({ state: 'error', url: identity.url, error: messageFor(err) });
          return;
        }
        startSession(serverId, baseUrl, identity);
        return;
      }
      console.info('[chat] /events unavailable, falling back to polling:', err instanceof Error ? err.message : err);
      schedulePoll(myGeneration, INITIAL_POLL_DELAY_MS);
    },
  });
}

/** Shape of a "system" sender's `content`, JSON-encoded - see
 * PROTOCOL.md's "System messages" section. `event` is intentionally
 * open-ended server-side; anything this client doesn't recognize is
 * ignored rather than treated as an error, so the server can add new
 * system message types later without breaking older clients. */
interface SystemNotice {
  event: string;
  retry_after_ms?: number;
  message?: string;
}

/** Splits incoming messages into "system" notices (handled here, never
 * shown as a chat bubble) and everything else (folded into `buffered` and
 * reported via onMessages, exactly as before this existed) - the single
 * chokepoint both startEventStream and pollOnce feed through, so neither
 * transport has to know about the system-message convention itself. */
function ingestMessages(myGeneration: number, url: string, messages: chatClient.ChatServerMessage[]): void {
  const visible: ChatServerMessage[] = [];
  for (const m of messages) {
    if (m.sender === SYSTEM_SENDER) {
      handleSystemMessage(myGeneration, m);
      continue;
    }
    visible.push(m);
  }
  if (visible.length > 0) {
    buffered = [...buffered, ...visible].slice(-MAX_BUFFERED_MESSAGES);
    callbacks?.onMessages(url, buffered);
  }
}

function handleSystemMessage(myGeneration: number, m: chatClient.ChatServerMessage): void {
  let notice: SystemNotice;
  try {
    notice = JSON.parse(m.content) as SystemNotice;
  } catch {
    return; // not a system message shape this client understands - ignore
  }
  if (notice.event !== 'restart') return; // forward-compatible with future event types
  beginRestartSequence(myGeneration, notice.retry_after_ms ?? RESTART_RETRY_BASE_MS);
}

/** The server just announced it's about to exit for a deploy (see
 * PROTOCOL.md's "System messages" section). Stops whatever transport is
 * currently active - no point letting /events error out on its own into
 * the outage, or /poll keep firing into it - without a full teardown()
 * (token/cursor/identity all stay valid; this is still the same session,
 * just paused). sendChatMessage() queues instead of sending for as long
 * as restartTimer is set. Idempotent: a second restart notice for a
 * sequence already in progress is a no-op, rather than resetting the
 * backoff clock. */
function beginRestartSequence(myGeneration: number, retryAfterMs: number): void {
  if (restartTimer) return;
  restartAttempt = 0;
  if (eventStream) {
    eventStream.close();
    eventStream = null;
  }
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  setStatus({ state: 'connecting', url: currentIdentity?.url ?? null });
  scheduleRestartRetry(myGeneration, retryAfterMs + randomJitter(RESTART_INITIAL_JITTER_MS));
}

function scheduleRestartRetry(myGeneration: number, delayMs: number): void {
  restartTimer = setTimeout(() => void attemptRestartReconnect(myGeneration), delayMs);
}

/** Probes /healthz; on success, resumes the live stream on the *existing*
 * token/cursor (the server restarting doesn't invalidate either - the
 * JWT is stateless and the username registry persists to disk across
 * the deploy) rather than a full re-/connect, and flushes anything
 * sendChatMessage queued in the meantime. On failure, backs off
 * exponentially with jitter and tries again - see this file's header
 * comment on RESTART_RETRY_BASE_MS/CAP_MS for why. */
async function attemptRestartReconnect(myGeneration: number): Promise<void> {
  restartTimer = null;
  if (myGeneration !== generation || !token || !currentBaseUrl || !currentIdentity || !currentServerId) {
    return; // superseded by a real teardown (new target, or a deliberate stop) in the meantime
  }

  const reachable = await chatClient.ping(currentBaseUrl).catch(() => false);
  if (!reachable) {
    restartAttempt += 1;
    scheduleRestartRetry(myGeneration, backoffDelay(restartAttempt));
    return;
  }

  restartAttempt = 0;
  setStatus({ state: 'connected', url: currentIdentity.url });
  startEventStream(myGeneration, currentServerId, currentBaseUrl, token, currentIdentity);
  flushSendQueue();
}

function flushSendQueue(): void {
  if (sendQueue.length === 0 || !token || !currentBaseUrl) return;
  const toSend = sendQueue;
  sendQueue = [];
  const baseUrl = currentBaseUrl;
  const tok = token;
  for (const content of toSend) {
    void chatClient.sendMessage(baseUrl, tok, content).catch((err: unknown) => {
      console.error('[chat] failed to send a message queued during a server restart:', err);
    });
  }
}

function randomJitter(maxMs: number): number {
  return Math.random() * maxMs;
}

/** Exponential backoff with jitter for retrying the post-restart /healthz
 * probe when the server isn't actually back up yet at the scheduled
 * retry time - doubles each attempt, capped, and randomized 50%-150% so
 * clients that all started waiting around the same original retry_after_ms
 * mark don't then all retry in lockstep either (the thundering-herd
 * mitigation this is for isn't just the *first* reconnect attempt). */
function backoffDelay(attempt: number): number {
  const exp = Math.min(RESTART_RETRY_CAP_MS, RESTART_RETRY_BASE_MS * 2 ** attempt);
  return exp * (0.5 + Math.random());
}

function schedulePoll(myGeneration: number, delayMs: number): void {
  pollTimer = setTimeout(() => void pollOnce(myGeneration), delayMs);
}

async function pollOnce(myGeneration: number): Promise<void> {
  if (myGeneration !== generation || !token || !currentBaseUrl || !currentIdentity || !currentServerId) return;
  pollInFlight = true;
  try {
    const result = await chatClient.poll(currentBaseUrl, token, cursor);
    if (myGeneration !== generation) return;
    // Always advance, even on what looks like a stale/partial-history
    // jump - see this file's own header comment.
    cursor = result.cursor;
    if (result.messages.length > 0) {
      ingestMessages(myGeneration, currentIdentity.url, result.messages);
    }
    schedulePoll(myGeneration, result.nextPollMs);
  } catch (err) {
    if (myGeneration !== generation) return;
    if (err instanceof chatClient.ChatAuthError && currentBaseUrl && currentIdentity && currentServerId) {
      if (currentIdentity.token) {
        // A same-token retry would just 401 again - stop rather than loop
        // (see onTokenInvalid's own doc comment for why a blind fallback
        // to `username` isn't attempted automatically either).
        callbacks?.onTokenInvalid(currentServerId);
        setStatus({ state: 'error', url: currentIdentity.url, error: messageFor(err) });
        return;
      }
      // Per the protocol: a 401 means reconnect for a fresh claim, not
      // retry the same one - safe to redo as-is here, since this path
      // only reaches a `username`-based identity, which re-derives cleanly.
      startSession(currentServerId, currentBaseUrl, currentIdentity);
      return;
    }
    setStatus({ state: 'error', url: currentIdentity.url, error: messageFor(err) });
    // Keep trying - a network hiccup shouldn't permanently kill the
    // session, only a deliberate syncChatSession(null, ...) should.
    schedulePoll(myGeneration, ERROR_RETRY_DELAY_MS);
  } finally {
    pollInFlight = false;
  }
}

export async function sendChatMessage(content: string): Promise<{ id: string }> {
  if (restartTimer) {
    // Server is mid-restart (see beginRestartSequence) - queue instead of
    // failing outright; flushed by attemptRestartReconnect once it's
    // back. Nothing currently reads the resolved id here (see ipc.ts's
    // SEND_MESSAGE handler, which only checks for rejection), so a
    // placeholder is safe.
    sendQueue.push(content);
    return { id: 'queued' };
  }
  if (!token || !currentBaseUrl) throw new Error('Not connected to a chat server.');
  const result = await chatClient.sendMessage(currentBaseUrl, token, content);
  // The room's poll interval backs off up to 30s while idle (per the
  // protocol) - a send that lands mid-backoff shouldn't make the user wait
  // that out just to see their own message reappear. Skipped if a poll's
  // already in flight (rather than merely scheduled): that one will land
  // and reschedule on its own shortly, and firing a second concurrent poll
  // could double up messages in `buffered`, which has no de-dup by id.
  if (!pollInFlight && pollTimer) {
    clearTimeout(pollTimer);
    schedulePoll(generation, INITIAL_POLL_DELAY_MS);
  }
  return result;
}

function messageFor(err: unknown): string {
  if (err instanceof chatClient.ChatRateLimitError) return `Sending too fast - try again in ${err.retryAfterSeconds}s.`;
  if (err instanceof chatClient.ChatAuthError) return 'Chat server rejected this session.';
  // Permanent, not transient - retrying this exact /connect can never
  // succeed (see ChatUsernameTakenError's own doc comment), so the message
  // points straight at the actual fix rather than reading like a hiccup.
  if (err instanceof chatClient.ChatUsernameTakenError) {
    return `Username "${err.username}" is already taken on this server - change it in Settings → Chat Servers.`;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong connecting to the chat server.';
}
