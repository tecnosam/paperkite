package hub_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/paperkite/chat-service/internal/hub"
)

func publish(h *hub.Hub, room, content string) {
	h.Publish(hub.Message{
		ID:        content,
		Room:      room,
		Sender:    "tester",
		Content:   content,
		Timestamp: time.Now(),
	})
}

// --- Poll ---

func TestPollCursorZeroReturnsAllBuffered(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "a")
	publish(h, "r1", "b")

	msgs := h.Poll("r1", 0)
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
}

func TestPollReturnsMsgAfterCursor(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "first")
	cursor := h.Seq("r1")
	publish(h, "r1", "second")

	msgs := h.Poll("r1", cursor)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message, got %d", len(msgs))
	}
	if msgs[0].Content != "second" {
		t.Errorf("content: got %q want %q", msgs[0].Content, "second")
	}
}

func TestPollDoesNotRedeliverMessages(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "hello")

	first := h.Poll("r1", 0)
	if len(first) == 0 {
		t.Fatal("expected messages on first poll")
	}
	cursor := first[len(first)-1].Seq

	second := h.Poll("r1", cursor)
	if len(second) != 0 {
		t.Errorf("expected 0 messages on re-poll, got %d", len(second))
	}
}

func TestPollReturnsNilForUnknownRoom(t *testing.T) {
	if msgs := hub.New().Poll("no-such-room", 0); msgs != nil {
		t.Errorf("expected nil for unknown room, got %v", msgs)
	}
}

func TestPollIsolatedByRoom(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "for r1")
	publish(h, "r2", "for r2")

	msgs := h.Poll("r1", 0)
	if len(msgs) != 1 || msgs[0].Content != "for r1" {
		t.Errorf("r1 poll returned wrong messages: %+v", msgs)
	}
}

// --- Buffer cap ---

func TestBufferCappedAtMaxSize(t *testing.T) {
	h := hub.New()
	total := hub.MaxBufferSize + 50
	for i := range total {
		publish(h, "r1", fmt.Sprintf("msg-%d", i))
	}

	msgs := h.Poll("r1", 0)
	if len(msgs) != hub.MaxBufferSize {
		t.Errorf("expected %d messages (cap), got %d", hub.MaxBufferSize, len(msgs))
	}
	wantFirst := fmt.Sprintf("msg-%d", total-hub.MaxBufferSize)
	if msgs[0].Content != wantFirst {
		t.Errorf("oldest message: got %q want %q", msgs[0].Content, wantFirst)
	}
	wantLast := fmt.Sprintf("msg-%d", total-1)
	if msgs[len(msgs)-1].Content != wantLast {
		t.Errorf("newest message: got %q want %q", msgs[len(msgs)-1].Content, wantLast)
	}
}

// --- Stale cursor ---

func TestPollStaleCursorReturnsFromBufferStart(t *testing.T) {
	h := hub.New()
	for i := range hub.MaxBufferSize + 1 {
		publish(h, "r1", fmt.Sprintf("msg-%d", i))
	}
	// cursor=1 predates all buffered messages (seq starts at unix ms >> 1)
	msgs := h.Poll("r1", 1)
	if len(msgs) != hub.MaxBufferSize {
		t.Errorf("stale cursor: expected %d messages, got %d", hub.MaxBufferSize, len(msgs))
	}
}

// --- Seq ---

func TestSeqIsZeroForUnknownRoom(t *testing.T) {
	if hub.New().Seq("r1") != 0 {
		t.Error("seq should be 0 for unknown room")
	}
}

func TestSeqAdvancesMonotonically(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "x")
	s1 := h.Seq("r1")
	publish(h, "r1", "y")
	s2 := h.Seq("r1")
	if s1 == 0 || s2 <= s1 {
		t.Errorf("seq did not advance monotonically: %d → %d", s1, s2)
	}
}

// --- NextPollMs ---

func TestNextPollMsMaxForUnknownRoom(t *testing.T) {
	if ms := hub.New().NextPollMs("r1"); ms != 30_000 {
		t.Errorf("expected 30000ms for unknown room, got %d", ms)
	}
}

func TestNextPollMsShortAfterRecentPublish(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "hello")
	if ms := h.NextPollMs("r1"); ms != 1_000 {
		t.Errorf("expected 1000ms immediately after publish, got %d", ms)
	}
}

// --- GC ---

func TestGCRemovesIdleRooms(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "hello")
	publish(h, "r2", "world")

	// Cutoff in the future removes all rooms.
	removed := h.GC(time.Now().Add(time.Hour))
	if removed != 2 {
		t.Errorf("expected 2 rooms removed, got %d", removed)
	}
	if msgs := h.Poll("r1", 0); msgs != nil {
		t.Error("r1 should not exist after GC")
	}
}

func TestGCKeepsRecentlyActiveRooms(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "hello")

	// Cutoff in the past — room was active after cutoff, should stay.
	removed := h.GC(time.Now().Add(-time.Hour))
	if removed != 0 {
		t.Errorf("expected 0 rooms removed, got %d", removed)
	}
	if h.Poll("r1", 0) == nil {
		t.Error("r1 should still exist")
	}
}

func TestGCRoomRecreationSeqIsAhead(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "hello")
	oldSeq := h.Seq("r1")

	h.GC(time.Now().Add(time.Hour)) // remove r1

	// Sleep so UnixMilli ticks forward before room is recreated.
	time.Sleep(2 * time.Millisecond)

	// Recreate by publishing again.
	publish(h, "r1", "after gc")
	newSeq := h.Seq("r1")

	// newSeq must be > oldSeq so old cursors don't skip new messages.
	if newSeq <= oldSeq {
		t.Errorf("recreated room seq (%d) must be > old seq (%d)", newSeq, oldSeq)
	}
}

// --- Subscribe / live fan-out ---

func TestSubscribeReceivesLivePublish(t *testing.T) {
	h := hub.New()
	ch, unsubscribe, ok := h.Subscribe("r1")
	if !ok {
		t.Fatal("expected subscribe to succeed")
	}
	defer unsubscribe()

	publish(h, "r1", "hello")

	select {
	case m := <-ch:
		if m.Content != "hello" {
			t.Errorf("content: got %q want %q", m.Content, "hello")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for live message")
	}
}

func TestSubscribeDoesNotReceiveMessagesPublishedBeforeIt(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "before")

	ch, unsubscribe, ok := h.Subscribe("r1")
	if !ok {
		t.Fatal("expected subscribe to succeed")
	}
	defer unsubscribe()

	select {
	case m := <-ch:
		t.Fatalf("did not expect a message published before Subscribe, got %+v", m)
	case <-time.After(50 * time.Millisecond):
		// expected: nothing arrives; backlog is Poll's job, not Subscribe's.
	}
}

func TestSubscribeIsolatedByRoom(t *testing.T) {
	h := hub.New()
	chA, unsubA, _ := h.Subscribe("r1")
	defer unsubA()
	chB, unsubB, _ := h.Subscribe("r2")
	defer unsubB()

	publish(h, "r1", "for r1")

	select {
	case m := <-chA:
		if m.Content != "for r1" {
			t.Errorf("content: got %q", m.Content)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting on r1 subscriber")
	}

	select {
	case m := <-chB:
		t.Fatalf("r2 subscriber should not see an r1 publish, got %+v", m)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestUnsubscribeStopsDelivery(t *testing.T) {
	h := hub.New()
	ch, unsubscribe, _ := h.Subscribe("r1")
	unsubscribe()

	publish(h, "r1", "after unsubscribe")

	select {
	case m, ok := <-ch:
		if ok {
			t.Fatalf("did not expect a message after unsubscribe, got %+v", m)
		}
	case <-time.After(50 * time.Millisecond):
		// expected: nothing arrives.
	}
}

func TestPublishDropsForSlowSubscriber(t *testing.T) {
	h := hub.New()
	ch, unsubscribe, _ := h.Subscribe("r1")
	defer unsubscribe()

	// Publish far more than the subscriber's small buffer can hold, without
	// ever draining — Publish must not block or panic.
	total := hub.MaxBufferSize
	for i := range total {
		publish(h, "r1", fmt.Sprintf("msg-%d", i))
	}

	count := 0
drain:
	for {
		select {
		case <-ch:
			count++
		default:
			break drain
		}
	}
	if count == 0 {
		t.Error("expected at least some messages to have reached the subscriber")
	}
	if count > total {
		t.Errorf("got more messages than were published: %d > %d", count, total)
	}
}

func TestSubscribeHasNoPerRoomCap(t *testing.T) {
	h := hub.New()
	// A single room can hold well more subscribers than the old per-room
	// cap (200) used to allow — there's no ceiling forcing subscribers to
	// spread across rooms, only the server-wide total matters.
	const moreThanOldPerRoomCap = 350
	for i := range moreThanOldPerRoomCap {
		if _, _, ok := h.Subscribe("r1"); !ok {
			t.Fatalf("subscribe %d: expected ok, a single room should not be capped", i)
		}
	}
}

func TestSubscribeRespectsGlobalCap(t *testing.T) {
	h := hub.New()
	// Exhaust the global budget in one room — there's no per-room cap to
	// force spreading across rooms anymore.
	for i := range hub.MaxSSESubscribersTotal {
		if _, _, ok := h.Subscribe("r1"); !ok {
			t.Fatalf("subscribe %d: expected ok", i)
		}
	}
	if _, _, ok := h.Subscribe("r1"); ok {
		t.Error("expected the global cap to reject the next subscription in the same room")
	}
	if _, _, ok := h.Subscribe("overflow-room"); ok {
		t.Error("expected the global cap to reject a subscription once totalSubs is exhausted, even in a fresh room")
	}
}

func TestGCKeepsRoomWithActiveSubscriber(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "hello")
	_, unsubscribe, ok := h.Subscribe("r1")
	if !ok {
		t.Fatal("expected subscribe to succeed")
	}
	defer unsubscribe()

	// Cutoff in the future would normally remove every room; an active
	// subscriber should keep r1 alive regardless.
	removed := h.GC(time.Now().Add(time.Hour))
	if removed != 0 {
		t.Errorf("expected 0 rooms removed while a subscriber is active, got %d", removed)
	}
	if h.Poll("r1", 0) == nil {
		t.Error("r1 should still exist while a subscriber is active")
	}
}

func TestGCRemovesRoomAfterUnsubscribe(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "hello")
	_, unsubscribe, _ := h.Subscribe("r1")
	unsubscribe()

	removed := h.GC(time.Now().Add(time.Hour))
	if removed != 1 {
		t.Errorf("expected 1 room removed after unsubscribe, got %d", removed)
	}
}

// --- Broadcast ---

func TestRoomsReturnsEveryTrackedRoom(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "hello")
	publish(h, "r2", "hello")

	rooms := h.Rooms()
	if len(rooms) != 2 {
		t.Fatalf("expected 2 rooms, got %d: %v", len(rooms), rooms)
	}
}

func TestBroadcastReachesEveryRoom(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "hello")
	publish(h, "r2", "hello")

	h.Broadcast("restarting")

	for _, room := range []string{"r1", "r2"} {
		msgs := h.Poll(room, 0)
		last := msgs[len(msgs)-1]
		if last.Sender != hub.SystemSender {
			t.Errorf("room %s: sender = %q, want %q", room, last.Sender, hub.SystemSender)
		}
		if last.Content != "restarting" {
			t.Errorf("room %s: content = %q, want %q", room, last.Content, "restarting")
		}
	}
}

func TestBroadcastSkipsRoomsThatDoNotExistYet(t *testing.T) {
	h := hub.New()
	h.Broadcast("restarting") // no rooms tracked yet - must not panic or create one

	if rooms := h.Rooms(); len(rooms) != 0 {
		t.Errorf("expected no rooms to exist, got %v", rooms)
	}
}

func TestBroadcastMessagesHaveUniqueIDs(t *testing.T) {
	h := hub.New()
	publish(h, "r1", "hello")
	publish(h, "r2", "hello")
	publish(h, "r3", "hello")

	h.Broadcast("restarting")

	seen := map[string]bool{}
	for _, room := range []string{"r1", "r2", "r3"} {
		msgs := h.Poll(room, 0)
		id := msgs[len(msgs)-1].ID
		if seen[id] {
			t.Errorf("duplicate broadcast message ID %q across rooms", id)
		}
		seen[id] = true
	}
}
