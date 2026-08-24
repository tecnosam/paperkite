# TODO

## 1. Client-side exponential backoff

The server already returns `next_poll_ms` and `X-Next-Poll-Ms` on every response. The client must honour it.

**Behaviour**
- On connect, start polling at 1 s.
- After each response, wait exactly `next_poll_ms` before the next poll.
- On a 200 with messages, the hint resets to ~1 s automatically (server is activity-aware).
- On tab hidden (`document.visibilitychange`), pause polling entirely. Resume at 1 s on tab focus.

**Why it matters**
Most rooms will be quiet most of the time. At max backoff (30 s) a quiet room drops from 60 req/min to 2 req/min per user — roughly a 30× reduction in poll volume for the long tail.

---

## 6. Interest-based MQTT fanout

When running multiple server instances, each instance needs to receive messages published on other instances. MQTT provides the fanout layer. Instances should only subscribe to topics that have active pollers — not every room that has ever existed.

### Topic scheme: domain-based

Topics are the bare hostname of the page URL, with `www.` stripped and no trailing slashes.

```
https://www.example.com/chat/room-1  →  topic: example.com
https://news.ycombinator.com/item    →  topic: news.ycombinator.com
https://www.reddit.com/r/golang/     →  topic: reddit.com
```

Normalisation rule (mirrors `token.RoomFromURL`):
1. Parse the URL.
2. Take `host` (already strips path and scheme).
3. Strip a leading `www.` prefix if present.
4. Result is the MQTT topic string.

Filtering to the specific room still happens at the application layer (one map lookup against `claims.Room` / MD5 of full URL) after the broker delivers the message to the instance.

**Why domain-level, not per-room or single-topic**
- *Single topic*: every instance receives every message on the planet — fine for 5 servers, broadcast storm at 50+.
- *Per-room topics*: constant subscribe/unsubscribe churn across 100 k rooms per instance is expensive on the broker.
- *Domain topics*: the number of active domains is far smaller than active rooms, most topics stay low-volume, and filtering at the app layer is a single map lookup.

### Interest tracking (subscribe on demand)

With stateless polling there is no disconnect event, so track interest via TTL.

Add `lastPolled time.Time` to `roomState`, updated on every `/poll` hit. The existing GC goroutine (runs every `BufferTTL`) can drive subscriptions at the same time:

```
for each room:
    if now − lastPolled > 2 × max_hint (90 s):
        MQTT UNSUBSCRIBE <domain-topic>   // only if no other active room on same domain
        if buffer also empty:
            delete room from map          // existing GC logic
    else if domain topic not yet subscribed:
        MQTT SUBSCRIBE <domain-topic>
```

Each instance tracks a `subscribedDomains map[string]int` (domain → active room count). Subscribe when the count goes 0 → 1; unsubscribe when it goes 1 → 0. This collapses MQTT interest tracking and room GC into a single background pass.

**Broker options (self-funded)**
- EMQX free tier or self-hosted Mosquitto on a €4/mo VPS for MVP.
- Upgrade to EMQX Cloud or HiveMQ when broker becomes the bottleneck.
