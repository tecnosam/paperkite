package token_test

import (
	"testing"

	"github.com/paperkite/chat-service/internal/token"
)

const testSecret = "unit-test-secret-32-bytes-minimum"

func TestGenerateAndVerifyRoundTrip(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", testSecret)

	tok, err := token.Generate("https://example.com/page/", "alice", "Chrome/120", "sess-1", "us-east")
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}

	claims, err := token.Verify(tok)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}

	if claims.Username != "alice" {
		t.Errorf("Username: got %q want %q", claims.Username, "alice")
	}
	if claims.Browser != "Chrome/120" {
		t.Errorf("Browser: got %q want %q", claims.Browser, "Chrome/120")
	}
	if claims.SessionID != "sess-1" {
		t.Errorf("SessionID: got %q want %q", claims.SessionID, "sess-1")
	}
	if claims.Region != "us-east" {
		t.Errorf("Region: got %q want %q", claims.Region, "us-east")
	}

	// Room must be the md5 of the URL without the trailing slash.
	wantRoom := token.RoomFromURL("https://example.com/page")
	if claims.Room != wantRoom {
		t.Errorf("Room: got %q want %q", claims.Room, wantRoom)
	}
}

func TestVerifyRejectsWrongSecret(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", "secret-a")
	tok, err := token.Generate("https://example.com", "bob", "Firefox/121", "sess-2", "eu-west")
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}

	t.Setenv("CHAT_JWT_SECRET", "secret-b")
	_, err = token.Verify(tok)
	if err == nil {
		t.Fatal("expected error verifying token signed with a different secret")
	}
}

func TestVerifyRejectsTamperedToken(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", testSecret)
	tok, err := token.Generate("https://example.com", "charlie", "Safari/17", "sess-3", "ap-south")
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}

	tampered := tok[:len(tok)-4] + "XXXX"
	_, err = token.Verify(tampered)
	if err == nil {
		t.Fatal("expected error verifying tampered token")
	}
}

func TestVerifyRejectsMissingSecret(t *testing.T) {
	t.Setenv("CHAT_JWT_SECRET", "")
	_, err := token.Verify("any.token.value")
	if err == nil {
		t.Fatal("expected error when CHAT_JWT_SECRET is not set")
	}
}

func TestRoomFromURLNormalizesTrailingSlash(t *testing.T) {
	cases := []struct{ a, b string }{
		{"https://example.com/page", "https://example.com/page/"},
		{"https://example.com/page", "https://example.com/page///"},
		{"https://example.com", "https://example.com/"},
	}
	for _, tc := range cases {
		if token.RoomFromURL(tc.a) != token.RoomFromURL(tc.b) {
			t.Errorf("RoomFromURL(%q) != RoomFromURL(%q)", tc.a, tc.b)
		}
	}
}

func TestRoomFromURLDistinguishesPages(t *testing.T) {
	a := token.RoomFromURL("https://example.com/page-a")
	b := token.RoomFromURL("https://example.com/page-b")
	if a == b {
		t.Error("different URLs should produce different rooms")
	}
}
