#!/usr/bin/env bash
# Bumps a plain semver string stored in a VERSION file (used by projects
# with no package.json to hold a version, e.g. chat-service). JS projects
# use `npm version` directly instead, see browser/Makefile and
# website/Makefile.
#
# Usage: bump-version.sh <path-to-VERSION-file> <major|minor|patch>
# Prints the new version to stdout.
set -euo pipefail

FILE="${1:?usage: bump-version.sh <VERSION-file> <major|minor|patch>}"
PART="${2:?usage: bump-version.sh <VERSION-file> <major|minor|patch>}"

if [ ! -f "$FILE" ]; then
  echo "0.0.0" > "$FILE"
fi

CURRENT="$(tr -d '[:space:]' < "$FILE")"
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$PART" in
  major)
    MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1)); PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
  *)
    echo "unknown version part: $PART (expected major, minor, or patch)" >&2
    exit 1
    ;;
esac

NEW="$MAJOR.$MINOR.$PATCH"
echo "$NEW" > "$FILE"
echo "$NEW"
