#!/usr/bin/env bash
# Live check for the Rust voice worker.
#
# Borrows one worker's Discord token, runs the Rust worker in its place,
# verifies login, guild binding, heartbeat, playback, and memory, then
# restores the original worker.
#
# usage: scripts/verify-rust-worker.sh <worker-number>
# example: scripts/verify-rust-worker.sh 2
#
# Requires: podman, ssh access to the stack host, and the worker's
# .env.voice-<n> file in deploy/podman on that host.

set -euo pipefail

N="${1:-}"
if ! [[ "${N}" =~ ^[1-9][0-9]*$ ]]; then
  echo "usage: $0 <worker-number>" >&2
  exit 1
fi

REMOTE="${REMOTE:-root@192.168.1.3}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/siela_podman_ed25519}"
if [ "${REMOTE}" = "local" ]; then
  # Running on the stack host already; skip the SSH hop.
  SSH=(bash -c)
else
  SSH=(ssh -i "${SSH_KEY}" "${REMOTE}")
fi
REPO="${REPO:-/root/siela-nogseuui-seobeo-bot}"
WORKER="siela-voice-${N}"
IMAGE="${IMAGE:-localhost/siela-voice-worker:latest}"
TEST_CONTAINER="siela-voice-${N}-rust"

if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "=== skipping image build (SKIP_BUILD=1) ==="
else
  echo "=== building the Rust worker image on the host ==="
  "${SSH[@]}" "cd ${REPO} && podman build -q -f apps/voice-worker/Containerfile -t ${IMAGE} ." >/dev/null
fi

echo "=== reading the token and guild for ${WORKER} ==="
read_env() {
  local file="$1" key="$2"
  "${SSH[@]}" "sed -n 's/^${key}=//p' '$file' | tail -1 | tr -d '\r' | sed 's/^\"//; s/\"\$//'"
}

TOKEN=$(read_env "${REPO}/deploy/podman/.env.voice-${N}" "DISCORD_TOKEN")
GUILD=$(read_env "${REPO}/deploy/podman/.env" "GUILD_ID")
MCP=$(read_env "${REPO}/deploy/podman/.env" "MCP_TOKEN")

if [ -z "${TOKEN}" ] || [ -z "${MCP}" ]; then
  echo "missing token or MCP_TOKEN in deploy/podman" >&2
  exit 1
fi

# Pick a voice channel from the guild unless one is provided.
VOICE_CHANNEL_ID="${VOICE_CHANNEL_ID:-}"
if [ -z "${VOICE_CHANNEL_ID}" ]; then
  # Pass the values as argv, not through a quoted heredoc, so nothing
  # interpolates inside Python source.
  VOICE_CHANNEL_ID=$("${SSH[@]}" "python3 - '${TOKEN}' '${GUILD}' <<'PY'
import json, sys, urllib.request

token, guild = sys.argv[1], sys.argv[2]
req = urllib.request.Request(
    f'https://discord.com/api/v10/guilds/{guild}/channels',
    headers={'Authorization': f'Bot {token}', 'User-Agent': 'SielaBot/1.0'},
)
channels = json.load(urllib.request.urlopen(req, timeout=10))
voice = [c for c in channels if c.get('type') == 2]
print(voice[0]['id'] if voice else '')
PY")
fi

if [ -z "${VOICE_CHANNEL_ID}" ]; then
  echo "no voice channel found; set VOICE_CHANNEL_ID" >&2
  exit 1
fi
echo "voice channel: ${VOICE_CHANNEL_ID}"

cleanup() {
  echo
  echo "=== cleanup, restoring ${WORKER} ==="
  "${SSH[@]}" "podman rm -f ${TEST_CONTAINER} >/dev/null 2>&1 || true; podman start ${WORKER} >/dev/null 2>&1 || true"
  sleep 12
  "${SSH[@]}" "podman ps --format '{{.Names}} {{.Status}}' | grep ${WORKER} || true"
}
trap cleanup EXIT

echo "=== stopping ${WORKER} so the sessions do not fight ==="
"${SSH[@]}" "podman stop -t 20 ${WORKER} >/dev/null 2>&1 || true"

# Discord can deliver a voice state that still references the old session for
# a few seconds after the bot signs out. Joining too early gives close code
# 4006, "Session is no longer valid".
echo "letting the old gateway session expire"
sleep 15

echo "=== starting the Rust worker ==="
"${SSH[@]}" "podman rm -f ${TEST_CONTAINER} >/dev/null 2>&1 || true
podman run -d --name ${TEST_CONTAINER} \
  --memory 1g \
  --read-only \
  --tmpfs /tmp \
  --network siela_control \
  --network siela_data \
  --network siela_edge \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  -e DISCORD_TOKEN='${TOKEN}' \
  -e MCP_TOKEN='${MCP}' \
  -e GUILD_ID='${GUILD}' \
  -e NODE_ROLE=voice \
  -e NODE_ID=voice-${N} \
  -e NODE_ADVERTISE_URL=http://${TEST_CONTAINER}:3101 \
  -e VALKEY_URL=redis://valkey:6379 \
  -e TTS_SERVICE_URL=http://tts:8000 \
  -e LOG_LEVEL=info \
  ${IMAGE} >/dev/null"

echo "waiting for login"
READY=0
for _ in $(seq 1 45); do
  if "${SSH[@]}" "podman logs ${TEST_CONTAINER} 2>&1 | grep -qi 'voice worker logged in'"; then
    READY=1
    break
  fi
  sleep 2
done

if [ "${READY}" != "1" ]; then
  echo "worker did not log in"
  "${SSH[@]}" "podman logs --tail 30 ${TEST_CONTAINER}"
  exit 1
fi
"${SSH[@]}" "podman logs ${TEST_CONTAINER} 2>&1 | grep -iE 'logged in|bound|listening' | tail -5"

# Give the voice state cache a moment before the first join.
sleep 5

echo
echo "=== heartbeat present in Valkey? ==="
"${SSH[@]}" "podman exec siela-valkey valkey-cli exists siela:fleet:node:voice-${N}"

echo
echo "=== health and readiness ==="
"${SSH[@]}" "podman exec ${TEST_CONTAINER} python3 -c \"
import urllib.request, json
for path in ('/healthz','/readyz'):
    print(path, urllib.request.urlopen('http://127.0.0.1:3002'+path, timeout=5).read().decode())
\""

echo
echo "=== play one track into ${VOICE_CHANNEL_ID} ==="
"${SSH[@]}" "podman exec -e TOK='${MCP}' -e CH='${VOICE_CHANNEL_ID}' ${TEST_CONTAINER} python3 -c \"
import json, os, urllib.request
body = json.dumps({'query': 'queen bohemian rhapsody', 'voiceChannelId': os.environ['CH']}).encode()
req = urllib.request.Request(
    'http://127.0.0.1:3101/internal/music/play',
    data=body,
    headers={'Authorization': 'Bearer ' + os.environ['TOK'], 'content-type': 'application/json'},
)
try:
    print(json.load(urllib.request.urlopen(req, timeout=180)))
except urllib.error.HTTPError as error:
    print('HTTP', error.code, error.read().decode())
    raise
\""

sleep 12
echo
echo "=== state after playback starts ==="
"${SSH[@]}" "podman exec -e TOK='${MCP}' ${TEST_CONTAINER} python3 -c \"
import json, os, urllib.request
req = urllib.request.Request('http://127.0.0.1:3101/internal/music/state', headers={'Authorization': 'Bearer ' + os.environ['TOK']})
state = json.load(urllib.request.urlopen(req, timeout=10))
print('playing:', state.get('playing'), 'channel:', state.get('channelId'))
print('title:', (state.get('current') or {}).get('title'))
\""

echo
echo "=== memory while playing ==="
"${SSH[@]}" "cg=/sys/fs/cgroup\$(podman inspect ${TEST_CONTAINER} --format '{{.State.CgroupPath}}')
echo \"anon=\$(( \$(awk '/^anon /{print \$2}' \$cg/memory.stat) / 1048576 ))MB current=\$(( \$(cat \$cg/memory.current) / 1048576 ))MB\"
podman exec ${TEST_CONTAINER} sh -c 'for p in /proc/[0-9]*; do n=\$(cat \$p/comm 2>/dev/null); r=\$(awk \"/^VmRSS/{print \\\$2}\" \$p/status 2>/dev/null); [ -n \"\$r\" ] && [ \"\$r\" -gt 2000 ] && echo \"  \$n \$((r/1024))MB\"; done' 2>/dev/null | sort -k2 -nr | head -5"

echo
echo "=== stopping playback ==="
"${SSH[@]}" "podman exec -e TOK='${MCP}' ${TEST_CONTAINER} python3 -c \"
import os, urllib.request
req = urllib.request.Request('http://127.0.0.1:3101/internal/music/disconnect', data=b'{}', headers={'Authorization': 'Bearer ' + os.environ['TOK'], 'content-type': 'application/json'})
print(urllib.request.urlopen(req, timeout=20).read().decode())
\""

echo
echo "live check finished"
