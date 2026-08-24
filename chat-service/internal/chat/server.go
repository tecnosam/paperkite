package chat

import (
	"context"
	"fmt"
	"time"

	genpb "github.com/paperkite/chat-service/gen/chat"
	"github.com/paperkite/chat-service/internal/hub"
	"github.com/paperkite/chat-service/internal/token"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Server implements the gRPC ChatServer interface.
type Server struct {
	genpb.UnimplementedChatServer
	hub *hub.Hub
}

func NewServer(h *hub.Hub) *Server {
	return &Server{hub: h}
}

// SendMessage verifies the caller's JWT then publishes their message.
// Room and sender are derived from the token — callers cannot spoof either.
func (s *Server) SendMessage(_ context.Context, req *genpb.SendMessageRequest) (*genpb.SendMessageResponse, error) {
	claims, err := token.Verify(req.Token)
	if err != nil {
		return nil, status.Errorf(codes.Unauthenticated, "invalid token: %v", err)
	}
	if req.Content == "" {
		return nil, status.Error(codes.InvalidArgument, "content is required")
	}

	msg := hub.Message{
		ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
		Room:      claims.Room,
		Sender:    claims.Username,
		Content:   req.Content,
		Timestamp: time.Now(),
	}
	s.hub.Publish(msg)

	return &genpb.SendMessageResponse{Id: msg.ID}, nil
}
