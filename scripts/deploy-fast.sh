#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${REMOTE:?set REMOTE=user@host}"
REMOTE_REPO="${REMOTE_REPO:-/root/siela-nogseuui-seobeo-bot}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/siela_podman_ed25519}"

cd "$ROOT"
bun run --cwd apps/bot build

ssh -i "$SSH_KEY" "$REMOTE" "mkdir -p $REMOTE_REPO/apps/bot/dist"
scp -r -i "$SSH_KEY" "$ROOT"/apps/bot/dist/* "$REMOTE:$REMOTE_REPO/apps/bot/dist/"

ssh -i "$SSH_KEY" "$REMOTE" \
  "cd $REMOTE_REPO && podman compose -p siela -f deploy/podman/compose.yaml -f deploy/podman/compose.fast.yaml up -d --force-recreate bot && sleep 8 && podman logs --tail 5 siela-bot"
