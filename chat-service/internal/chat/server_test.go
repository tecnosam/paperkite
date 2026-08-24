package chat_test

import (
	"context"
	"testing"

	genpb "github.com/paperkite/chat-service/gen/chat"
	"github.com/paperkite/chat-service/internal/chat"
	"github.com/paperkite/chat-service/internal/hub"
	"github.com/paperkite/chat-service/internal/token"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const testSecret = "unit-test-secret"

func makeToken(t *testing.T, rawURL string) string {
	t.Helper()
	tok, err := token.Generate(rawURL, "alice", "Chrome/120", "sess-1", "us-east")
	if err != nil {
		t.Fatalf("token.Generate: %v", err)
	}
	return tok
}

func TestSendMessage_ValidToken_PublishesToHub(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", testSecret)

	h := hub.New()
	srv := chat.NewServer(h)

	_, err := srv.SendMessage(context.Background(), &genpb.SendMessageRequest{
		Token:   makeToken(t, "https://example.com/page"),
		Content: "hello world",
	})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}

	room := token.RoomFromURL("https://example.com/page")
	msgs := h.Poll(room, 0)
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message in buffer, got %d", len(msgs))
	}
	if msgs[0].Sender != "alice" {
		t.Errorf("Sender: got %q want %q", msgs[0].Sender, "alice")
	}
	if msgs[0].Content != "hello world" {
		t.Errorf("Content: got %q want %q", msgs[0].Content, "hello world")
	}
}

func TestSendMessage_InvalidToken_ReturnsUnauthenticated(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", testSecret)

	srv := chat.NewServer(hub.New())
	_, err := srv.SendMessage(context.Background(), &genpb.SendMessageRequest{
		Token:   "bad.token.value",
		Content: "hello",
	})
	if err == nil {
		t.Fatal("expected error with invalid token")
	}
	if code := status.Code(err); code != codes.Unauthenticated {
		t.Errorf("status code: got %v want %v", code, codes.Unauthenticated)
	}
}

func TestSendMessage_EmptyContent_ReturnsInvalidArgument(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", testSecret)

	srv := chat.NewServer(hub.New())
	_, err := srv.SendMessage(context.Background(), &genpb.SendMessageRequest{
		Token:   makeToken(t, "https://example.com"),
		Content: "",
	})
	if err == nil {
		t.Fatal("expected error with empty content")
	}
	if code := status.Code(err); code != codes.InvalidArgument {
		t.Errorf("status code: got %v want %v", code, codes.InvalidArgument)
	}
}

func TestSendMessage_RoomDerivedFromToken(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", testSecret)

	h := hub.New()
	srv := chat.NewServer(h)

	roomA := token.RoomFromURL("https://example.com/page-a")
	roomB := token.RoomFromURL("https://example.com/page-b")

	tokA, _ := token.Generate("https://example.com/page-a", "alice", "Chrome", "s1", "us-east")
	if _, err := srv.SendMessage(context.Background(), &genpb.SendMessageRequest{Token: tokA, Content: "for A"}); err != nil {
		t.Fatal(err)
	}

	if msgs := h.Poll(roomA, 0); len(msgs) != 1 {
		t.Errorf("page-a: expected 1 message, got %d", len(msgs))
	}
	if msgs := h.Poll(roomB, 0); len(msgs) != 0 {
		t.Errorf("page-b: expected 0 messages, got %d", len(msgs))
	}
}
