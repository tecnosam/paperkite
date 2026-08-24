// Command chat is a minimal interactive CLI client for chat-service. It
// speaks the documented HTTP/JSON protocol only (see PROTOCOL.md) — no
// internal packages — so it exercises the server exactly the way any real
// client would: /connect, then either /events (SSE, default) or /poll for
// live delivery, plus /send from stdin.
//
// Two independent terminals running this against the same server and room
// are the fastest way to manually verify live delivery end-to-end.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type message struct {
	ID        string `json:"id"`
	Seq       uint64 `json:"seq"`
	Room      string `json:"room"`
	Sender    string `json:"sender"`
	Content   string `json:"content"`
	Timestamp int64  `json:"timestamp"` // Unix milliseconds
}

var stdoutMu sync.Mutex

// printLine is the only thing that writes to stdout, guarded so the
// incoming-message stream and status lines from the send loop can't
// interleave mid-line.
func printLine(format string, args ...any) {
	stdoutMu.Lock()
	defer stdoutMu.Unlock()
	fmt.Printf(format+"\n", args...)
}

func printMessage(m message) {
	printLine("[%s] %s: %s", time.UnixMilli(m.Timestamp).Format("15:04:05"), m.Sender, m.Content)
}

func main() {
	var (
		server    = flag.String("server", "http://localhost:8080", "chat-service HTTP base URL")
		roomURL   = flag.String("url", "", "room URL to connect to (required)")
		username  = flag.String("username", "", "username to claim (ignored if -token is set)")
		tok       = flag.String("token", "", "reuse a token from a previous run instead of claiming -username (see PROTOCOL.md: POST /connect)")
		browser   = flag.String("browser", "chat-cli", "browser field sent to /connect")
		region    = flag.String("region", "local", "region field sent to /connect")
		session   = flag.String("session", "", "session_id field sent to /connect (default: generated)")
		transport = flag.String("transport", "sse", "live delivery transport: sse or poll")
	)
	flag.Parse()

	if *roomURL == "" {
		fmt.Fprintln(os.Stderr, "error: -url is required")
		flag.Usage()
		os.Exit(2)
	}
	if *username == "" && *tok == "" {
		fmt.Fprintln(os.Stderr, "error: either -username or -token is required")
		flag.Usage()
		os.Exit(2)
	}
	if *username != "" && *tok != "" {
		fmt.Fprintln(os.Stderr, "note: -token is set, so -username is ignored by the server — identity comes from the token")
	}
	if *transport != "sse" && *transport != "poll" {
		fmt.Fprintf(os.Stderr, "error: -transport must be \"sse\" or \"poll\", got %q\n", *transport)
		os.Exit(2)
	}
	if *session == "" {
		*session = fmt.Sprintf("cli-%d-%d", os.Getpid(), time.Now().UnixNano())
	}

	c := &client{base: strings.TrimRight(*server, "/"), http: &http.Client{}}

	cr, err := c.connect(connectRequest{
		URL: *roomURL, Username: *username, Token: *tok,
		Browser: *browser, SessionID: *session, Region: *region,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "connect failed:", err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "connected via %s (cursor=%d)\n", *transport, cr.Cursor)
	fmt.Fprintf(os.Stderr, "token (pass as -token to reconnect without reclaiming a username):\n%s\n\n", cr.Token)
	fmt.Fprintln(os.Stderr, "type a message and press enter to send; Ctrl+D or Ctrl+C to quit")

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if *transport == "poll" {
			c.streamPoll(ctx, cr.Token, cr.Cursor)
		} else {
			c.streamSSE(ctx, cr.Token, cr.Cursor)
		}
	}()

	c.sendLoop(ctx, cr.Token)
	stop() // in case sendLoop exited via EOF rather than a signal
	wg.Wait()
}

// --- HTTP client ---

type client struct {
	base string
	http *http.Client
}

type connectRequest struct {
	URL       string `json:"url"`
	Username  string `json:"username,omitempty"`
	Token     string `json:"token,omitempty"`
	Browser   string `json:"browser"`
	SessionID string `json:"session_id"`
	Region    string `json:"region"`
}

type connectResponse struct {
	Token  string `json:"token"`
	Cursor uint64 `json:"cursor"`
}

func (c *client) connect(req connectRequest) (connectResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return connectResponse{}, err
	}
	resp, err := c.http.Post(c.base+"/connect", "application/json", bytes.NewReader(body))
	if err != nil {
		return connectResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return connectResponse{}, statusError(resp)
	}
	var cr connectResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return connectResponse{}, err
	}
	return cr, nil
}

func (c *client) send(tok, content string) error {
	body, _ := json.Marshal(struct {
		Content string `json:"content"`
	}{Content: content})

	req, err := http.NewRequest(http.MethodPost, c.base+"/send", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return statusError(resp)
	}
	return nil
}

// sendLoop reads lines from stdin and POSTs each as a message, until ctx is
// canceled or stdin hits EOF. Reading stdin happens in its own goroutine so
// a Ctrl+C is honored immediately even while blocked on a line read.
func (c *client) sendLoop(ctx context.Context, tok string) {
	lines := make(chan string)
	go func() {
		defer close(lines)
		sc := bufio.NewScanner(os.Stdin)
		for sc.Scan() {
			lines <- sc.Text()
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case line, ok := <-lines:
			if !ok {
				return // stdin closed (Ctrl+D)
			}
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			if err := c.send(tok, line); err != nil {
				printLine("[send error] %v", err)
			}
		}
	}
}

// streamSSE opens GET /events and prints each message as it arrives. On
// any failure to establish the stream it falls back to streamPoll, per the
// fallback guidance in PROTOCOL.md.
func (c *client) streamSSE(ctx context.Context, tok string, cursor uint64) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/events?cursor=%d", c.base, cursor), nil)
	if err != nil {
		printLine("[sse] request error: %v", err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+tok)

	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return
		}
		printLine("[sse] connect error: %v — falling back to /poll", err)
		c.streamPoll(ctx, tok, cursor)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		printLine("[sse] %v — falling back to /poll", statusError(resp))
		c.streamPoll(ctx, tok, cursor)
		return
	}

	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		data, ok := strings.CutPrefix(sc.Text(), "data: ")
		if !ok {
			continue // blank line separator or ": heartbeat" comment
		}
		var m message
		if err := json.Unmarshal([]byte(data), &m); err != nil {
			continue
		}
		printMessage(m)
	}
	if ctx.Err() == nil {
		printLine("[sse] stream ended unexpectedly — falling back to /poll")
		c.streamPoll(ctx, tok, cursor)
	}
}

// streamPoll drives the documented /poll loop: wait X-Next-Poll-Ms (or
// next_poll_ms), poll again, repeat.
func (c *client) streamPoll(ctx context.Context, tok string, cursor uint64) {
	nextMs := int64(1000)
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Duration(nextMs) * time.Millisecond):
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodGet,
			fmt.Sprintf("%s/poll?cursor=%d", c.base, cursor), nil)
		if err != nil {
			return
		}
		req.Header.Set("Authorization", "Bearer "+tok)

		resp, err := c.http.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			printLine("[poll] error: %v", err)
			continue
		}

		nextMs = 30_000
		if h := resp.Header.Get("X-Next-Poll-Ms"); h != "" {
			if v, err := strconv.ParseInt(h, 10, 64); err == nil {
				nextMs = v
			}
		}

		if resp.StatusCode == http.StatusNotModified {
			resp.Body.Close()
			continue
		}
		if resp.StatusCode != http.StatusOK {
			printLine("[poll] %v", statusError(resp))
			resp.Body.Close()
			continue
		}

		var pr struct {
			Messages []message `json:"messages"`
			Cursor   uint64    `json:"cursor"`
		}
		err = json.NewDecoder(resp.Body).Decode(&pr)
		resp.Body.Close()
		if err != nil {
			printLine("[poll] decode error: %v", err)
			continue
		}
		for _, m := range pr.Messages {
			printMessage(m)
		}
		cursor = pr.Cursor
	}
}

// statusError builds an error from a non-2xx response body. Callers still
// own closing resp.Body.
func statusError(resp *http.Response) error {
	b, _ := io.ReadAll(resp.Body)
	msg := strings.TrimSpace(string(b))
	if retry := resp.Header.Get("Retry-After"); retry != "" {
		msg = fmt.Sprintf("%s (retry after %ss)", msg, retry)
	}
	return fmt.Errorf("status %d: %s", resp.StatusCode, msg)
}
