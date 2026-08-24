package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/paperkite/chat-service/internal/hub"
	"github.com/paperkite/chat-service/internal/metrics"
	"github.com/paperkite/chat-service/internal/token"
	"github.com/paperkite/chat-service/internal/username"
)

type connectRequest struct {
	URL       string `json:"url"`
	Username  string `json:"username"`
	Browser   string `json:"browser"`
	SessionID string `json:"session_id"`
	Region    string `json:"region"`
	Token     string `json:"token"` // optional: reuse an already-claimed identity, see ConnectHandler
}

type connectResponse struct {
	Token  string `json:"token"`
	Cursor uint64 `json:"cursor"`
}

type sendRequest struct {
	Content string `json:"content"`
}

type sendResponse struct {
	ID string `json:"id"`
}

type pollMessage struct {
	ID        string `json:"id"`
	Seq       uint64 `json:"seq"`
	Room      string `json:"room"`
	Sender    string `json:"sender"`
	Content   string `json:"content"`
	Timestamp int64  `json:"timestamp"` // Unix milliseconds
}

type pollResponse struct {
	Messages   []pollMessage `json:"messages"`
	Cursor     uint64        `json:"cursor"`
	NextPollMs int64         `json:"next_poll_ms"`
}

// ConnectHandler handles POST /connect.
//
// Establishes an identity for the caller — either by claiming a new
// username (permanently, server-wide, case-insensitively — see
// internal/username) or, if an already-issued token is presented, by
// reusing the identity that token proves without re-claiming anything —
// then issues a signed JWT for the requested room and returns the room's
// current sequence number as the starting cursor.
//
// Request body (JSON), claiming a new username:
//
//	{"url":"https://…","username":"…","browser":"…","session_id":"…","region":"…"}
//
// Request body (JSON), reusing an already-claimed identity — e.g. to join a
// second room, or to get a fresh token for a new session_id, without
// hitting the "username already taken" wall a second /connect with
// `username` would now get:
//
//	{"url":"https://…","token":"eyJ…","browser":"…","session_id":"…","region":"…"}
//
// When `token` is present it always wins: it is verified, its embedded
// username is used, and `username` in the body (if any) is ignored — a
// malformed or unverifiable `token` is a hard 401, never a silent
// fall-through to claiming `username` instead. `url`, `browser`,
// `session_id`, and `region` are still required either way; they describe
// the *new* connection (which may be a different room, browser, or session
// than the one the reused token was originally issued for) — only the
// username carries over.
//
// Response (JSON):
//
//	{"token":"eyJ…","cursor":42}
//
// Errors: missing required fields → 400; `username` already claimed by a
// prior /connect (permanent, no release path) → 409; `token` present but
// invalid, or valid but its username is no longer in the registry (e.g. the
// claims file was reset independently of the signing secret) → 401.
func ConnectHandler(h *hub.Hub, reg *username.Registry, rec *metrics.Recorder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req connectRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if req.URL == "" || req.Browser == "" || req.SessionID == "" || req.Region == "" {
			http.Error(w, "url, browser, session_id, and region are required", http.StatusBadRequest)
			return
		}
		if req.Token == "" && req.Username == "" {
			http.Error(w, "username is required unless token is provided", http.StatusBadRequest)
			return
		}

		var identity string
		if req.Token != "" {
			claims, err := token.Verify(req.Token)
			if err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}
			if !reg.IsClaimed(claims.Username) {
				http.Error(w, "token's username is no longer claimed on this server", http.StatusUnauthorized)
				return
			}
			identity = claims.Username
		} else {
			claimed, err := reg.TryClaim(req.Username)
			if err != nil {
				http.Error(w, "could not claim username", http.StatusInternalServerError)
				return
			}
			if !claimed {
				http.Error(w, "username already taken", http.StatusConflict)
				return
			}
			identity = req.Username
			rec.AddUser(identity) // a genuinely new claim, not a token-reuse reconnect
		}

		roomID := token.RoomFromURL(req.URL)
		rec.AddRoom(roomID) // every connect touches a room, new or not - see AddRoom's doc comment

		tok, err := token.Generate(req.URL, identity, req.Browser, req.SessionID, req.Region)
		if err != nil {
			http.Error(w, "could not generate token", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(connectResponse{
			Token:  tok,
			Cursor: h.Seq(roomID),
		})
	}
}

// SendHandler handles POST /send.
//
// Verifies the JWT, then publishes the message. Room and sender come from
// the token — callers cannot spoof either.
//
// Rate limiting is not enforced by this server at all; it's expected to be
// handled entirely at the network edge (Cloudflare or nginx). See the
// comment above buildHTTP in cmd/server/main.go for recommended edge config.
//
//	Authorization: Bearer <token>
//	{"content":"…"}  →  200 {"id":"…"}
func SendHandler(h *hub.Hub) http.HandlerFunc {
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

		var req sendRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if req.Content == "" {
			http.Error(w, "content is required", http.StatusBadRequest)
			return
		}

		msg := hub.Message{
			ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
			Room:      claims.Room,
			Sender:    claims.Username,
			Content:   req.Content,
			Timestamp: time.Now(),
		}
		h.Publish(msg)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sendResponse{ID: msg.ID})
	}
}

// PollHandler handles GET /poll?cursor={seq}.
//
// Verifies the JWT then returns room messages with Seq > cursor.
//
// Response codes:
//
//	304 Not Modified — no new messages; cursor is current. Check X-Next-Poll-Ms.
//	200 OK          — new messages in body; cursor has advanced.
//
// Both responses carry X-Next-Poll-Ms (milliseconds) and ETag (cursor value)
// as headers. Clients should always read X-Next-Poll-Ms to drive backoff.
//
// Stale cursor: if cursor predates the buffer window, the full available
// buffer is returned. Treat a large seq jump as partial history.
//
//	Authorization: Bearer <token>
//	GET /poll?cursor=42
func PollHandler(h *hub.Hub) http.HandlerFunc {
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

		msgs := h.Poll(claims.Room, cursor)
		nextMs := h.NextPollMs(claims.Room)

		// Always set these headers so the client can read them on both 304 and 200.
		w.Header().Set("X-Next-Poll-Ms", strconv.FormatInt(nextMs, 10))
		w.Header().Set("ETag", fmt.Sprintf(`"%d"`, cursor))

		if len(msgs) == 0 {
			w.WriteHeader(http.StatusNotModified)
			return
		}

		resp := pollResponse{
			Messages:   make([]pollMessage, 0, len(msgs)),
			Cursor:     cursor,
			NextPollMs: nextMs,
		}
		for _, m := range msgs {
			resp.Messages = append(resp.Messages, pollMessage{
				ID:        m.ID,
				Seq:       m.Seq,
				Room:      m.Room,
				Sender:    m.Sender,
				Content:   m.Content,
				Timestamp: m.Timestamp.UnixMilli(),
			})
			if m.Seq > resp.Cursor {
				resp.Cursor = m.Seq
			}
		}
		// Update ETag to reflect the advanced cursor.
		w.Header().Set("ETag", fmt.Sprintf(`"%d"`, resp.Cursor))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

// MetricsHandler handles GET /custom-metrics.
//
// Unauthenticated, like /healthz - these are approximate, non-sensitive
// aggregate counts, meant to be trivially fetchable by the public status
// page (see website/src/lib/status.ts).
//
// Response (JSON):
//
//	200 {"unique_rooms":42,"unique_users":137}
//
// Both counts are HyperLogLog cardinality estimates (~0.2% standard
// error at this build's fixed precision - see internal/hll), not exact
// counts. unique_rooms in particular counts every room ever seen by a
// /connect call, including ones since garbage-collected out of the live
// hub.Hub (see hub.Hub.GC) - it is a different, larger-or-equal number
// than "rooms active right now".
func MetricsHandler(rec *metrics.Recorder) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rec.Snapshot())
	}
}

func bearerToken(r *http.Request) string {
	after, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return ""
	}
	return strings.TrimSpace(after)
}
