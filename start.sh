#!/bin/bash
# ── hex-bots supervisor ───────────────────────────────────────────────────────
#
# Starts the bot server and automatically restarts it:
#   exit 0  — clean exit (code sync applied new files) → restart after 2s
#   exit 1+ — crash → restart after 5s
#
# IMPORTANT: Never run with `bun --hot` when code sync is enabled.
# `bun --hot` triggers a hot-reload on every file write; bulk code sync
# (50+ files) causes cascading restarts, OOM, and segfaults.
# This script replaces --hot with a single clean restart after all files land.
#
# Usage:
#   chmod +x start.sh
#   ./start.sh            # foreground (log to terminal)
#   nohup ./start.sh &    # background
#   # or register as a systemd unit (see below)
#
# Systemd (recommended for production):
#   [Unit]
#   Description=hex-bots
#   After=network.target
#
#   [Service]
#   WorkingDirectory=/home/opc/hex-bots
#   ExecStart=/home/opc/hex-bots/start.sh
#   Restart=always
#   RestartSec=3
#
#   [Install]
#   WantedBy=multi-user.target
# ─────────────────────────────────────────────────────────────────────────────

cd "$(dirname "$0")"

while true; do
  bun run src/botmanager.ts
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    echo "[supervisor] $(date '+%H:%M:%S') Clean exit (code 0) — code sync applied. Restarting in 2s..."
    sleep 2
  else
    echo "[supervisor] $(date '+%H:%M:%S') Exited with code $EXIT_CODE. Restarting in 5s..."
    sleep 5
  fi
done
