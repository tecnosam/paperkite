//go:build integration

package integration_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/paperkite/chat-service/internal/api"
	"github.com/paperkite/chat-service/internal/hub"
	"github.com/paperkite/chat-service/internal/metrics"
	"github.com/paperkite/chat-service/internal/sse"
	"github.com/paperkite/chat-service/internal/token"
	"github.com/paperkite/chat-service/internal/username"
)

const integrationSecret = "integration-test-secret-32-bytes!"

// startServer spins up an in-process HTTP server and returns its address.
// Each call gets its own in-memory (no persistence) username registry, so
// username claims never leak between tests.
func startServer(t *testing.T, h *hub.Hub) string {
	t.Helper()
	reg, err := username.New("")
	if err != nil {
		t.Fatalf("username.New: %v", err)
	}
	rec, err := metrics.NewRecorder("", "")
	if err != nil {
		t.Fatalf("metrics.NewRecorder: %v", err)
	}
	mux := http.NewServeMux()
	mux.Handle("POST /connect", api.ConnectHandler(h, reg, rec))
	mux.Handle("POST /send", api.SendHandler(h))
	mux.Handle("GET /poll", api.PollHandler(h))
	mux.Handle("GET /events", sse.Handler(h))

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: mux}
	go srv.Serve(lis) //nolint:errcheck
	t.Cleanup(func() { srv.Close() })
	return lis.Addr().String()
}

func doConnect(t *testing.T, addr, pageURL string) (tok string, cursor uint64) {
	t.Helper()
	return doConnectAs(t, addr, pageURL, "alice")
}

// doConnectAs is doConnect with an explicit username, for tests that need
// more than one distinct claimed identity against the same server.
func doConnectAs(t *testing.T, addr, pageURL, username string) (tok string, cursor uint64) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{
		"url": pageURL, "username": username, "browser": "Chrome/120",
		"session_id": "sess-" + username, "region": "us-east",
	})
	resp, err := http.Post("http://"+addr+"/connect", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /connect: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /connect: status %d", resp.StatusCode)
	}
	var cr struct {
		Token  string `json:"token"`
		Cursor uint64 `json:"cursor"`
	}
	json.NewDecoder(resp.Body).Decode(&cr)
	return cr.Token, cr.Cursor
}

func doSend(t *testing.T, addr, tok, content string) (statusCode int) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"content": content})
	req, _ := http.NewRequest("POST", "http://"+addr+"/send", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /send: %v", err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

// pollResult captures everything the client needs from a poll response.
type pollResult struct {
	StatusCode int
	Messages   []map[string]any
	Cursor     uint64
	NextPollMs int64
	ETag       string
}

func doPoll(t *testing.T, addr, tok string, cursor uint64) pollResult {
	t.Helper()
	req, _ := http.NewRequest("GET", fmt.Sprintf("http://%s/poll?cursor=%d", addr, cursor), nil)
	req.Header.Set("Authorization", "Bearer "+tok)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /poll: %v", err)
	}
	defer resp.Body.Close()

	pr := pollResult{
		StatusCode: resp.StatusCode,
		ETag:       resp.Header.Get("ETag"),
	}

	// X-Next-Poll-Ms is present on both 200 and 304.
	if s := resp.Header.Get("X-Next-Poll-Ms"); s != "" {
		pr.NextPollMs, _ = strconv.ParseInt(s, 10, 64)
	}

	// 304 has no body.
	if resp.StatusCode == http.StatusNotModified {
		return pr
	}

	var body struct {
		Messages   []map[string]any `json:"messages"`
		Cursor     uint64           `json:"cursor"`
		NextPollMs int64            `json:"next_poll_ms"`
	}
	json.NewDecoder(resp.Body).Decode(&body)
	pr.Messages = body.Messages
	pr.Cursor = body.Cursor
	if pr.NextPollMs == 0 {
		pr.NextPollMs = body.NextPollMs
	}
	return pr
}

// --- Core flow ---

func TestConnectSendPoll(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok, cursor := doConnect(t, addr, "https://example.com/chatroom/")

	if code := doSend(t, addr, tok, "hello"); code != http.StatusOK {
		t.Fatalf("send: status %d", code)
	}

	result := doPoll(t, addr, tok, cursor)
	if result.StatusCode != http.StatusOK {
		t.Fatalf("poll: expected 200, got %d", result.StatusCode)
	}
	if len(result.Messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(result.Messages))
	}
	if result.Messages[0]["content"] != "hello" {
		t.Errorf("content: got %v", result.Messages[0]["content"])
	}
	if result.Messages[0]["sender"] != "alice" {
		t.Errorf("sender: got %v", result.Messages[0]["sender"])
	}
	if result.Cursor <= cursor {
		t.Errorf("cursor should have advanced: %d → %d", cursor, result.Cursor)
	}
}

// --- 304 Not Modified ---

func TestPollReturns304WhenNothingNew(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok, cursor := doConnect(t, addr, "https://example.com/quiet/")
	result := doPoll(t, addr, tok, cursor)

	if result.StatusCode != http.StatusNotModified {
		t.Errorf("expected 304, got %d", result.StatusCode)
	}
}

func TestPollReturns200AfterMessageArrives(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok, cursor := doConnect(t, addr, "https://example.com/page/")
	doSend(t, addr, tok, "new message")

	result := doPoll(t, addr, tok, cursor)
	if result.StatusCode != http.StatusOK {
		t.Errorf("expected 200 after message, got %d", result.StatusCode)
	}
}

func TestPollETagPresent(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok, cursor := doConnect(t, addr, "https://example.com/")
	result := doPoll(t, addr, tok, cursor)

	if result.ETag == "" {
		t.Error("ETag header must be set on every poll response")
	}
}

func TestPollAdvancedCursorLeadsTo304(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok, cursor := doConnect(t, addr, "https://example.com/page/")
	doSend(t, addr, tok, "msg")

	first := doPoll(t, addr, tok, cursor)
	if first.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 on first poll, got %d", first.StatusCode)
	}

	// Second poll with advanced cursor — nothing new.
	second := doPoll(t, addr, tok, first.Cursor)
	if second.StatusCode != http.StatusNotModified {
		t.Errorf("expected 304 after cursor advance, got %d", second.StatusCode)
	}
}

// --- next_poll_ms hint ---

func TestNextPollMsInBodyOn200(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok, cursor := doConnect(t, addr, "https://example.com/")
	doSend(t, addr, tok, "hello")

	result := doPoll(t, addr, tok, cursor)
	if result.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", result.StatusCode)
	}
	if result.NextPollMs <= 0 {
		t.Errorf("next_poll_ms must be positive, got %d", result.NextPollMs)
	}
	if result.NextPollMs > 30_000 {
		t.Errorf("next_poll_ms must not exceed 30s, got %d", result.NextPollMs)
	}
}

func TestNextPollMsHeaderOn304(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok, cursor := doConnect(t, addr, "https://example.com/quiet/")
	result := doPoll(t, addr, tok, cursor)

	if result.StatusCode != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", result.StatusCode)
	}
	if result.NextPollMs <= 0 {
		t.Errorf("X-Next-Poll-Ms must be positive on 304, got %d", result.NextPollMs)
	}
}

func TestNextPollMsIsShortForActiveRoom(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok, cursor := doConnect(t, addr, "https://example.com/active/")
	doSend(t, addr, tok, "hello")

	result := doPoll(t, addr, tok, cursor)
	// Room had a message just now — hint should be 1s.
	if result.NextPollMs != 1_000 {
		t.Errorf("expected 1000ms hint for active room, got %d", result.NextPollMs)
	}
}

// --- Other ---

func TestCursorPreventsRedelivery(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok, cursor := doConnect(t, addr, "https://example.com/page/")
	doSend(t, addr, tok, "msg1")

	first := doPoll(t, addr, tok, cursor)
	second := doPoll(t, addr, tok, first.Cursor)
	if second.StatusCode != http.StatusNotModified {
		t.Errorf("expected 304 on re-poll, got %d", second.StatusCode)
	}
}

func TestRoomIsolation(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tokA, cursorA := doConnectAs(t, addr, "https://example.com/page-a/", "alice")
	tokB, cursorB := doConnectAs(t, addr, "https://example.com/page-b/", "bob")

	doSend(t, addr, tokA, "only for A")

	resA := doPoll(t, addr, tokA, cursorA)
	resB := doPoll(t, addr, tokB, cursorB)

	if len(resA.Messages) != 1 {
		t.Errorf("page-a: expected 1 message, got %d", len(resA.Messages))
	}
	if resB.StatusCode != http.StatusNotModified {
		t.Errorf("page-b: expected 304 (no messages), got %d", resB.StatusCode)
	}
}

func TestConnectCursorSkipsHistory(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	h := hub.New()
	addr := startServer(t, h)
	pageURL := "https://example.com/late-join/"

	h.Publish(hub.Message{
		ID: "pre", Room: token.RoomFromURL(pageURL),
		Sender: "system", Content: "pre-connect message", Timestamp: time.Now(),
	})

	tok, cursor := doConnect(t, addr, pageURL)
	doSend(t, addr, tok, "post-connect message")

	result := doPoll(t, addr, tok, cursor)
	if result.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", result.StatusCode)
	}
	if len(result.Messages) != 1 || result.Messages[0]["content"] != "post-connect message" {
		t.Errorf("should only see post-connect message, got: %v", result.Messages)
	}
}

func TestConnectMissingFields(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	body, _ := json.Marshal(map[string]string{"url": "https://example.com"})
	resp, err := http.Post("http://"+addr+"/connect", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

// --- Username claiming ---

func TestConnectRejectsAlreadyClaimedUsername(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	if _, _, code := tryConnectAs(t, addr, "https://example.com/", "alice", "sess-1"); code != http.StatusOK {
		t.Fatalf("first connect: expected 200, got %d", code)
	}
	if _, _, code := tryConnectAs(t, addr, "https://example.com/", "alice", "sess-2"); code != http.StatusConflict {
		t.Errorf("second connect with same username: expected 409, got %d", code)
	}
}

func TestConnectRejectsCaseInsensitiveVariantOfClaimedUsername(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	if _, _, code := tryConnectAs(t, addr, "https://example.com/", "Alice", "sess-1"); code != http.StatusOK {
		t.Fatalf("first connect: expected 200, got %d", code)
	}
	if _, _, code := tryConnectAs(t, addr, "https://example.com/", "ALICE", "sess-2"); code != http.StatusConflict {
		t.Errorf("differently-cased connect: expected 409, got %d", code)
	}
}

func TestConnectAllowsSameUsernameOnDifferentServers(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addrA := startServer(t, hub.New())
	addrB := startServer(t, hub.New())

	if _, _, code := tryConnectAs(t, addrA, "https://example.com/", "alice", "sess-1"); code != http.StatusOK {
		t.Fatalf("connect on server A: expected 200, got %d", code)
	}
	if _, _, code := tryConnectAs(t, addrB, "https://example.com/", "alice", "sess-1"); code != http.StatusOK {
		t.Errorf("connect on server B (independent registry): expected 200, got %d", code)
	}
}

// tryConnectAs issues /connect and returns the token, cursor, and status
// code without failing the test on a non-200, so callers can assert on
// rejection.
func tryConnectAs(t *testing.T, addr, pageURL, username, sessionID string) (tok string, cursor uint64, statusCode int) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{
		"url": pageURL, "username": username, "browser": "Chrome/120",
		"session_id": sessionID, "region": "us-east",
	})
	resp, err := http.Post("http://"+addr+"/connect", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /connect: %v", err)
	}
	defer resp.Body.Close()
	statusCode = resp.StatusCode
	if statusCode != http.StatusOK {
		return "", 0, statusCode
	}
	var cr struct {
		Token  string `json:"token"`
		Cursor uint64 `json:"cursor"`
	}
	json.NewDecoder(resp.Body).Decode(&cr)
	return cr.Token, cr.Cursor, statusCode
}

// --- Token-reuse connect ---

func TestConnectWithTokenReusesUsernameAcrossRooms(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok1, _, code := tryConnectAs(t, addr, "https://example.com/room-a/", "alice", "sess-1")
	if code != http.StatusOK {
		t.Fatalf("first connect: expected 200, got %d", code)
	}

	// Reconnecting to a *different* room with the same username via the
	// `username` field would now hit the global claim wall (409).
	// Presenting the token instead must succeed without re-claiming.
	tok2, _, code := tryConnectWithToken(t, addr, "https://example.com/room-b/", tok1, "sess-2")
	if code != http.StatusOK {
		t.Fatalf("token-reuse connect: expected 200, got %d", code)
	}

	claims, err := token.Verify(tok2)
	if err != nil {
		t.Fatalf("verify reissued token: %v", err)
	}
	if claims.Username != "alice" {
		t.Errorf("username: got %q want %q", claims.Username, "alice")
	}
	if claims.Room != token.RoomFromURL("https://example.com/room-b/") {
		t.Errorf("room: got %q want room derived from room-b's URL", claims.Room)
	}
	if claims.SessionID != "sess-2" {
		t.Errorf("session_id: got %q want %q", claims.SessionID, "sess-2")
	}
}

func TestConnectWithTokenIgnoresUsernameField(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok1, _, code := tryConnectAs(t, addr, "https://example.com/room-a/", "alice", "sess-1")
	if code != http.StatusOK {
		t.Fatalf("first connect: expected 200, got %d", code)
	}

	body, _ := json.Marshal(map[string]string{
		"url": "https://example.com/room-b/", "username": "someone-else",
		"token": tok1, "browser": "Chrome/120", "session_id": "sess-2", "region": "us-east",
	})
	resp, err := http.Post("http://"+addr+"/connect", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var cr struct {
		Token string `json:"token"`
	}
	json.NewDecoder(resp.Body).Decode(&cr)

	claims, err := token.Verify(cr.Token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Username != "alice" {
		t.Errorf("expected token's username to win over the body's username field, got %q", claims.Username)
	}
}

func TestConnectRejectsInvalidToken(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	_, _, code := tryConnectWithToken(t, addr, "https://example.com/", "not-a-real-token", "sess-1")
	if code != http.StatusUnauthorized {
		t.Errorf("expected 401 for garbage token, got %d", code)
	}
}

func TestConnectRejectsTokenForUnclaimedUsername(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	// A validly-signed token whose username was never actually run through
	// TryClaim (simulating a registry reset independent of the signing
	// secret) must still be rejected — IsClaimed is the defense here.
	ghostTok, err := token.Generate("https://example.com/", "ghost", "Chrome/120", "sess-1", "us-east")
	if err != nil {
		t.Fatalf("token.Generate: %v", err)
	}

	_, _, code := tryConnectWithToken(t, addr, "https://example.com/", ghostTok, "sess-2")
	if code != http.StatusUnauthorized {
		t.Errorf("expected 401 for a valid-but-unclaimed token, got %d", code)
	}
}

func TestConnectRequiresUsernameOrToken(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	body, _ := json.Marshal(map[string]string{
		"url": "https://example.com/", "browser": "Chrome/120",
		"session_id": "sess-1", "region": "us-east",
	})
	resp, err := http.Post("http://"+addr+"/connect", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

// tryConnectWithToken issues /connect with `token` instead of `username`,
// returning token/cursor/status the same way tryConnectAs does.
func tryConnectWithToken(t *testing.T, addr, pageURL, reuseToken, sessionID string) (tok string, cursor uint64, statusCode int) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{
		"url": pageURL, "token": reuseToken, "browser": "Chrome/120",
		"session_id": sessionID, "region": "us-east",
	})
	resp, err := http.Post("http://"+addr+"/connect", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /connect: %v", err)
	}
	defer resp.Body.Close()
	statusCode = resp.StatusCode
	if statusCode != http.StatusOK {
		return "", 0, statusCode
	}
	var cr struct {
		Token  string `json:"token"`
		Cursor uint64 `json:"cursor"`
	}
	json.NewDecoder(resp.Body).Decode(&cr)
	return cr.Token, cr.Cursor, statusCode
}
