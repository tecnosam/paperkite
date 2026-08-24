# Packaging

`.github/workflows/release-chat-service.yml` (at the repo root) builds
and publishes two things whenever a `chat-service-v*` tag is pushed:

1. Cross-compiled binaries for linux/darwin/windows (amd64 + arm64),
   attached to a GitHub Release along with a `checksums.txt`.
2. A multi-arch (linux/amd64, linux/arm64) Docker image, pushed to
   `ghcr.io/<owner>/paperkite-chat-service`, tagged both `:<version>` and
   `:latest`.

No signing, no external package registry, no provisioned server, just
GitHub Releases and GitHub Container Registry, both built into GitHub.

## Running a release binary

```bash
# pick the file matching your OS/arch from the release page, then:
chmod +x chat-service-server-linux-amd64
CHAT_JWT_SECRET=... ./chat-service-server-linux-amd64
```

## Running the Docker image

```bash
docker run -p 8080:8080 -p 50051:50051 \
  -e CHAT_JWT_SECRET=... \
  -v paperkite-data:/app/data \
  ghcr.io/<owner>/paperkite-chat-service:latest
```

The `-v` mount is optional but keeps the claimed-usernames log
(`internal/username`) across container restarts, without it a new
container starts with an empty claims registry.

**One manual step**: a package pushed to GHCR via the default
`GITHUB_TOKEN` is private by default. To let people `docker pull` it
without authenticating, go to the package's settings on GitHub
(Packages tab → paperkite-chat-service → Package settings) and change
its visibility to public. This only needs doing once, it isn't reset on
subsequent pushes.

## Auto-deploy via the ops daemon

If you're running your own server long-term (see "Private servers" in
the top-level README), `cmd/ops` is a separate daemon that turns a
release into a live deploy automatically: it receives a signed webhook
from CI, downloads the new linux binary, swaps it in for the running
app, health-checks it, and rolls back if it doesn't come up clean. See
`internal/ops`'s package doc and `PROTOCOL.md`'s "System messages"
section (the app broadcasts a restart warning to connected clients right
before the ops daemon's SIGTERM takes it down).

**On your server**, run the ops daemon instead of the app directly - it
launches and manages the app itself:

```bash
OPS_JWT_SECRET=<a long random secret, different from CHAT_JWT_SECRET> \
CHAT_JWT_SECRET=... \
CHAT_USERNAMES_FILE=/var/lib/paperkite/usernames.log \
make run-ops
```

(or `go build -o /usr/local/bin/paperkite-ops ./cmd/ops` and run that
under systemd/whatever you use to keep a process alive - the ops daemon
itself has no supervisor of its own, only the app process it manages).

Deploying to a DigitalOcean droplet specifically? See
[`../deploy/`](../deploy) for a ready-made systemd unit and a first-boot
setup script that installs and starts it automatically, no manual `go
build` required.

The ops daemon listens on `:9090` by default (`OPS_ADDR` to change it), and expects
the app's `/healthz` at `http://localhost:8080/healthz` by default
(`OPS_APP_HEALTH_URL` to change it). `OPS_DATA_DIR` (default `ops-data`)
is where it keeps downloaded binaries and `state.json`.

**On GitHub**, add two repo settings (Settings -> Secrets and variables
-> Actions):

- Variable `OPS_WEBHOOK_URL`: your ops daemon's address, e.g.
  `https://ops.your-server.example` - not a secret, but the
  `notify-ops` job in `release-chat-service.yml` is entirely skipped
  unless this is set, so nothing tries to deploy anywhere until you
  configure it.
- Secret `OPS_JWT_SECRET`: must match what you set on the server above.

**If your repo is private**, the ops daemon's plain download request
will 401 against the release asset URL - GitHub Release assets on
private repos need an authenticated request. Set `OPS_DOWNLOAD_TOKEN` on
the ops daemon to a token with `repo` read access (e.g. a fine-grained
PAT) and it's sent as a bearer token on the download. Public repos don't
need this at all.

To fire a deploy by hand (e.g. testing the ops daemon without cutting a
real release):

```bash
TOKEN=$(OPS_JWT_SECRET=... go run ./cmd/deploytoken -version 1.2.3 -linux "https://.../chat-service-server-linux-amd64")
curl -X POST https://ops.your-server.example/deploy -H "Authorization: Bearer $TOKEN"
curl https://ops.your-server.example/version
```

## What's not here

No `apt`/`dnf` repository for the raw binaries, that needs a signed,
indexed repository hosted somewhere (GitHub Pages + `reprepro`/`aptly`,
or a host like Cloudsmith), which is real infrastructure to provision and
maintain. The Docker image is the lower-effort path to a "package
manager"-style install in the meantime: `docker pull` instead of `apt
install`.
