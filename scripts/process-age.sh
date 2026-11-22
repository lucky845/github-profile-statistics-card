#!/usr/bin/env bash
#
# The end-to-end half of the process-age check.
#
# /livez and /health publish the age of the process, measured from the kernel's start
# time. The unit test in tests/live_diagnostics.rs cannot tell that apart from a stopwatch
# started by the *first probe*: both sit at or above the test's own reference reading, so
# both pass. The distinction only shows up across a process boundary, where the answer can
# be compared against a wait the observer controls.
#
# The shape of this script is the check:
#
#   1. start the binary and wait for the port to accept a TCP connection -- no HTTP yet,
#      because a readiness poll on /livez would itself be the first probe and would hand a
#      stopwatch implementation the early start it needs to look truthful;
#   2. stay silent for WAIT_SECONDS;
#   3. ask /livez exactly once and require uptime >= WAIT_SECONDS.
#
# Step 3 is the assertion a first-probe stopwatch fails: it would answer 0, not 5.
#
# Usage: APP_BIN=target/release/app ./scripts/process-age.sh
#        WAIT_SECONDS=8 PORT=8090 ./scripts/process-age.sh

set -uo pipefail

APP_BIN="${APP_BIN:-target/release/app}"
WAIT_SECONDS="${WAIT_SECONDS:-5}"
PORT="${PORT:-8090}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

if [ ! -x "$APP_BIN" ]; then
  echo "::error::no executable at $APP_BIN"
  exit 1
fi

# A template, not `mktemp -t process-age`: BSD mktemp accepts a bare prefix there, GNU
# mktemp rejects it with "too few X's in template". The template form works on both.
LOG="$(mktemp "${TMPDIR:-/tmp}/process-age.XXXXXX")"
APP_PID=""
cleanup() {
  if [ -n "$APP_PID" ]; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  rm -f "$LOG"
}
trap cleanup EXIT

PORT="$PORT" "$APP_BIN" > "$LOG" 2>&1 &
APP_PID=$!
echo "[process-age] started pid $APP_PID on port $PORT"

# A bare TCP connect. No HTTP request goes out, so no handler runs and no probe is recorded.
listening=0
for _ in $(seq 1 60); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    # Give the socket back; leaving the descriptor open would hold a connection slot.
    exec 3<&- 3>&- 2>/dev/null || true
    listening=1
    break
  fi
  sleep 1
done

if [ "$listening" != "1" ]; then
  echo "::error::the port never accepted a connection"
  echo "--- server log ---"
  cat "$LOG" 2>/dev/null || true
  exit 1
fi

echo "[process-age] port is up; staying silent for ${WAIT_SECONDS}s before the first request"
sleep "$WAIT_SECONDS"

probe() {
  curl -fsS -m 10 "http://127.0.0.1:$PORT$1" 2>/dev/null
}

# The first HTTP request this process ever answers is the one measured below.
LIVEZ="$(probe /livez)"
if [ -z "$LIVEZ" ]; then
  echo "::error::/livez did not answer"
  cat "$LOG" 2>/dev/null || true
  exit 1
fi

HEALTH="$(probe /health)"
echo "[process-age] /livez  $LIVEZ"
echo "[process-age] /health $HEALTH"

number_at() {
  # The first "name":<digits> in the payload, as a bare number.
  printf '%s' "$1" | grep -o "\"$2\":[0-9]*" | head -n 1 | cut -d: -f2
}

LIVEZ_AGE="$(number_at "$LIVEZ" uptime)"
HEALTH_AGE="$(number_at "$HEALTH" uptime)"

if [ -z "$LIVEZ_AGE" ]; then
  echo "::error::/livez carried no numeric uptime"
  exit 1
fi

if [ "$LIVEZ_AGE" -lt "$WAIT_SECONDS" ]; then
  echo "::error::uptime ${LIVEZ_AGE}s is below the ${WAIT_SECONDS}s this script waited; the stopwatch starts at the first probe"
  exit 1
fi

if [ -z "$HEALTH_AGE" ]; then
  echo "::error::/health carried no numeric uptime"
  exit 1
fi

if [ "$HEALTH_AGE" -lt "$WAIT_SECONDS" ]; then
  echo "::error::/health uptime ${HEALTH_AGE}s is below the ${WAIT_SECONDS}s this script waited"
  exit 1
fi

# Both endpoints read the same kernel value, so a second-granularity allowance covers the
# two reads landing either side of a tick.
difference=$((LIVEZ_AGE - HEALTH_AGE))
if [ "$difference" -lt 0 ]; then
  difference=$((-difference))
fi
if [ "$difference" -gt 1 ]; then
  echo "::error::/livez says ${LIVEZ_AGE}s and /health says ${HEALTH_AGE}s"
  exit 1
fi

echo "[ok] the process reported ${LIVEZ_AGE}s of age after ${WAIT_SECONDS}s of silence."
