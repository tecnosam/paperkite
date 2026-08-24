package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/paperkite/chat-service/internal/api"
	"github.com/paperkite/chat-service/internal/hub"
	"github.com/paperkite/chat-service/internal/metrics"
	"github.com/paperkite/chat-service/internal/username"
)

const testSecret = "handler-test-secret-32-bytes-long!!"

func newTestHandler(t *testing.T) (http.Handler, *metrics.Recorder) {
	t.Helper()
	t.Setenv("CHAT_JWT_SECRET", testSecret)

	h := hub.New()
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
	mux.Handle("GET /custom-metrics", api.MetricsHandler(rec))
	return mux, rec
}

func connect(t *testing.T, mux http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/connect", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w
}

func TestConnectHandler_NewClaimRecordsOneRoomAndOneUser(t *testing.T) {
	mux, rec := newTestHandler(t)

	w := connect(t, mux, `{"url":"https://example.com/a","username":"alice","browser":"chrome","session_id":"s1","region":"us"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}

	snap := rec.Snapshot()
	if snap.UniqueRooms != 1 {
		t.Errorf("UniqueRooms = %d, want 1", snap.UniqueRooms)
	}
	if snap.UniqueUsers != 1 {
		t.Errorf("UniqueUsers = %d, want 1", snap.UniqueUsers)
	}
}

func TestConnectHandler_RepeatedConnectsToSameRoomDoNotInflateRoomCount(t *testing.T) {
	mux, rec := newTestHandler(t)

	connect(t, mux, `{"url":"https://example.com/a","username":"alice","browser":"chrome","session_id":"s1","region":"us"}`)
	connect(t, mux, `{"url":"https://example.com/a","username":"bob","browser":"chrome","session_id":"s2","region":"us"}`)
	connect(t, mux, `{"url":"https://example.com/a","username":"carol","browser":"chrome","session_id":"s3","region":"us"}`)

	snap := rec.Snapshot()
	if snap.UniqueRooms != 1 {
		t.Errorf("UniqueRooms = %d, want 1 (same URL every time)", snap.UniqueRooms)
	}
	if snap.UniqueUsers != 3 {
		t.Errorf("UniqueUsers = %d, want 3 (three distinct new claims)", snap.UniqueUsers)
	}
}

func TestConnectHandler_TokenReuseRecordsRoomButNotAnotherUser(t *testing.T) {
	mux, rec := newTestHandler(t)

	first := connect(t, mux, `{"url":"https://example.com/a","username":"alice","browser":"chrome","session_id":"s1","region":"us"}`)
	if first.Code != http.StatusOK {
		t.Fatalf("first connect status = %d, body = %s", first.Code, first.Body.String())
	}
	var resp struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode first response: %v", err)
	}

	// Reconnect with the token, to a *different* room - a new room, but not
	// a new user (see ConnectHandler's doc comment on token reuse).
	second := connect(t, mux, `{"url":"https://example.com/b","token":"`+resp.Token+`","browser":"chrome","session_id":"s2","region":"us"}`)
	if second.Code != http.StatusOK {
		t.Fatalf("second connect status = %d, body = %s", second.Code, second.Body.String())
	}

	snap := rec.Snapshot()
	if snap.UniqueRooms != 2 {
		t.Errorf("UniqueRooms = %d, want 2", snap.UniqueRooms)
	}
	if snap.UniqueUsers != 1 {
		t.Errorf("UniqueUsers = %d, want 1 (token reuse is not a new claim)", snap.UniqueUsers)
	}
}

func TestConnectHandler_RejectedClaimDoesNotRecordAUser(t *testing.T) {
	mux, rec := newTestHandler(t)

	connect(t, mux, `{"url":"https://example.com/a","username":"alice","browser":"chrome","session_id":"s1","region":"us"}`)
	// Same username again, from a different session - must be rejected
	// (409), and must not double-count the user.
	w := connect(t, mux, `{"url":"https://example.com/a","username":"alice","browser":"chrome","session_id":"s2","region":"us"}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", w.Code)
	}

	if got := rec.Snapshot().UniqueUsers; got != 1 {
		t.Errorf("UniqueUsers = %d, want 1", got)
	}
}

func TestMetricsHandler_ReturnsSnapshotAsJSON(t *testing.T) {
	mux, rec := newTestHandler(t)
	rec.AddRoom("room-a")
	rec.AddRoom("room-b")
	rec.AddUser("alice")

	req := httptest.NewRequest(http.MethodGet, "/custom-metrics", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var got metrics.Snapshot
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.UniqueRooms != 2 {
		t.Errorf("unique_rooms = %d, want 2", got.UniqueRooms)
	}
	if got.UniqueUsers != 1 {
		t.Errorf("unique_users = %d, want 1", got.UniqueUsers)
	}
}
