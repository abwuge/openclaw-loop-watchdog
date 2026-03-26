#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="${HOME}/.openclaw/hooks/stop-watchdog-clear"
REPO_RAW="https://raw.githubusercontent.com/abwuge/openclaw-loop-watchdog/main"

echo "[loop-watchdog] Installing stop-watchdog-clear gateway hook..."
mkdir -p "$HOOK_DIR"
curl -fsSL "${REPO_RAW}/hooks/stop-watchdog-clear/HOOK.md" -o "${HOOK_DIR}/HOOK.md"
curl -fsSL "${REPO_RAW}/hooks/stop-watchdog-clear/handler.js" -o "${HOOK_DIR}/handler.js"
echo "[loop-watchdog] Hook installed to ${HOOK_DIR}"
echo "[loop-watchdog] Run 'openclaw gateway restart' to activate."
