# Chat Service Protocol

This document specifies the wire protocol exposed by `chat-service` and gives
practical guidance for client implementers. It reflects the code as it
currently stands — see file references throughout if you need the source of
truth.

## Overview

The service exposes two transports:

| Transport | Address        | Purpose                                   |
|-----------|----------------|--------------------------------------------|
| HTTP/JSON | `:8080`        | Primary client protocol (connect, send, poll) |
| gRPC      | `:50051`       | Alternative `SendMessage` RPC, same auth/semantics |

There is **no WebSocket**, but there are two ways to receive messages, both
built on the same underlying per-room buffer (`internal/hub`):

- **`GET /poll`** — short-interval HTTP long-polling, backed by a
  server-computed backoff hint so idle rooms don't get hammered. Works
  everywhere, including behind proxies that don't like long-lived
  connections.
- **`GET /events`** — a real Server-Sent Events stream (`internal/sse`) for
  instant delivery: messages arrive the moment they're published instead of
  on the next poll tick. This supersedes the old `internal/sse` — it used to
  be a retired empty stub; it's now a real, supported transport. See the
  `GET /events` section below for the full contract, and **Client Tips →
  Choosing a transport** for guidance on which to use.

Everything is stateless on the server aside from the in-memory per-room
buffer and, for `/events`, an in-memory set of currently-connected live
subscribers per room. There are no client sessions tracked server-side and
no server-side notion of "online" — a client's entire state is a JWT, a room
cursor (`seq`), and (if polling) a poll-interval hint.

Both `/poll` and `/events` also occasionally deliver **system messages** —
server-generated operational notices (currently just a restart warning)
from a reserved sender, indistinguishable in transport from a normal chat
message. See "System messages" below.

## Identity & Rooms

- A **room** is derived from a URL: `md5(strip_trailing_slashes(url))` (hex).
  See `token.RoomFromURL`. Two clients connecting with the same URL (modulo
  trailing slashes) land in the same room. There is no separate "create room"
  step.
- **Identity** (username, browser, session_id, region) is supplied by the
  client at connect time and baked into a signed JWT. The server trusts
  whatever the client asserts here — there is no separate auth provider,
  no password, no verification of any kind. `session_id` has no server-side
  meaning beyond being an opaque field on the token (the server does not
  rate-limit or otherwise key anything off it) — pick something stable per
  browser tab/session if you want it to mean anything to your own client
  code, but nothing server-side depends on that convention.
- **`username` is the one exception to "fully self-asserted."** The first
  time a username is successfully used in a `/connect` call, it becomes
  permanently claimed, server-wide, compared case-insensitively (`"Bob"` and
  `"bob"` are the same claim). There is no release/unclaim/expiry — a claim
  lasts for the lifetime of the server's data, survives restarts, and there
  is currently no way for a client to give a name back. A `/connect` call
  that asserts a `username` already claimed by anyone fails with `409` — see
  below. Everything else about identity (browser, session_id, region)
  remains fully self-asserted and unvalidated.
- **A client that already holds a token can skip the claim entirely.**
  `/connect` accepts an optional `token` field: present a previously-issued
  JWT instead of `username` and the server verifies it, reuses the identity
  it proves, and does **not** re-run the claim check — this is how the
  *same* already-claimed username can be used to join a second room, or get
  a fresh token for a new `session_id`, without hitting the `409` wall a
  second `username`-based `/connect` would now get. See `POST /connect`
  below for the exact contract.
- The JWT does **not expire** and is not centrally revoked. "Disconnecting"
  is a client-side decision (stop polling); the server has no notion of
  online/offline state.

## HTTP API

All request/response bodies are JSON. All authenticated endpoints require:

```
Authorization: Bearer <token>
```

### `POST /connect`

Establishes an identity and issues a JWT for the requested room. There are
two ways to supply that identity — mutually exclusive, `token` always wins
if both are present:

**1. Claim a new username** (first time you've ever used it, anywhere on
this server):
```json
{
  "url": "https://example.com/chat/room-1",
  "username": "alice",
  "browser": "Chrome/120",
  "session_id": "sess-abc123",
  "region": "us-east"
}
```

**2. Reuse an already-claimed identity** by presenting a token from a prior
`/connect` instead of `username`:
```json
{
  "url": "https://example.com/chat/room-2",
  "token": "eyJhbGciOi...",
  "browser": "Chrome/120",
  "session_id": "sess-abc123",
  "region": "us-east"
}
```
This verifies the token, reuses the username it proves, and — critically —
**does not run the username-claim check at all**, so it can't fail with
`409`. Use this to join a second room as the same user, or to mint a fresh
token for a new `session_id`/`browser`, without re-asserting `username` and
hitting the fact that it's already yours. `url`, `browser`, `session_id`,
and `region` in the body describe the *new* connection being made (which
may target a different room than the one the presented token was originally
issued for) — only the username carries over from the token; everything
else is taken fresh from this request, same as path 1.

`url`, `browser`, `session_id`, and `region` are required in both cases, and
exactly one of `username` / `token` must be present — if `token` is present
it is always used and `username` (even if also present in the body) is
silently ignored, never merged or validated against it.

Response `200`, same shape either way:
```json
{
  "token": "eyJhbGciOi...",
  "cursor": 42
}
```

- `token` — opaque JWT, pass as `Bearer` on every subsequent request.
- `cursor` — the room's current sequence number *at connect time*. Poll (or
  open `/events`) with this cursor first so you only receive messages
  published after you joined, not the whole buffered history.

Errors:
| Status | Cause |
|--------|-------|
| `400`  | missing `url`, `browser`, `session_id`, or `region`; missing both `username` and `token`; or invalid JSON |
| `401`  | `token` present but invalid/unverifiable, or valid but its username is no longer in the claims registry (see below) |
| `409`  | `username` path only: that username is already claimed (case-insensitive match), server-wide, permanently |
| `500`  | server-side failure claiming the username or generating the token |

`409`/`401` bodies are plain text (matching the shape of every other error in
this document — i.e. `http.Error`, not a JSON envelope), e.g.:
```
username already taken
```

**Claiming (path 1) is a real behavior change, not additive:** a `/connect`
call with a given `username` that succeeded once will now permanently fail
with `409` for every other `username`-based `/connect` that tries to use
that exact name or any differently-cased variant of it, on this server,
forever — including across restarts, since claims are persisted to disk
(see `internal/username`). There is no "your session already owns this
name" carve-out *for the `username` field specifically*: connecting again
with your own previously-claimed username via the `username` field (rather
than `token`) also gets `409`, because the claim check has no notion of who
is asking, only whether the name is taken. **This is exactly what `token`
reuse (path 2) is for** — if you still hold the token from your original
`/connect`, present that instead of `username` and you're back in,
`409`-free, for any room.

Why the `401` for a stale-but-validly-signed token: the server double-checks
that the token's username is *still* in the claims registry (not just that
the token's signature is valid) before trusting it. In normal operation this
can never fail — a token only exists because its username was claimed, and
claims are never released. It exists purely as a safety net against an
operational inconsistency (e.g. the claims file being reset without also
rotating `CHAT_JWT_SECRET`), so a client shouldn't need to handle it
specially beyond "a `401` here means get a new identity via `username`," but
it's included for completeness.

### `POST /send`

Publishes a message to the room encoded in the caller's token. Room and
sender are **never** taken from the request body — they come from the JWT, so
a client cannot spoof another user or post into a room it didn't connect to.

Request:
```json
{ "content": "hello" }
```

Response `200`:
```json
{ "id": "1733950000000000000" }
```
(`id` is a server-assigned string, currently `UnixNano` of send time — treat
it as an opaque unique string, not a parseable timestamp.)

Errors:
| Status | Cause |
|--------|-------|
| `401`  | missing/invalid/malformed bearer token |
| `400`  | empty `content` or invalid JSON |

**No rate limiting of any kind is enforced by this server** — not
per-session, not per-IP, nothing. This is intentional: `session_id` is
fully client-asserted (see Identity & Rooms above), so a server-side
per-session limit would only ever throttle well-behaved clients, never a
client deliberately evading it. Actual abuse mitigation is expected to live
entirely at the network edge (Cloudflare or nginx), keyed on IP, in front of
this service — see the comment above `buildHTTP` in `cmd/server/main.go`
for a starting-point Cloudflare rule. A client should be prepared to receive
and handle whatever the edge sends (commonly `429` with `Retry-After`), but
that response never originates from `chat-service` itself.

### `GET /poll?cursor={seq}`

Fetches messages published after `cursor`.

Response codes:
- **`304 Not Modified`** — no new messages. Empty body. `cursor` is still
  current.
- **`200 OK`** — one or more new messages, plus an advanced cursor.

Both response codes always set:
```
ETag: "<cursor>"
X-Next-Poll-Ms: <integer milliseconds>
```

`200` body:
```json
{
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
}
```
- `cursor` in the response is the **highest `seq` seen in this batch** — use
  it as the `cursor` query param on your next poll.
- `timestamp` is Unix **milliseconds**.
- `next_poll_ms` also appears as the `X-Next-Poll-Ms` header on every
  response (200 and 304 alike), so you can read it without a body.

**Stale cursor behavior**: the server buffers up to 256 messages per room for
up to 120s (`hub.MaxBufferSize`, `hub.BufferTTL`). If your cursor predates the
oldest buffered message (long client sleep, tab backgrounded past TTL, room
GC'd and recreated), the server returns the **entire available buffer**, not
an error. A client that sees `seq` jump by more than a handful should treat
the batch as partial history, not the full room history — anything older than
120s is simply gone.

### `GET /events?cursor={seq}`

Upgrades to a live `text/event-stream`: catches up on buffered history the
same way `/poll` would, then pushes every subsequently-published message the
instant it's published, no polling delay.

Same auth pattern as `/poll`: `Authorization: Bearer <token>` required, room
comes from the token, not a request param. The optional `cursor` query param
works identically to `/poll`'s — start the stream from `cursor: 0` returned
by `/connect` to get everything, or from a later saved cursor to resume.

Response `200`, headers:
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```
Body: a stream of SSE events. Each new message is one `data:` line (no
`event:` line — every event is implicitly a message) followed by a blank
line:
```
data: {"id":"1733950000000000000","seq":43,"room":"5d41402ab...","sender":"alice","content":"hello","timestamp":1733950000123}

```
The JSON payload is **field-for-field identical to one entry of `/poll`'s
`messages` array** — same keys, same `timestamp` unit (Unix milliseconds),
same opaque-`id` caveat. There is no wrapping `{"messages":[...],...}`
envelope and no `cursor`/`next_poll_ms` fields on the stream itself (there's
no next poll to schedule); track the highest `seq` you've seen yourself if
you need a cursor to resume from later (e.g. after a reconnect).

Periodically (every 25s) a comment line is sent to keep the connection alive
through proxies/load balancers that time out idle connections:
```
: heartbeat

```
Per the SSE spec, lines starting with `:` are comments — ignore them (any
standard `EventSource` client already does).

**Catch-up semantics mirror `/poll` exactly**, including the stale-cursor
case: messages with `seq > cursor` currently in the buffer are sent first,
in order; if `cursor` predates the buffer window (old cursor, long gap,
room recently GC'd and recreated), you get the **entire available buffer**,
same as a stale `/poll`. After catch-up, the stream switches to live push
with no gap and no duplicate delivery across the catch-up/live boundary.

Errors:
| Status | Cause |
|--------|-------|
| `401`  | missing/invalid/malformed bearer token |
| `400`  | `cursor` present but not a non-negative integer |
| `503`  | server-wide live-connection cap already at capacity (`internal/hub.MaxSSESubscribersTotal`) — try `/poll` instead, or retry later. There is no per-room cap: one popular room can hold the entire budget |

`503` body is plain text, same `http.Error` shape as the other errors in
this document:
```
too many live connections, try /poll instead
```

**Delivery is best-effort, not guaranteed, once live.** If a subscriber
falls behind (slow network, stalled client) its per-connection buffer can
fill up; once full, further messages are **dropped for that subscriber
only** rather than the server blocking the publisher, blocking other
subscribers, or buffering unboundedly. A client that cares about not
silently missing messages should track the highest `seq` it has seen and be
willing to reconcile via `/poll` (or a fresh `/events` reconnect with that
cursor) — the same discipline already recommended for handling `/poll`'s
stale-cursor case.

**Disconnection**: closing the connection (or the request context being
canceled, e.g. tab closed, network drop) immediately and deterministically
unregisters the subscription server-side — no explicit "unsubscribe" call is
needed or exposed. There is no reconnect/backoff logic built into the
server; if the stream drops, it's the client's job to decide whether to
reopen `/events` (with its last-seen `seq` as `cursor`) or fall back to
`/poll`.

### `GET /healthz`

Plain-text `200 ok`. No auth. Liveness only, not readiness.

## System messages

Some operational notices are delivered as ordinary messages from a
reserved sender, `"system"` — permanently blocked from ever being
claimed via `/connect` (see Identity & Rooms above), so no client can
pre-claim it and spoof one. They arrive through the exact same `/poll`
and `/events` delivery path as any other message; there is no separate
wire format or new endpoint. A client just needs to check
`sender == "system"` and, for those, treat `content` as JSON rather than
a human-readable chat line:

```json
{
  "event": "restart",
  "retry_after_ms": 5000,
  "message": "Hey, I'm gone now, but I'll be back in 5 seconds."
}
```

Currently the only `event` is `restart`: broadcast to every room right
before the server process exits for a deploy (SIGTERM from the ops
daemon, see `cmd/ops`), giving connected clients a moment's notice
before the connection drops. `retry_after_ms` is the server's own
estimate, not a guarantee — a client should still confirm liveness (e.g.
`GET /healthz`) before reconnecting rather than assuming the server is
back the instant that time elapses, and should back off with jitter on
top of it if it isn't, rather than have every disconnected client retry
in lockstep. See the Paperkite browser's `chatSession.ts` for a
reference implementation of the queue-and-backoff behavior this is meant
to enable.

`event` is intentionally open-ended — an unrecognized value should be
ignored, not treated as an error, so new system message types can be
added later without breaking existing clients.

## gRPC API

`chat.Chat/SendMessage` (`proto/chat/chat.proto`) is a second entry point for
publishing, functionally identical to `POST /send`:

```protobuf
service Chat {
  rpc SendMessage(SendMessageRequest) returns (SendMessageResponse);
}

message SendMessageRequest {
  string token   = 1; // JWT from /connect
  string content = 2;
}

message SendMessageResponse {
  string id = 1;
}
```

Notes:
- The JWT is passed **in the message body** (`token` field), not gRPC
  metadata/headers.
- There is currently **no gRPC poll or streaming RPC** — gRPC clients still
  need the HTTP `/poll` loop to receive messages. This RPC exists purely as
  an alternate write path (e.g. for server-side integrations that already
  speak gRPC).
- Same validation as `/send`: invalid token → `UNAUTHENTICATED`, empty
  content → `INVALID_ARGUMENT`. Not rate-limited server-side — same as
  `/send`, nothing in this service is; see `/send`'s notes above.
- Server reflection is enabled, so `grpcurl` / `evans` work without needing
  the `.proto` file locally.

## Client Tips

**Choosing a transport**
- `/events` (SSE) is the recommended default for an interactive client (like
  a browser tab someone's actively chatting in) — messages arrive instantly
  instead of on a poll delay, and it's no more work to consume than `/poll`
  (both return the same per-message JSON shape).
- `/poll` remains fully supported, is not being deprecated, and is the
  right choice for anything that can't or shouldn't hold a persistent
  connection open — background jobs, environments that don't support
  streaming responses well, or infrequent/best-effort readers where an
  open connection per client isn't worth the (small, but nonzero)
  server-side cost.
- **Even an `/events` client should be able to fall back to `/poll`.** The
  server enforces hard caps on concurrent live connections (`503` once hit,
  see `GET /events` above) and drops messages for subscribers that fall too
  far behind — neither of those exists for `/poll`. A robust client opens
  `/events` for the fast path, and on a `503`, a stream error, or an
  unexpected disconnect it hasn't chosen to reconnect from, falls back to
  polling with its last-seen cursor rather than looping reconnect attempts
  forever.
- You do not need both open at once in the common case — polling while also
  streaming the same room is redundant, not incorrect, just wasted requests.

**Polling loop**
- Start at 1s after `/connect`. After every poll response (200 *or* 304),
  read `X-Next-Poll-Ms` (or the JSON `next_poll_ms` on 200) and wait exactly
  that long before the next request — don't re-derive your own backoff
  curve, the server already computed one from room activity (1s → 5s → 20s →
  30s cap as the room goes quiet; resets to ~1s the moment someone posts).
- Pause polling entirely on `document.visibilitychange` (tab hidden); resume
  at 1s on focus. A backgrounded tab that keeps polling at 30s intervals will
  eventually hit a stale cursor anyway once it exceeds the 120s buffer TTL,
  so there's no correctness reason to keep going, only wasted requests.
- Always advance your stored cursor to the response's `cursor` field, even on
  a batch you consider a "stale/partial history" jump — there's no way to
  recover skipped messages, and re-polling with the old cursor just returns
  the same truncated buffer again.

**Auth**
- Cache the token from `/connect` for the lifetime of the tab/session. It
  doesn't expire, so there's no refresh flow to build.
- If you get a `401` on `/send` or `/poll`, the fix is to call `/connect`
  again — using `token` (not `username`) if you still have your old token,
  so you get a fresh token for the same identity rather than a `409` — not
  to retry the same token; tokens are only ever invalidated by rotating the
  signing secret server-side, which is rare but not impossible, so don't
  treat `401` as transient and retry-loop it.
- Persist the token from `/connect` somewhere durable (not just an in-memory
  variable) — e.g. `localStorage` for a browser client. If you lose it and
  re-`/connect` with `username` for a name you've already claimed, that's a
  `409` with no recovery except picking a new username; if you still have
  the token, `/connect` with `token` instead gets you a fresh one for the
  same identity, in any room, `409`-free, every time.

**Sending**
- `chat-service` itself will never `429` you on `/send` — it does no rate
  limiting. If you get a `429` (or a `503`, or a connection refused), that's
  the edge proxy in front of the service, not the application; handle it
  generically (back off using `Retry-After` if present) rather than assuming
  it means anything about your specific session or message rate.
- The message `id` returned by `/send` is not guaranteed to appear in your
  very next `/poll` if you poll before the publish is visible — treat send
  and poll as decoupled; don't block your UI on seeing your own message come
  back through poll before rendering it optimistically.

**Rooms**
- Room identity is purely the normalized URL. If your app renders chat on
  URLs that differ only by query string or hash, be aware those are
  **different rooms** (only trailing `/` is normalized away, per
  `token.RoomFromURL`) — normalize the URL yourself before calling `/connect`
  if you want query-string variants to share a room.
- There's no room "existence" check — connecting to a URL nobody has ever
  posted to just gives you `cursor: 0` and an empty poll stream. Don't treat
  an empty room as an error state.

**Multi-instance / at-least-once delivery**
- The buffer — and the `/events` live-subscriber fan-out — are both
  in-process per server instance today (no cross-instance fanout yet — see
  `TODO.md` for the planned MQTT-based approach). If the service is
  deployed behind a load balancer with multiple instances without sticky
  sessions, a client's poll requests, or its `/events` connection, can land
  on an instance that never received a given publish; a `POST /send` on
  instance A never reaches an `/events` stream connected to instance B.
  `/events` in particular *needs* a sticky session (or single-instance
  deployment) to be useful at all — an SSE connection is long-lived, so
  unlike polling it can't "get lucky" on a later request landing on the
  right instance. Don't assume single-instance delivery guarantees in
  production without confirming the deployment topology.
- Message delivery is at-least-once from the buffer's perspective (no
  dedup key beyond `id`); if you retry a poll after a network timeout without
  changing the cursor, you may see the same message twice. Dedup on `id` on
  the client if that matters to your UI.
- Username claims (`internal/username`) are local to whatever server
  instance's disk holds the claims file — they are **not** synced across
  instances behind a load balancer unless that file lives on shared storage.
  In an unsynced multi-instance deployment, the same username could be
  independently claimed on two different instances. Don't assume global
  uniqueness in that topology without confirming the claims file is shared.

**What not to build against**
- Don't implement a WebSocket client — there is no WebSocket transport and
  none planned. (SSE via `/events`, on the other hand, *is* real and
  supported — see above; the old advice to avoid `internal/sse` no longer
  applies now that it's a live endpoint rather than a stub.)
- Don't parse `id` as a timestamp even though it currently is
  `time.Now().UnixNano()` under the hood — it's documented as opaque and may
  change format.
