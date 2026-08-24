// Package sse implements the GET /events Server-Sent Events endpoint: a
// live, in-process push alternative to polling /poll. It reads from the
// same per-room buffer /poll does (internal/hub) and additionally
// subscribes to that room's live fan-out, so a connected client sees new
// messages the moment they're published instead of on the next poll tick.
package sse

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/paperkite/chat-service/internal/hub"
	"github.com/paperkite/chat-service/internal/token"
)

// heartbeatInterval is how often a comment line is sent to keep the
// connection alive through idle-timeout-happy proxies/load balancers.
const heartbeatInterval = 25 * time.Second

// event is the JSON shape written after each `data:` line — field-for-field
// identical to the per-message shape /poll returns, so client code can
// share one deserializer between the two transports.
type event struct {
	ID        string `json:"id"`
	Seq       uint64 `json:"seq"`
	Room      string `json:"room"`
	Sender    string `json:"sender"`
	Content   string `json:"content"`
	Timestamp int64  `json:"timestamp"` // Unix milliseconds
}

// Handler handles GET /events?cursor={seq}.
//
// Same auth pattern as /poll: Bearer JWT, room derived from the token (no
// client-supplied room param). On a valid connection the response upgrades
// to text/event-stream: it first replays any buffered messages with
// Seq > cursor (identical semantics to /poll, including the stale-cursor
// case — a cursor older than the buffer window gets the entire available
// buffer), then streams every subsequently-published message as it happens.
//
// Each message is one SSE event: a single `data: <json>` line followed by a
// blank line, where the JSON is the same per-message shape /poll returns.
// A `: heartbeat` comment line is sent periodically so idle connections
// aren't mistaken for dead ones by intermediaries.
//
// Rejects with 503 if the server-wide live-connection cap
// (hub.MaxSSESubscribersTotal) is already at capacity — there is no
// separate per-room cap. Delivery over this endpoint is best-effort: a
// subscriber that falls far behind has messages dropped for it (see
// hub.Publish) rather than the server buffering unboundedly or blocking
// other clients — /poll remains the authoritative way to recover a gap.
//
//	Authorization: Bearer <token>
//	GET /events?cursor=42
func Handler(h *hub.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := bearerToken(r)
		if tok == "" {
			http.Error(w, "Authorization: Bearer <token> required", http.StatusUnauthorized)
			return
		}
		claims, err := token.Verify(tok)
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		var cursor uint64
		if s := r.URL.Query().Get("cursor"); s != "" {
			cursor, err = strconv.ParseUint(s, 10, 64)
			if err != nil {
				http.Error(w, "cursor must be a non-negative integer", http.StatusBadRequest)
				return
			}
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		live, unsubscribe, ok := h.Subscribe(claims.Room)
		if !ok {
			http.Error(w, "too many live connections, try /poll instead", http.StatusServiceUnavailable)
			return
		}
		defer unsubscribe()

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no") // disable proxy buffering (e.g. nginx), if fronted by one
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		// Catch-up: identical semantics to /poll, including the stale-cursor
		// case (Poll returns the whole available buffer when cursor predates
		// it). lastSeq tracks the high-water mark so the live loop below can
		// dedup against anything already delivered here.
		lastSeq := cursor
		for _, m := range h.Poll(claims.Room, cursor) {
			writeEvent(w, m)
			if m.Seq > lastSeq {
				lastSeq = m.Seq
			}
		}
		flusher.Flush()

		heartbeat := time.NewTicker(heartbeatInterval)
		defer heartbeat.Stop()

		ctx := r.Context()
		for {
			select {
			case <-ctx.Done():
				// Client disconnected (or server is shutting down). unsubscribe
				// runs via defer above; nothing more to do.
				return
			case m, ok := <-live:
				if !ok {
					return
				}
				// Subscribe happens before the catch-up read above, so the
				// live channel can redeliver messages already sent during
				// catch-up (published in the gap between the two). Dedup by
				// Seq rather than risk missing one.
				if m.Seq <= lastSeq {
					continue
				}
				writeEvent(w, m)
				lastSeq = m.Seq
				flusher.Flush()
			case <-heartbeat.C:
				fmt.Fprint(w, ": heartbeat\n\n")
				flusher.Flush()
			}
		}
	}
}

func writeEvent(w http.ResponseWriter, m hub.Message) {
	b, err := json.Marshal(event{
		ID:        m.ID,
		Seq:       m.Seq,
		Room:      m.Room,
		Sender:    m.Sender,
		Content:   m.Content,
		Timestamp: m.Timestamp.UnixMilli(),
	})
	if err != nil {
		return
	}
	fmt.Fprintf(w, "data: %s\n\n", b)
}

func bearerToken(r *http.Request) string {
	after, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return ""
	}
	return strings.TrimSpace(after)
}
