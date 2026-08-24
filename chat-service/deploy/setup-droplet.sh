#!/usr/bin/env bash
# DigitalOcean droplet first-boot setup for the Paperkite chat-service ops
# daemon (see ../packaging/README.md's "Auto-deploy via the ops daemon").
#
# Usage: paste this file as-is into the droplet's "User Data" field
# (Create Droplet -> Advanced Options -> User Data) - no editing required.
# DigitalOcean runs it once, automatically, as root, on first boot via
# cloud-init. You can also run it by hand over SSH on an already-running
# droplet (still as root) - re-running is safe (see below).
#
# Secrets (CHAT_JWT_SECRET, OPS_JWT_SECRET): if set as environment
# variables when this runs, those values are used - e.g.
# `CHAT_JWT_SECRET=... OPS_JWT_SECRET=... ./setup-droplet.sh` over SSH, or
# your own wrapper around User Data if your tooling supports injecting
# env vars into it. Otherwise this generates its own (openssl rand), and
# prints them at the end - check the droplet's cloud-init log
# (`cat /var/log/cloud-init-output.log`) or the "Droplet Console" in the
# DigitalOcean dashboard if you pasted this as User Data and need to
# retrieve them after the fact. Either way, copy OPS_JWT_SECRET into this
# repo's GitHub secret of the same name - it has to match exactly for the
# deploy webhook to work.
#
# Re-running this script (e.g. to pick up a newer release manually)
# reuses whatever secrets are already in /etc/paperkite/ops.env rather
# than generating new ones - so it won't silently invalidate a
# OPS_JWT_SECRET you've already put in GitHub. Override GITHUB_REPO the
# same way if you're running this against a fork.
#
# What it does: creates an unprivileged `paperkite` user, downloads the
# latest ops daemon AND chat-service-server binaries from this repo's
# chat-service-v* GitHub Releases, installs the ops daemon as a systemd
# service, and starts it. On that first start, the ops daemon adopts the
# already-downloaded server binary as its initial running version (see
# OPS_INITIAL_BINARY below and Manager.Bootstrap in internal/ops) - so
# this script ends with BOTH processes actually running, not just ops
# waiting on a webhook.
#
# The server binary is deliberately not started as its own separate
# systemd service - it's the ops daemon's job to launch and own that
# process (as a child of itself), so that a *later* real /deploy webhook
# can find and terminate it cleanly instead of racing an independently-
# started process for the same ports. Future deploys (push a
# chat-service-v* tag with OPS_WEBHOOK_URL configured, or POST to
# :9090/deploy by hand) replace this bootstrapped version normally - see
# ../packaging/README.md.
set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-tecnosam/paperkite}"
ENV_FILE=/etc/paperkite/ops.env

# Prints the current value of key in ENV_FILE, if it exists - used below
# so re-running this script reuses secrets from a prior run instead of
# generating new ones every time.
existing_value() {
  [ -f "$ENV_FILE" ] && grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- || true
}

CHAT_JWT_SECRET="${CHAT_JWT_SECRET:-$(existing_value CHAT_JWT_SECRET)}"
OPS_JWT_SECRET="${OPS_JWT_SECRET:-$(existing_value OPS_JWT_SECRET)}"

# Same reuse-from-a-prior-run pattern as the secrets above - otherwise
# these get silently wiped on every re-run, since the ops.env heredoc
# below always rewrites the whole file from scratch. Both are normally
# set by hand after the fact (see deploy/README.md's "Domain and TLS"
# section), not by this script, so there's no equivalent of
# GENERATED_CHAT_SECRET here - empty just means "not configured yet",
# same as if this script had never touched them.
PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-$(existing_value PUBLIC_HOSTNAME)}"
AUTOCERT_CACHE_DIR="${AUTOCERT_CACHE_DIR:-$(existing_value AUTOCERT_CACHE_DIR)}"

GENERATED_CHAT_SECRET=0
GENERATED_OPS_SECRET=0
if [ -z "$CHAT_JWT_SECRET" ]; then
  CHAT_JWT_SECRET="$(openssl rand -hex 32)"
  GENERATED_CHAT_SECRET=1
fi
if [ -z "$OPS_JWT_SECRET" ]; then
  OPS_JWT_SECRET="$(openssl rand -hex 32)"
  GENERATED_OPS_SECRET=1
fi

case "$(uname -m)" in
  x86_64)  GOARCH=amd64 ;;
  aarch64) GOARCH=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

id -u paperkite &>/dev/null || useradd --system --create-home --home-dir /opt/paperkite --shell /usr/sbin/nologin paperkite

mkdir -p /opt/paperkite/bin /opt/paperkite/data /etc/paperkite
chown -R paperkite:paperkite /opt/paperkite

# Simple grep/sed parse rather than requiring jq - GitHub's JSON key
# ordering is consistent in practice, this is the same pattern most
# shell-based GitHub release installers use. /releases (not /latest)
# because /latest is the single most recent release across ALL of this
# repo's tags (browser-v*, chat-service-v*, website-v* interleaved), not
# scoped to this component - the first chat-service-v* match in the full
# list (returned newest-first) is what we actually want.
echo "looking up the latest chat-service-v* release for ${GITHUB_REPO}..."
LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases" \
  | grep -o '"tag_name": *"chat-service-v[^"]*"' \
  | head -1 | sed 's/.*"\(chat-service-v[^"]*\)".*/\1/')

if [ -z "$LATEST_TAG" ]; then
  echo "could not find a chat-service-v* release for ${GITHUB_REPO} - has one been published yet?" >&2
  exit 1
fi
echo "found ${LATEST_TAG}"

VERSION="${LATEST_TAG#chat-service-v}"

curl -fsSL -o /opt/paperkite/bin/ops \
  "https://github.com/${GITHUB_REPO}/releases/download/${LATEST_TAG}/chat-service-ops-linux-${GOARCH}"
chmod +x /opt/paperkite/bin/ops

# Staged for the ops daemon to adopt on its first start (OPS_INITIAL_BINARY
# below) - not started directly, and not the path it'll actually run from
# long-term. Manager.Bootstrap copies it into OPS_DATA_DIR/bin/ under its
# own naming convention, so this staged copy is disposable once that's
# happened; left here untouched otherwise.
curl -fsSL -o /opt/paperkite/bin/chat-service-server-initial \
  "https://github.com/${GITHUB_REPO}/releases/download/${LATEST_TAG}/chat-service-server-linux-${GOARCH}"
chmod +x /opt/paperkite/bin/chat-service-server-initial

chown -R paperkite:paperkite /opt/paperkite/bin

cat > /etc/paperkite/ops.env << EOF
OPS_JWT_SECRET=${OPS_JWT_SECRET}
CHAT_JWT_SECRET=${CHAT_JWT_SECRET}
CHAT_USERNAMES_FILE=/opt/paperkite/data/usernames.log
OPS_DATA_DIR=/opt/paperkite/data
OPS_ADDR=:9090
OPS_APP_HEALTH_URL=http://localhost:8080/healthz
OPS_INITIAL_BINARY=/opt/paperkite/bin/chat-service-server-initial
OPS_INITIAL_VERSION=${VERSION}
PUBLIC_HOSTNAME=${PUBLIC_HOSTNAME}
AUTOCERT_CACHE_DIR=${AUTOCERT_CACHE_DIR}
EOF
chmod 600 /etc/paperkite/ops.env
chown paperkite:paperkite /etc/paperkite/ops.env

cat > /etc/systemd/system/paperkite-ops.service << 'UNIT'
[Unit]
Description=Paperkite ops daemon (chat-service deploy webhook + process supervisor)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=paperkite
Group=paperkite
WorkingDirectory=/opt/paperkite
EnvironmentFile=/etc/paperkite/ops.env
ExecStart=/opt/paperkite/bin/ops
Restart=on-failure
RestartSec=5
KillMode=control-group
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/paperkite
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now paperkite-ops

echo "paperkite-ops is installed and running (systemctl status paperkite-ops)."
echo "it bootstraps chat-service-server ${VERSION} on its own within ~10-15s of"
echo "starting - check with: curl -s localhost:9090/version"
echo "and:                   curl -s localhost:8080/healthz"
echo "future updates: push a chat-service-v* tag (with OPS_WEBHOOK_URL"
echo "configured on GitHub) or POST to :9090/deploy by hand."

if [ "$GENERATED_CHAT_SECRET" = "1" ] || [ "$GENERATED_OPS_SECRET" = "1" ]; then
  echo ""
  echo "=================================================================="
  echo "Generated secret(s) - not shown again after this run, but also"
  echo "saved in ${ENV_FILE} (root-readable only):"
  [ "$GENERATED_CHAT_SECRET" = "1" ] && echo "  CHAT_JWT_SECRET=${CHAT_JWT_SECRET}"
  [ "$GENERATED_OPS_SECRET" = "1" ] && echo "  OPS_JWT_SECRET=${OPS_JWT_SECRET}"
  echo ""
  if [ "$GENERATED_OPS_SECRET" = "1" ]; then
    echo "Copy OPS_JWT_SECRET into this repo's GitHub secret of the same"
    echo "name now (Settings -> Secrets and variables -> Actions) - it has"
    echo "to match exactly for the deploy webhook to work."
  fi
  echo "=================================================================="
fi
