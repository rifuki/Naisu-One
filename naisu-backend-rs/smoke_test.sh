#!/usr/bin/env bash
# Phase 9 — Smoke Test for naisu-backend-rs
# Usage: ./smoke_test.sh [BASE_URL]
# Default BASE_URL: http://localhost:3001

BASE="${1:-http://localhost:3001}"
WS_BASE="${BASE/http/ws}"
PASS=0
FAIL=0
TEST_ADDR="0x0000000000000000000000000000000000000001"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ PASS${NC} — $1"; ((PASS++)); }
fail() { echo -e "${RED}❌ FAIL${NC} — $1"; ((FAIL++)); }
info() { echo -e "${YELLOW}ℹ️  $1${NC}"; }

check() {
  local name="$1"
  local expected_code="$2"
  local actual_code="$3"
  local body="$4"
  local required_key="$5"

  if [ "$actual_code" != "$expected_code" ]; then
    fail "$name (HTTP $actual_code, expected $expected_code)"
    echo "    Body: $body"
    return 1
  fi

  if [ -n "$required_key" ]; then
    if ! echo "$body" | grep -q "\"$required_key\""; then
      fail "$name (missing key: $required_key)"
      echo "    Body: $body"
      return 1
    fi
  fi

  pass "$name"
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Naisu Backend RS — Smoke Test"
echo "  Target: $BASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Health ─────────────────────────────────────────────────────────────────────
info "Testing health endpoints..."

RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" "$BASE/health")
BODY=$(cat /tmp/body.txt)
# Health returns {"message":"Service is healthy"} — check for "healthy" string
if [ "$RESP" = "200" ] && echo "$BODY" | grep -qi "healthy"; then
  pass "GET /health"
  ((PASS++))
else
  fail "GET /health (HTTP $RESP)"
  echo "    Body: $BODY"
  ((FAIL++))
fi

# ── Intent endpoints ───────────────────────────────────────────────────────────
info "Testing intent endpoints..."

RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" "$BASE/api/v1/intent/nonce?address=$TEST_ADDR")
BODY=$(cat /tmp/body.txt)
check "GET /intent/nonce (valid addr)" "200" "$RESP" "$BODY" "nonce"

RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" "$BASE/api/v1/intent/nonce?address=notanaddress")
BODY=$(cat /tmp/body.txt)
check "GET /intent/nonce (invalid addr → 400)" "400" "$RESP" "$BODY" ""

RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" "$BASE/api/v1/intent/orders?user=$TEST_ADDR")
BODY=$(cat /tmp/body.txt)
check "GET /intent/orders" "200" "$RESP" "$BODY" "orders"

RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" "$BASE/api/v1/intent/orderbook/stats")
BODY=$(cat /tmp/body.txt)
check "GET /intent/orderbook/stats" "200" "$RESP" "$BODY" "total"

PAYLOAD='{"senderAddress":"'$TEST_ADDR'","recipientAddress":"So11111111111111111111111111111111111111112","destinationChain":"solana","amount":"0.01"}'
RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$BASE/api/v1/intent/build-gasless")
BODY=$(cat /tmp/body.txt)
check "POST /intent/build-gasless (valid)" "200" "$RESP" "$BODY" "startPrice"

PAYLOAD='{"senderAddress":"notvalid","recipientAddress":"x","destinationChain":"solana","amount":"0.01"}'
RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$BASE/api/v1/intent/build-gasless")
BODY=$(cat /tmp/body.txt)
check "POST /intent/build-gasless (bad addr → 400)" "400" "$RESP" "$BODY" ""

PAYLOAD='{"senderAddress":"'$TEST_ADDR'","recipientAddress":"So11111111111111111111111111111111111111112","destinationChain":"solana","amount":"0"}'
RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$BASE/api/v1/intent/build-gasless")
BODY=$(cat /tmp/body.txt)
check "POST /intent/build-gasless (amount=0 → 400)" "400" "$RESP" "$BODY" ""

PAYLOAD='{
  "creator": "'$TEST_ADDR'",
  "recipient": "0x0000000000000000000000000000000000000000000000000000000000000001",
  "destinationChain": 1,
  "amount": "10000000000000000",
  "startPrice": "9000000000000000",
  "floorPrice": "8000000000000000",
  "deadline": 9999999999,
  "intentType": 0,
  "nonce": 0,
  "signature": "0x'$(printf '0%.0s' {1..130})'"
}'
RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$BASE/api/v1/intent/submit-signature")
BODY=$(cat /tmp/body.txt)
check "POST /intent/submit-signature (bad sig → 400)" "400" "$RESP" "$BODY" ""

RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" -X PATCH "$BASE/api/v1/intent/orders/0xdeadbeef/cancel")
BODY=$(cat /tmp/body.txt)
check "PATCH /intent/orders/:id/cancel (not found → 404)" "404" "$RESP" "$BODY" ""

# ── Solver REST endpoints ──────────────────────────────────────────────────────
info "Testing solver REST endpoints..."

RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" "$BASE/api/v1/solver/list")
BODY=$(cat /tmp/body.txt)
check "GET /solver/list" "200" "$RESP" "$BODY" "solvers"

RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" "$BASE/api/v1/solver/stats")
BODY=$(cat /tmp/body.txt)
check "GET /solver/stats" "200" "$RESP" "$BODY" "total"

# ── Solver WebSocket ───────────────────────────────────────────────────────────
info "Testing solver WebSocket..."

if command -v websocat &>/dev/null; then
  WS_MSG='{"type":"register","name":"smoke-test-solver","evmAddress":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","solanaAddress":"So11111111111111111111111111111111111111112","routes":["evm-base→solana"]}'
  # Send register msg, keep connection open 2s so response arrives, then close
  WS_RESP=$( (echo "$WS_MSG"; sleep 1) | websocat --exit-on-eof "$WS_BASE/api/v1/solver/ws" 2>/dev/null | head -1 )

  if echo "$WS_RESP" | grep -q '"registered"'; then
    pass "WS /solver/ws (register → received 'registered')"
  else
    fail "WS /solver/ws (unexpected response or timeout)"
    echo "    Response: $WS_RESP"
  fi
else
  info "WS /solver/ws — SKIPPED (websocat not found)"
fi

# ── SSE ────────────────────────────────────────────────────────────────────────
info "Testing SSE stream..."

SSE_BODY=$(curl -s --max-time 3 -N -H "Accept: text/event-stream" "$BASE/api/v1/intent/watch?user=$TEST_ADDR" 2>/dev/null)
if echo "$SSE_BODY" | grep -q "event:"; then
  pass "GET /intent/watch (SSE stream opens + sends event)"
else
  fail "GET /intent/watch (no SSE event received in 3s)"
  echo "    Body: $SSE_BODY"
fi

# ── 404 fallback ───────────────────────────────────────────────────────────────
RESP=$(curl -s -o /tmp/body.txt -w "%{http_code}" "$BASE/api/v1/does-not-exist")
BODY=$(cat /tmp/body.txt)
check "GET /nonexistent (→ 404)" "404" "$RESP" "$BODY" ""

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS + FAIL))
echo -e "  Results: ${GREEN}${PASS} passed${NC} / ${RED}${FAIL} failed${NC} / ${TOTAL} total"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
