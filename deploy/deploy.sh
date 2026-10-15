#!/bin/sh
# Pull the released image and restart the bot. This is the only command the CI deploy key
# may run (forced command in authorized_keys), so CI can redeploy but not read the env file.
set -eu
cd /opt/slack-bot
docker compose pull --quiet
docker compose up -d --remove-orphans
docker image prune -f >/dev/null
# Repo clones the skills leave under /tmp outlive the container now that it is on disk.
find /var/lib/slack-bot/tmp -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} + 2>/dev/null || true
docker compose ps
