package ops

import (
	"fmt"
	"os"

	"github.com/golang-jwt/jwt/v5"
)

// DeployClaims is the shape CI signs and sends as the bearer token on
// POST /deploy. The token itself carries the deploy payload - there is
// no separate request body - so a valid signature is both authentication
// and the source of truth for what to deploy. Verified against
// OPS_JWT_SECRET, deliberately a *different* secret than CHAT_JWT_SECRET
// (the app's own client-facing signing key, see internal/token) - a leak
// of one shouldn't compromise the other, and this token grants a lot more
// than a chat session does.
type DeployClaims struct {
	jwt.RegisteredClaims
	Source       string            `json:"source"`
	BuildVersion string            `json:"buildVersion"`
	Builds       map[string]string `json:"builds"`
}

// VerifyDeployToken parses and validates a deploy JWT, returning its
// claims on success.
func VerifyDeployToken(tokenStr string) (*DeployClaims, error) {
	key, err := opsSigningKey()
	if err != nil {
		return nil, err
	}
	t, err := jwt.ParseWithClaims(tokenStr, &DeployClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return key, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := t.Claims.(*DeployClaims)
	if !ok || !t.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}

func opsSigningKey() ([]byte, error) {
	k := os.Getenv("OPS_JWT_SECRET")
	if k == "" {
		return nil, fmt.Errorf("OPS_JWT_SECRET environment variable is not set")
	}
	return []byte(k), nil
}
