#!/usr/bin/env bash
# Smoke-tests the live HTTP server.
# Usage:  ./test/smoke.sh [base_url]
# Default base_url: http://localhost:8080

set -euo pipefail

BASE="${1:-http://localhost:8080}"
PASS=0
FAIL=0

green() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
red()   { printf '\033[31m✗ %s\033[0m\n' "$*"; }

check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    green "$label"
    (( PASS++ )) || true
  else
    red "$label (expected '$expected', got '$actual')"
    (( FAIL++ )) || true
  fi
}

# ── healthz ────────────────────────────────────────────────────────────────────

STATUS=$(curl -so /dev/null -w '%{http_code}' "$BASE/healthz")
check "GET /healthz → 200" "200" "$STATUS"

# ── connect ────────────────────────────────────────────────────────────────────

CONN=$(curl -sf -X POST "$BASE/connect" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/","username":"alice","browser":"Chrome/120","session_id":"smoke-s1","region":"us-east"}')

TOKEN=$(printf '%s' "$CONN" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
CURSOR=$(printf '%s' "$CONN" | python3 -c "import sys,json; print(json.load(sys.stdin)['cursor'])")

[[ -n "$TOKEN" ]]  && green "POST /connect → token present"  || { red "POST /connect → no token";  (( FAIL++ )) || true; }
[[ -n "$CURSOR" ]] && green "POST /connect → cursor present" || { red "POST /connect → no cursor"; (( FAIL++ )) || true; }

# ── connect — missing fields ───────────────────────────────────────────────────

STATUS=$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/connect" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/"}')
check "POST /connect missing fields → 400" "400" "$STATUS"

# ── poll — empty room returns 304 ─────────────────────────────────────────────

STATUS=$(curl -so /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/poll?cursor=$CURSOR")
check "GET /poll empty room → 304" "304" "$STATUS"

# ── poll — ETag and X-Next-Poll-Ms present on 304 ────────────────────────────

HEADERS=$(curl -sI \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/poll?cursor=$CURSOR")

ETAG=$(printf '%s' "$HEADERS" | grep -i '^etag:' | tr -d '\r')
HINT=$(printf '%s' "$HEADERS" | grep -i '^x-next-poll-ms:' | tr -d '\r')

[[ -n "$ETAG" ]] && green "304 response has ETag header"         || { red "304 missing ETag";         (( FAIL++ )) || true; }
[[ -n "$HINT" ]] && green "304 response has X-Next-Poll-Ms header" || { red "304 missing X-Next-Poll-Ms"; (( FAIL++ )) || true; }

# ── send ───────────────────────────────────────────────────────────────────────

SEND=$(curl -sf -X POST "$BASE/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"content":"hello smoke test"}')

MSG_ID=$(printf '%s' "$SEND" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
[[ -n "$MSG_ID" ]] && green "POST /send → message id present" || { red "POST /send → no id"; (( FAIL++ )) || true; }

# ── poll — 200 after send ─────────────────────────────────────────────────────

POLL=$(curl -sf \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/poll?cursor=$CURSOR")

POLL_STATUS=$(curl -so /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/poll?cursor=$CURSOR")
check "GET /poll after send → 200" "200" "$POLL_STATUS"

MSG_COUNT=$(printf '%s' "$POLL" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['messages']))")
check "poll body has 1 message" "1" "$MSG_COUNT"

MSG_CONTENT=$(printf '%s' "$POLL" | python3 -c "import sys,json; print(json.load(sys.stdin)['messages'][0]['content'])")
check "message content correct" "hello smoke test" "$MSG_CONTENT"

NEXT_CURSOR=$(printf '%s' "$POLL" | python3 -c "import sys,json; print(json.load(sys.stdin)['cursor'])")
NEXT_POLL_MS=$(printf '%s' "$POLL" | python3 -c "import sys,json; print(json.load(sys.stdin)['next_poll_ms'])")
[[ "$NEXT_CURSOR" -gt "$CURSOR" ]] && green "cursor advanced after message" || { red "cursor did not advance"; (( FAIL++ )) || true; }
[[ "$NEXT_POLL_MS" -gt 0 ]]        && green "next_poll_ms present in body"  || { red "next_poll_ms missing";   (( FAIL++ )) || true; }

# ── poll — 304 after cursor advance ──────────────────────────────────────────

STATUS=$(curl -so /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/poll?cursor=$NEXT_CURSOR")
check "GET /poll with advanced cursor → 304" "304" "$STATUS"

# ── send — invalid token ───────────────────────────────────────────────────────

STATUS=$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/send" \
  -H 'Authorization: Bearer not.a.real.token' \
  -H 'Content-Type: application/json' \
  -d '{"content":"hack"}')
check "POST /send invalid token → 401" "401" "$STATUS"

# ── send — empty content ──────────────────────────────────────────────────────

STATUS=$(curl -so /dev/null -w '%{http_code}' -X POST "$BASE/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"content":""}')
check "POST /send empty content → 400" "400" "$STATUS"

# ── poll — missing token ──────────────────────────────────────────────────────

STATUS=$(curl -so /dev/null -w '%{http_code}' "$BASE/poll?cursor=0")
check "GET /poll no token → 401" "401" "$STATUS"

# ── room isolation ────────────────────────────────────────────────────────────

CONN_B=$(curl -sf -X POST "$BASE/connect" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://other.example.com/","username":"bob","browser":"Firefox/120","session_id":"smoke-s2","region":"us-east"}')

TOKEN_B=$(printf '%s' "$CONN_B" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
CURSOR_B=$(printf '%s' "$CONN_B" | python3 -c "import sys,json; print(json.load(sys.stdin)['cursor'])")

curl -sf -X POST "$BASE/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"content":"room A only"}' > /dev/null

STATUS_B=$(curl -so /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN_B" \
  "$BASE/poll?cursor=$CURSOR_B")
check "room B does not receive room A message → 304" "304" "$STATUS_B"

# ── summary ───────────────────────────────────────────────────────────────────

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
