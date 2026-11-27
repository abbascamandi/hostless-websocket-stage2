#!/bin/sh
set -eu

# Required public VLESS credentials. Keep these in Hostless environment variables,
# never in the Git repository.
: "${VLESS_UUID:?Set VLESS_UUID in Hostless environment variables.}"
: "${WS_PATH:?Set WS_PATH in Hostless environment variables.}"

export PORT="${PORT:-8080}"
export AETHER_SOCKS="${AETHER_SOCKS:-127.0.0.1:1819}"
export AETHER_CONFIG="${AETHER_CONFIG:-/tmp/aether.toml}"
export AETHER_MASQUE_CONFIG="${AETHER_MASQUE_CONFIG:-/tmp/aether-masque.toml}"
export XRAY_LOCAL_PORT="${XRAY_LOCAL_PORT:-10000}"
export XRAY_CONFIG_FILE="${XRAY_CONFIG_FILE:-/tmp/xray-config.json}"

# This is a disposable test deployment: Aether identity/config files are stored
# in Hostless's writable temporary filesystem. They are lost when the app process
# starts again, so avoid unnecessary restarts or redeploys during testing.
mkdir -p /tmp
if [ ! -w /tmp ]; then
  echo '[stage-3] ERROR: /tmp is not writable.' >&2
  exit 1
fi
echo '[stage-3] Temporary mode: Aether identity is stored under /tmp (not persistent).'

rm -f /tmp/aether-ready /tmp/xray-ready

GATEWAY_PID=0
AETHER_PID=0
XRAY_PID=0
cleanup() {
  set +e
  [ "$XRAY_PID" -eq 0 ] || kill "$XRAY_PID" 2>/dev/null
  [ "$AETHER_PID" -eq 0 ] || kill "$AETHER_PID" 2>/dev/null
  [ "$GATEWAY_PID" -eq 0 ] || kill "$GATEWAY_PID" 2>/dev/null
  [ "$XRAY_PID" -eq 0 ] || wait "$XRAY_PID" 2>/dev/null
  [ "$AETHER_PID" -eq 0 ] || wait "$AETHER_PID" 2>/dev/null
  [ "$GATEWAY_PID" -eq 0 ] || wait "$GATEWAY_PID" 2>/dev/null
}
trap cleanup EXIT
trap 'exit 0' INT TERM

echo '[stage-3] Starting public HTTP/health and WebSocket gateway.'
node /app/server.js &
GATEWAY_PID=$!
sleep 1
if ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
  echo '[stage-3] ERROR: gateway failed to start.' >&2
  exit 1
fi

echo '[stage-3] Starting Aether (MASQUE over HTTP/2 / TCP).'
aether \
  --masque \
  --h2 \
  --scan "$AETHER_SCAN" \
  --noize "$AETHER_NOIZE" \
  --quick-reconnect \
  --bind "$AETHER_SOCKS" &
AETHER_PID=$!

attempt=0
max_attempts=120
while [ "$attempt" -lt "$max_attempts" ]; do
  if ! kill -0 "$AETHER_PID" 2>/dev/null; then
    echo '[stage-3] ERROR: Aether exited before WARP became ready.' >&2
    exit 1
  fi

  TRACE="$(curl --silent --show-error --fail \
    --socks5-hostname 127.0.0.1:1819 \
    --connect-timeout 3 --max-time 8 \
    https://www.cloudflare.com/cdn-cgi/trace 2>/dev/null || true)"

  if printf '%s\n' "$TRACE" | grep -q '^warp=on$'; then
    echo '[stage-3] SUCCESS: Aether data path verified (warp=on).'
    printf '%s\n' "$TRACE" | grep -E '^(warp|colo|ip)=' || true
    touch /tmp/aether-ready
    break
  fi

  attempt=$((attempt + 1))
  sleep 2
done

if [ ! -f /tmp/aether-ready ]; then
  echo '[stage-3] ERROR: WARP did not become ready within the startup window.' >&2
  exit 1
fi

echo '[stage-3] Generating the private Xray VLESS/WebSocket configuration.'
node /app/generate-config.js

 echo '[stage-3] Validating Xray configuration.'
/usr/local/bin/xray run -test -config "$XRAY_CONFIG_FILE"

echo '[stage-3] Starting Xray; its outbound is Aether SOCKS5 at 127.0.0.1:1819.'
/usr/local/bin/xray run -config "$XRAY_CONFIG_FILE" &
XRAY_PID=$!

node /app/wait-port.js 127.0.0.1 "$XRAY_LOCAL_PORT" 30000
touch /tmp/xray-ready

echo '[stage-3] READY: VLESS over WebSocket is available through the Hostless App HTTPS endpoint.'
echo '[stage-3] The Xray inbound and Aether SOCKS5 listener are localhost-only.'

# Keep the supervisor alive. If any service exits, fail the container so Hostless
# can restart the complete stack rather than leaving a half-working endpoint.
while :; do
  if ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
    echo '[stage-3] ERROR: public gateway stopped.' >&2
    exit 1
  fi
  if ! kill -0 "$AETHER_PID" 2>/dev/null; then
    echo '[stage-3] ERROR: Aether stopped.' >&2
    exit 1
  fi
  if ! kill -0 "$XRAY_PID" 2>/dev/null; then
    echo '[stage-3] ERROR: Xray stopped.' >&2
    exit 1
  fi
  sleep 5
done
