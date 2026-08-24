#!/usr/bin/env bash
# Creates an annotated git tag "<prefix>-v<version>" at HEAD. Does NOT
# push it - the release workflows trigger on the tag being pushed, so
# that stays a deliberate, separate step you run yourself when you're
# actually ready to release.
#
# Usage: tag-release.sh <prefix> <version> [dir-to-check-for-uncommitted-changes]
set -euo pipefail

PREFIX="${1:?usage: tag-release.sh <prefix> <version> [dir]}"
VERSION="${2:?usage: tag-release.sh <prefix> <version> [dir]}"
CHECK_DIR="${3:-}"
TAG="${PREFIX}-v${VERSION}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "tag $TAG already exists" >&2
  exit 1
fi

if [ -n "$CHECK_DIR" ] && [ -n "$(git status --porcelain -- "$CHECK_DIR")" ]; then
  echo "error: $CHECK_DIR has uncommitted changes - refusing to tag." >&2
  echo "       commit the version bump first (e.g. git commit -am '$PREFIX: v$VERSION')," >&2
  echo "       or HEAD won't actually contain the version you're about to tag." >&2
  exit 1
fi

git tag -a "$TAG" -m "$PREFIX $VERSION"
echo "created tag $TAG"
echo ""
echo "push it to trigger the release workflow:"
echo "  git push origin $TAG"
