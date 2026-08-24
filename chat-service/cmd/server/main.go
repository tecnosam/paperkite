package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	genpb "github.com/paperkite/chat-service/gen/chat"
	"github.com/paperkite/chat-service/internal/api"
	chatSvc "github.com/paperkite/chat-service/internal/chat"
	"github.com/paperkite/chat-service/internal/hub"
	"github.com/paperkite/chat-service/internal/metrics"
	"github.com/paperkite/chat-service/internal/sse"
	"github.com/paperkite/chat-service/internal/username"
	"golang.org/x/crypto/acme/autocert"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

const (
	grpcAddr = ":50051"
	httpAddr = ":8080"
	// tlsAddr is only ever bound if PUBLIC_HOSTNAME is set - see main().
	// :443 isn't a free choice: it's the fixed port Let's Encrypt's
	// TLS-ALPN-01 challenge validates against, not configurable.
	tlsAddr = ":443"

	// usernamesFile is the authoritative, append-only log of permanently
	// claimed usernames. Loaded on boot; every successful claim is appended
	// to it durably. Override with CHAT_USERNAMES_FILE.
	usernamesFile = "data/usernames.log"

	// roomsHLLFile and usersHLLFile persist the two HyperLogLog estimators
	// behind GET /custom-metrics (see internal/metrics), so a restart
	// doesn't reset the counts to zero. Loaded on boot, saved periodically
	// and once more on shutdown - see metricsPersistInterval. Override with
	// CHAT_ROOMS_HLL_FILE / CHAT_USERS_HLL_FILE.
	roomsHLLFile = "data/rooms.hll"
	usersHLLFile = "data/users.hll"

	// metricsPersistInterval bounds how much of the two estimators' state
	// a crash (as opposed to a graceful shutdown, which always saves once
	// more - see main()) could lose: at most this long since the last
	// periodic save.
	metricsPersistInterval = 30 * time.Second

	// autocertCacheDir is where obtained certificates are persisted so a
	// restart (or a deploy launching a new binary) doesn't force a fresh
	// Let's Encrypt request every time - relative to the process's working
	// directory (WorkingDirectory=/opt/paperkite in the ops systemd unit,
	// stable across deploys unlike the versioned binary path itself).
	// Override with AUTOCERT_CACHE_DIR.
	autocertCacheDir = "autocert-cache"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if os.Getenv("CHAT_JWT_SECRET") == "" {
		log.Error("CHAT_JWT_SECRET environment variable must be set")
		os.Exit(1)
	}

	h := hub.New()

	usernamesPath := usernamesFile
	if p := os.Getenv("CHAT_USERNAMES_FILE"); p != "" {
		usernamesPath = p
	}
	reg, err := username.New(usernamesPath)
	if err != nil {
		log.Error("could not initialize username registry", "err", err)
		os.Exit(1)
	}
	defer reg.Close()

	rec, err := metrics.NewRecorder(envOr("CHAT_ROOMS_HLL_FILE", roomsHLLFile), envOr("CHAT_USERS_HLL_FILE", usersHLLFile))
	if err != nil {
		log.Error("could not initialize metrics recorder", "err", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go h.StartGC(ctx, log)
	go rec.StartPersisting(ctx, metricsPersistInterval, log)

	grpcSrv := buildGRPC(h, log)
	mux := buildHTTP(h, reg, rec)
	httpSrv := &http.Server{Addr: httpAddr, Handler: mux}

	// PUBLIC_HOSTNAME is optional - unset (the default, e.g. local dev via
	// `make run`) means only plain :8080 runs, exactly as before this
	// existed. Set it to also bind :443 with a real, automatically-
	// obtained and renewed Let's Encrypt certificate for that hostname -
	// no reverse proxy, no manually-managed cert files. See
	// deploy/README.md's "Domain and TLS" section.
	var tlsSrv *http.Server
	if hostname := os.Getenv("PUBLIC_HOSTNAME"); hostname != "" {
		certManager := &autocert.Manager{
			Prompt:     autocert.AcceptTOS,
			HostPolicy: autocert.HostWhitelist(hostname),
			Cache:      autocert.DirCache(envOr("AUTOCERT_CACHE_DIR", autocertCacheDir)),
		}
		tlsSrv = &http.Server{
			Addr:      tlsAddr,
			Handler:   mux,
			TLSConfig: certManager.TLSConfig(),
		}
	}

	// gRPC and plain HTTP are core - either failing to bind is fatal, and
	// brings the whole process down below. TLS is best-effort: a bind
	// failure there (e.g. :443 already held by something else) logs and
	// leaves gRPC/HTTP running rather than taking the whole app out over
	// what's meant to be an optional extra listener.
	errCh := make(chan error, 2)
	go func() { errCh <- serveGRPC(grpcSrv, grpcAddr, log) }()
	go func() { errCh <- serveHTTP(httpSrv, log) }()
	if tlsSrv != nil {
		go func() {
			if err := serveTLS(tlsSrv, log); err != nil {
				log.Error("HTTPS server error - continuing without TLS", "err", err)
			}
		}()
	}

	select {
	case <-ctx.Done():
		log.Info("shutdown signal received")
		// Only on a deliberate shutdown signal (SIGTERM from the ops
		// daemon during a deploy, see cmd/ops) — a crash on the errCh
		// path below has no graceful moment to announce.
		broadcastRestartNotice(h, log)
	case err := <-errCh:
		log.Error("server error", "err", err)
	}

	grpcSrv.GracefulStop()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Error("HTTP shutdown error", "err", err)
	}
	if tlsSrv != nil {
		if err := tlsSrv.Shutdown(shutdownCtx); err != nil {
			log.Error("HTTPS shutdown error", "err", err)
		}
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// restartNoticeRetryAfter is what's promised in the broadcast payload and
// is only ever an estimate to the client — see PROTOCOL.md's "System
// messages" section. It does not itself delay anything here; cmd/ops is
// what actually controls how long the old process gets before this one's
// replacement is expected to be answering /healthz.
const restartNoticeRetryAfter = 5 * time.Second

// broadcastRestartNotice tells every connected client (over both /poll and
// /events, see hub.Broadcast) that the server is about to exit for a
// deploy, before actually starting the shutdown sequence below. See
// PROTOCOL.md's "System messages" section for the wire shape.
func broadcastRestartNotice(h *hub.Hub, log *slog.Logger) {
	payload, err := json.Marshal(struct {
		Event        string `json:"event"`
		RetryAfterMs int64  `json:"retry_after_ms"`
		Message      string `json:"message"`
	}{
		Event:        "restart",
		RetryAfterMs: restartNoticeRetryAfter.Milliseconds(),
		Message:      "Hey, I'm gone now, but I'll be back in 5 seconds.",
	})
	if err != nil {
		log.Error("could not build restart notice", "err", err)
		return
	}

	h.Broadcast(string(payload))
	log.Info("broadcast restart notice to active rooms", "rooms", len(h.Rooms()))

	// Give SSE subscriber goroutines a scheduling window to actually write
	// and flush this to their connections before the listeners below start
	// tearing down — http.Server.Shutdown waits for handlers to finish on
	// their own, it doesn't proactively push data through them, so without
	// this a subscriber's stream could just as easily be torn down before
	// its select loop ever ran again to notice the new message.
	time.Sleep(400 * time.Millisecond)
}

func buildGRPC(h *hub.Hub, log *slog.Logger) *grpc.Server {
	srv := grpc.NewServer(
		grpc.ChainUnaryInterceptor(loggingUnaryInterceptor(log)),
	)
	genpb.RegisterChatServer(srv, chatSvc.NewServer(h))
	reflection.Register(srv)
	return srv
}

// buildHTTP wires up the HTTP handlers, shared by both the plain :8080
// listener and the optional :443 TLS one (see main()) - same routes
// either way. Notably absent: any rate limiting. This server does none,
// and as currently deployed neither does anything in front of it - a
// deliberate simplification, not an oversight (see deploy/README.md's
// "Domain and TLS" section). If that ever needs revisiting, a starting
// point:
//
//	Expression:  (http.request.uri.path eq "/send" and http.request.method eq "POST")
//	Threshold:   60 requests per minute per IP
//	Action:      Block / Challenge
//	Fingerprint: IP address
//
// IP is the only fingerprint worth using here — session_id and username are
// both fully client-asserted (see PROTOCOL.md), so keying edge limits on
// either would let a client trivially reset its own budget.
func buildHTTP(h *hub.Hub, reg *username.Registry, rec *metrics.Recorder) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("POST /connect", api.ConnectHandler(h, reg, rec))
	mux.Handle("POST /send", api.SendHandler(h))
	mux.Handle("GET /poll", api.PollHandler(h))
	mux.Handle("GET /events", sse.Handler(h))
	mux.Handle("GET /custom-metrics", api.MetricsHandler(rec))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintln(w, "ok")
	})
	return mux
}

func serveGRPC(srv *grpc.Server, addr string, log *slog.Logger) error {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("gRPC listen: %w", err)
	}
	log.Info("gRPC server listening", "addr", addr)
	return srv.Serve(lis)
}

func serveHTTP(srv *http.Server, log *slog.Logger) error {
	log.Info("HTTP server listening", "addr", srv.Addr)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// serveTLS is only ever called when PUBLIC_HOSTNAME is set (see main()).
// Cert and key file arguments are empty on purpose: srv.TLSConfig's
// GetCertificate (wired up to autocert.Manager in main()) supplies them
// dynamically per handshake instead, obtaining and renewing them from
// Let's Encrypt automatically.
func serveTLS(srv *http.Server, log *slog.Logger) error {
	log.Info("HTTPS server listening", "addr", srv.Addr)
	if err := srv.ListenAndServeTLS("", ""); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func loggingUnaryInterceptor(log *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		start := time.Now()
		resp, err := handler(ctx, req)
		log.Info("gRPC call", "method", info.FullMethod, "duration", time.Since(start), "err", err)
		return resp, err
	}
}
