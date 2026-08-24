//go:build integration

package integration_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/paperkite/chat-service/internal/hub"
)

// sseEvent mirrors the JSON shape /events streams — identical to /poll's
// per-message shape.
type sseEvent struct {
	ID        string `json:"id"`
	Seq       uint64 `json:"seq"`
	Room      string `json:"room"`
	Sender    string `json:"sender"`
	Content   string `json:"content"`
	Timestamp int64  `json:"timestamp"`
}

// openSSE opens a GET /events stream and returns a channel of decoded
// events plus a cancel func the caller must call to disconnect. The
// returned channel is closed once the underlying connection is torn down
// and the reader goroutine has fully exited.
func openSSE(t *testing.T, addr, tok string, cursor uint64) (events <-chan sseEvent, cancel context.CancelFunc) {
	t.Helper()
	ctx, cancelFn := context.WithCancel(context.Background())

	url := fmt.Sprintf("http://%s/events", addr)
	if cursor > 0 {
		url = fmt.Sprintf("%s?cursor=%d", url, cursor)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+tok)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /events: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("GET /events: status %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		resp.Body.Close()
		t.Fatalf("Content-Type: got %q want %q", ct, "text/event-stream")
	}

	out := make(chan sseEvent, 16)
	go func() {
		defer close(out)
		defer resp.Body.Close()
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			data, ok := strings.CutPrefix(sc.Text(), "data: ")
			if !ok {
				continue // blank line separator or ": heartbeat" comment
			}
			var ev sseEvent
			if err := json.Unmarshal([]byte(data), &ev); err != nil {
				continue
			}
			select {
			case out <- ev:
			case <-ctx.Done():
				return
			}
		}
	}()

	return out, cancelFn
}

func TestSSELivePush(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok, _ := doConnect(t, addr, "https://example.com/sse-live/")

	events, cancel := openSSE(t, addr, tok, 0)
	defer cancel()

	if code := doSend(t, addr, tok, "hello via sse"); code != http.StatusOK {
		t.Fatalf("send: status %d", code)
	}

	select {
	case ev := <-events:
		if ev.Content != "hello via sse" {
			t.Errorf("content: got %q want %q", ev.Content, "hello via sse")
		}
		if ev.Sender != "alice" {
			t.Errorf("sender: got %q want %q", ev.Sender, "alice")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for live SSE push — message should arrive immediately, not on a poll delay")
	}
}

func TestSSECatchUpDeliversBacklogThenLive(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	tok, cursor := doConnect(t, addr, "https://example.com/sse-catchup/")
	if code := doSend(t, addr, tok, "before stream opened"); code != http.StatusOK {
		t.Fatalf("send: status %d", code)
	}

	// Mirrors /poll: connecting with the pre-send cursor should replay the
	// buffered message as catch-up before switching to live push.
	events, cancel := openSSE(t, addr, tok, cursor)
	defer cancel()

	select {
	case ev := <-events:
		if ev.Content != "before stream opened" {
			t.Errorf("backlog content: got %q want %q", ev.Content, "before stream opened")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for backlog catch-up event")
	}

	if code := doSend(t, addr, tok, "after stream opened"); code != http.StatusOK {
		t.Fatalf("send: status %d", code)
	}

	select {
	case ev := <-events:
		if ev.Content != "after stream opened" {
			t.Errorf("live content: got %q want %q", ev.Content, "after stream opened")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for live event following catch-up")
	}
}

func TestSSERejectsMissingToken(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	resp, err := http.Get(fmt.Sprintf("http://%s/events", addr))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestSSERejectsInvalidToken(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())

	req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("http://%s/events", addr), nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

// TestSSEDisconnectReleasesGoroutine verifies a client disconnect drives
// clean unregister-and-exit: no goroutine (client-side reader or
// server-side handler, both live in this same process) survives the
// connect+disconnect cycle.
func TestSSEDisconnectReleasesGoroutine(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", integrationSecret)
	addr := startServer(t, hub.New())
	tok, _ := doConnect(t, addr, "https://example.com/sse-leak/")

	baseline := goroutineCountStable(t)

	events, cancel := openSSE(t, addr, tok, 0)
	time.Sleep(50 * time.Millisecond) // let the stream fully establish

	cancel()
	for range events {
		// Drain until the reader goroutine closes the channel on its way out.
	}

	after := goroutineCountStable(t)
	if after > baseline+1 { // small slack for scheduler/runtime noise
		t.Errorf("possible goroutine leak after SSE disconnect: baseline=%d after=%d", baseline, after)
	}
}

// goroutineCountStable samples runtime.NumGoroutine() until two consecutive
// samples agree (or a small number of attempts is exhausted), so a
// leak-detection assertion isn't flaky against in-flight background work.
func goroutineCountStable(t *testing.T) int {
	t.Helper()
	prev := runtime.NumGoroutine()
	for range 30 {
		time.Sleep(10 * time.Millisecond)
		cur := runtime.NumGoroutine()
		if cur == prev {
			return cur
		}
		prev = cur
	}
	return prev
}
