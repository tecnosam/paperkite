// cmd/deploytoken mints a signed deploy JWT (see internal/ops.DeployClaims)
// for POST /deploy on the ops daemon. Used by
// .github/workflows/release-chat-service.yml right after a successful
// build, and handy for manually exercising a running ops daemon. Reuses
// ops.DeployClaims directly rather than reimplementing the shape in YAML,
// so CI and the daemon that verifies the token can never drift apart on
// what fields it carries.
//
// Usage:
//
//	OPS_JWT_SECRET=... go run ./cmd/deploytoken -version 1.2.3 -linux https://example.com/chat-service-server-linux-amd64
//
// Prints the token to stdout, nothing else - safe to capture directly:
//
//	TOKEN=$(OPS_JWT_SECRET=... go run ./cmd/deploytoken -version 1.2.3 -linux "$URL")
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/golang-jwt/jwt/v5"
	"github.com/paperkite/chat-service/internal/ops"
)

func main() {
	version := flag.String("version", "", "build version, e.g. 1.2.3 (required)")
	linuxURL := flag.String("linux", "", "URL to the linux binary for this build (required)")
	source := flag.String("source", "github", "value for the token's source claim")
	flag.Parse()

	if *version == "" || *linuxURL == "" {
		fmt.Fprintln(os.Stderr, "usage: deploytoken -version <ver> -linux <url> [-source <source>]")
		os.Exit(2)
	}

	secret := os.Getenv("OPS_JWT_SECRET")
	if secret == "" {
		fmt.Fprintln(os.Stderr, "OPS_JWT_SECRET environment variable is not set")
		os.Exit(1)
	}

	claims := ops.DeployClaims{
		Source:       *source,
		BuildVersion: *version,
		Builds:       map[string]string{"linux": *linuxURL},
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		fmt.Fprintln(os.Stderr, "sign token:", err)
		os.Exit(1)
	}
	fmt.Print(tok)
}
