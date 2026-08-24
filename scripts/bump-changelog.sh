#!/usr/bin/env bash
# Stamps the [Unreleased] section of a Keep a Changelog file with a new
# dated version heading, then leaves a fresh empty [Unreleased] section
# above it. Everything that was under [Unreleased] becomes the new
# version's body.
#
# Usage: bump-changelog.sh <path-to-CHANGELOG.md> <new-version>
set -euo pipefail

FILE="${1:?usage: bump-changelog.sh <CHANGELOG.md> <version>}"
VERSION="${2:?usage: bump-changelog.sh <CHANGELOG.md> <version>}"
DATE="$(date +%Y-%m-%d)"

if [ ! -f "$FILE" ]; then
  echo "no changelog at $FILE" >&2
  exit 1
fi

if ! grep -q '^## \[Unreleased\]' "$FILE"; then
  echo "no [Unreleased] heading found in $FILE" >&2
  exit 1
fi

TMP="$(mktemp)"
awk -v version="$VERSION" -v date="$DATE" '
  /^## \[Unreleased\]/ && !stamped {
    print
    print ""
    print "## [" version "] - " date
    stamped = 1
    next
  }
  { print }
' "$FILE" > "$TMP"
mv "$TMP" "$FILE"

echo "stamped $VERSION into $FILE"
