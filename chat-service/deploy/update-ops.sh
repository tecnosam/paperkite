#!/usr/bin/env bash
# Updates the ops daemon binary on THIS machine to a specific (or the
# latest) chat-service-v* release, stopping and restarting the systemd
# service around it. Run this ON the server, as root - systemctl only
# operates on local services, this can't update a remote box.
#
# This does NOT touch chat-service-server - that's what the normal
# /deploy webhook flow updates (see ../packaging/README.md). This script
# is only for the ops daemon itself, which has no self-update mechanism.
#
# Usage:
#   ./update-ops.sh                       # latest chat-service-v* release
#   ./update-ops.sh chat-service-v0.1.1   # a specific tag
#
# Or without a repo checkout at all:
#   curl -fsSL https://raw.githubusercontent.com/tecnosam/paperkite/main/chat-service/deploy/update-ops.sh | sudo bash
set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-tecnosam/paperkite}"
TAG="${1:-}"

case "$(uname -m)" in
  x86_64)  GOARCH=amd64 ;;
  aarch64) GOARCH=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

if [ -z "$TAG" ]; then
  # Same grep/sed lookup as setup-droplet.sh - duplicated rather than
  # shared, deliberately, so this script stays a single self-contained
  # file safe to curl and run directly with no repo checkout.
  echo "looking up the latest chat-service-v* release for ${GITHUB_REPO}..."
  TAG=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases" \
    | grep -o '"tag_name": *"chat-service-v[^"]*"' \
    | head -1 | sed 's/.*"\(chat-service-v[^"]*\)".*/\1/')
  if [ -z "$TAG" ]; then
    echo "could not find a chat-service-v* release for ${GITHUB_REPO}" >&2
    exit 1
  fi
fi
echo "updating ops to ${TAG}"

systemctl stop paperkite-ops
curl -fsSL -o /opt/paperkite/bin/ops \
  "https://github.com/${GITHUB_REPO}/releases/download/${TAG}/chat-service-ops-linux-${GOARCH}"
chmod +x /opt/paperkite/bin/ops
id -u paperkite &>/dev/null && chown paperkite:paperkite /opt/paperkite/bin/ops
systemctl start paperkite-ops

echo "ops updated to ${TAG} and restarted."
echo "check with: curl -s localhost:9090/version"
