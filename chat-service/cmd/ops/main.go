// cmd/ops is a separate daemon from chat-service's app server (cmd/server)
// - a single REST endpoint that receives a signed deploy webhook from CI,
// swaps the running app binary for a new one, and rolls back if it
// doesn't come up healthy. See internal/ops for the actual orchestration
// and PROTOCOL.md's "System messages" section for how the app itself
// warns connected clients before this pulls the rug out from under it.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/paperkite/chat-service/internal/ops"
)

const (
	defaultAddr      = ":9090"
	defaultDataDir   = "ops-data"
	defaultHealthURL = "http://localhost:8080/healthz"

	// deployTimeout bounds the whole POST /deploy request (download +
	// terminate + launch + healthCheckDelay + retries) - generous, since
	// the client (a CI job) is expected to wait for a real pass/fail
	// rather than the deploy continuing invisibly after a client timeout.
	deployTimeout = 90 * time.Second
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if os.Getenv("OPS_JWT_SECRET") == "" {
		log.Error("OPS_JWT_SECRET environment variable must be set")
		os.Exit(1)
	}

	addr := envOr("OPS_ADDR", defaultAddr)
	dataDir := envOr("OPS_DATA_DIR", defaultDataDir)
	healthURL := envOr("OPS_APP_HEALTH_URL", defaultHealthURL)
	// Only needed if builds are attached to GitHub Releases on a private
	// repo - see NewManager's doc comment. Empty is fine for a public one.
	downloadToken := os.Getenv("OPS_DOWNLOAD_TOKEN")

	// The launched app process inherits this daemon's own environment -
	// CHAT_JWT_SECRET, CHAT_USERNAMES_FILE, etc. are configured once, on
	// the ops daemon, not duplicated onto the app it manages.
	mgr, err := ops.NewManager(dataDir, healthURL, os.Environ(), ops.OSLauncher{}, downloadToken)
	if err != nil {
		log.Error("could not initialize ops manager", "err", err)
		os.Exit(1)
	}

	// Relaunch whatever this daemon last successfully deployed, if
	// anything - without this, every restart of paperkite-ops (a config
	// change needing `systemctl restart`, a crash-triggered auto-restart,
	// a reboot) silently kills chat-service-server and leaves it dead
	// until someone notices and fires a fresh /deploy by hand, all while
	// GET /version keeps reporting stale "running":true from disk. Runs
	// before the HTTP server starts accepting requests, so there's no
	// window where a real /deploy webhook could race it.
	//
	// A no-op if this daemon has never deployed anything (fresh state) -
	// OPS_INITIAL_BINARY below handles that first-ever-boot case instead.
	if state, ok := mgr.CurrentVersion(); ok {
		log.Info("resuming last deployed version", "version", state.Version, "path", state.BinaryPath)
		ctx, cancel := context.WithTimeout(context.Background(), deployTimeout)
		if err := mgr.Resume(ctx); err != nil {
			log.Error("resume failed - waiting for a real deploy instead", "err", err)
		} else {
			log.Info("resume succeeded", "version", state.Version)
		}
		cancel()
	} else if initialBin := os.Getenv("OPS_INITIAL_BINARY"); initialBin != "" {
		initialVersion := os.Getenv("OPS_INITIAL_VERSION")
		log.Info("bootstrapping initial binary", "version", initialVersion, "path", initialBin)
		ctx, cancel := context.WithTimeout(context.Background(), deployTimeout)
		if err := mgr.Bootstrap(ctx, initialVersion, initialBin); err != nil {
			log.Error("bootstrap failed - waiting for a real deploy instead", "err", err)
		} else {
			log.Info("bootstrap succeeded", "version", initialVersion)
		}
		cancel()
	}

	mux := http.NewServeMux()
	mux.Handle("POST /deploy", deployHandler(mgr, log))
	mux.Handle("GET /version", versionHandler(mgr))

	log.Info("ops daemon listening", "addr", addr, "app_health_url", healthURL)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Error("ops server error", "err", err)
		os.Exit(1)
	}
}

// deployHandler handles POST /deploy. The bearer token itself carries the
// deploy payload (source, buildVersion, builds) - see ops.DeployClaims -
// there is no separate request body to parse.
//
//	Authorization: Bearer <deploy JWT, signed with OPS_JWT_SECRET>
//
// Response (JSON):
//
//	200 {"status":"ok","version":"1.2.3"}
//	502 {"status":"failed","error":"...","rolled_back":true}
//
// A 502 with rolled_back:true means the new version never became
// healthy, but the previous one is back up and serving - the deploy
// failed, the server didn't. rolled_back:false means either this was a
// first-ever deploy with nothing to fall back to, or the rollback itself
// also failed (worth paging someone over).
func deployHandler(mgr *ops.Manager, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := bearerToken(r)
		if tok == "" {
			http.Error(w, "Authorization: Bearer <token> required", http.StatusUnauthorized)
			return
		}
		claims, err := ops.VerifyDeployToken(tok)
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		log.Info("deploy requested", "source", claims.Source, "version", claims.BuildVersion)

		ctx, cancel := context.WithTimeout(r.Context(), deployTimeout)
		defer cancel()

		result, err := mgr.Deploy(ctx, ops.DeployRequest{
			Source:       claims.Source,
			BuildVersion: claims.BuildVersion,
			LinuxURL:     claims.Builds["linux"],
		})

		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			log.Error("deploy failed", "err", err)
			var failure *ops.DeployFailure
			body := map[string]any{"status": "failed", "error": err.Error()}
			if errors.As(err, &failure) {
				body["rolled_back"] = failure.RolledBack
			}
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(body)
			return
		}

		log.Info("deploy succeeded", "version", result.Version)
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "version": result.Version})
	}
}

// versionHandler handles GET /version. Unauthenticated, like the app's
// own /healthz - which version is running isn't sensitive, and this stays
// trivially curl-able for a human checking on the server.
//
//	200 {"version":"1.2.3","running":true,"source":"github","deployed_at":"..."}
//	200 {"version":null,"running":false}   - nothing successfully deployed yet
func versionHandler(mgr *ops.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		state, ok := mgr.CurrentVersion()
		if !ok {
			json.NewEncoder(w).Encode(map[string]any{"version": nil, "running": false})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"version":     state.Version,
			"running":     true,
			"source":      state.Source,
			"deployed_at": state.DeployedAt,
		})
	}
}

func bearerToken(r *http.Request) string {
	after, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return ""
	}
	return strings.TrimSpace(after)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
