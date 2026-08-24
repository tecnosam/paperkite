package token

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// Claims holds the identity and context of a connected user.
// All fields are derived from the /connect query parameters.
type Claims struct {
	jwt.RegisteredClaims
	URL       string `json:"url"`
	Username  string `json:"username"`
	Browser   string `json:"browser"`
	SessionID string `json:"session_id"`
	Region    string `json:"region"`
	Room      string `json:"room"` // md5 hex of URL (trailing slashes stripped)
}

// RoomFromURL returns the lowercase MD5 hex of rawURL with all trailing slashes removed.
func RoomFromURL(rawURL string) string {
	normalized := strings.TrimRight(rawURL, "/")
	sum := md5.Sum([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

// Generate creates a signed, non-expiring JWT from the /connect parameters.
// A fresh token is issued on every SSE connect; revocation is handled by
// closing the SSE connection rather than invalidating tokens server-side.
func Generate(rawURL, username, browser, sessionID, region string) (string, error) {
	key, err := signingKey()
	if err != nil {
		return "", err
	}
	claims := Claims{
		URL:       rawURL,
		Username:  username,
		Browser:   browser,
		SessionID: sessionID,
		Region:    region,
		Room:      RoomFromURL(rawURL),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(key)
}

// Verify parses and validates a JWT string, returning its claims on success.
func Verify(tokenStr string) (*Claims, error) {
	key, err := signingKey()
	if err != nil {
		return nil, err
	}
	t, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return key, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := t.Claims.(*Claims)
	if !ok || !t.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}

func signingKey() ([]byte, error) {
	k := os.Getenv("CHAT_JWT_SECRET")
	if k == "" {
		return nil, fmt.Errorf("CHAT_JWT_SECRET environment variable is not set")
	}
	return []byte(k), nil
}
