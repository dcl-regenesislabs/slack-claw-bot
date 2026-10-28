# Droplet deployment

One DigitalOcean droplet runs the bot as a single Docker Compose service. Secrets live in one
root-only file on the box; the image, this repo and CI never carry them.

## Where the secrets are, and who can read them

- `/etc/slack-bot/env`, root `0600` on the host. Anyone who is root on the droplet (SSH as root,
  `sudo`, membership in the `docker` group) can read it; that is true for every secret-storage
  scheme once the process is running, so the control is **who can SSH in**. Keep root SSH to the
  one or two people who operate the bot, key-only.
- Inside the container the file is mounted read-only at `/run/secrets/slack-bot.env`. The
  container starts as root with only `CAP_SETUID`/`CAP_SETGID`, the bot reads the file, then drops
  to uid 1000 (`RUN_AS`). After that moment nothing uid 1000 can read holds a secret: not the
  file (root-only), not any environment (`/proc/<pid>/environ` only ever had `DATA_DIR`-style
  config), not the server's memory (the privilege drop makes the process non-dumpable), and no
  `.auth.json` is written (the Anthropic credential stays in memory). That is what makes the
  "agent's shell cannot see the tokens" claim hold — the in-code path guards alone would not.
- CI deploys as the `deploy` user, whose key can only run `sudo /opt/slack-bot/deploy.sh`.

## One-time setup

1. **Droplet**: Ubuntu 24.04 LTS, **CPU-Optimized 4 vCPU / 8 GB** ($84/mo) — proven enough
   for 5 concurrent agents doing clone/build/PR work. Add your SSH key at creation; no
   password login.
2. **Disk**: the 96 GB root disk is enough to start. If `df -h /var/lib/slack-bot` gets tight,
   attach a Block Storage volume, format it, and mount it at `/var/lib/slack-bot` (choose
   "manually format and mount" in the DO UI; `nofail,discard` in `/etc/fstab`).
3. **Firewall** (DO Cloud Firewall attached to the droplet): inbound **SSH only**, from your IP
   or your VPN range. Nothing else — Slack Socket Mode is outbound, the health endpoint is
   loopback. Outbound: all.
4. **Host**:
   ```bash
   apt-get update && apt-get install -y docker.io docker-compose-v2 unattended-upgrades
   systemctl enable --now docker
   ufw allow OpenSSH && ufw --force enable
   mkdir -p /opt/slack-bot /etc/slack-bot /var/lib/slack-bot/data /var/lib/slack-bot/tmp
   chown 1000:1000 /var/lib/slack-bot/data /var/lib/slack-bot/tmp   # the bot runs as uid 1000 after the drop
   ```
5. **Secrets file**: copy `deploy/env.example` locally, fill it in (plain `KEY=value`, no quotes,
   no `export`; it already carries the sizing defaults), and upload it. Rotate every token when
   you migrate: they have lived in the App Platform UI until now.
   ```bash
   cp deploy/env.example /tmp/slack-bot.env && $EDITOR /tmp/slack-bot.env
   scp /tmp/slack-bot.env root@<droplet>:/etc/slack-bot/env
   ssh root@<droplet> 'chown root:root /etc/slack-bot/env && chmod 0600 /etc/slack-bot/env'
   rm /tmp/slack-bot.env
   ```
6. **Compose file**: copy `deploy/docker-compose.yml` and `deploy/deploy.sh` to
   `/opt/slack-bot/` (root-owned, `chmod +x /opt/slack-bot/deploy.sh`), then
   `docker compose -f /opt/slack-bot/docker-compose.yml config --quiet` to check the file parses.
7. **Deploy user** (what CI logs in as — see [CI deploy key](#ci-deploy-key)):
   ```bash
   adduser --disabled-password --gecos '' deploy
   install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   printf 'deploy ALL=(root) NOPASSWD: /opt/slack-bot/deploy.sh\n' > /etc/sudoers.d/slack-bot-deploy
   chmod 440 /etc/sudoers.d/slack-bot-deploy && visudo -cf /etc/sudoers.d/slack-bot-deploy
   ```
8. **Registry login** (only if the GHCR package is private): a GitHub PAT with `read:packages`
   only, `docker login ghcr.io -u <user>` — it lands in `/root/.docker/config.json`, root-only.
9. **First start**: `/opt/slack-bot/deploy.sh`, then `docker compose -f /opt/slack-bot/docker-compose.yml logs -f`.

## Cutover from App Platform

Slack Socket Mode spreads events across every connected client of the app, so two bots running
at once split threads between different code and session stores, and the schedule runner fires
twice. Do these in order, in one sitting:

1. Finish the one-time setup above, **without** running `deploy.sh` yet.
   On a host that already ran an older image, the first start logs `[agent] Removed stale
   /data/.auth.json` — that file held the setup token readable by uid 1000.
2. Rotate every token (Slack bot + app tokens, GitHub PAT, `claude setup-token`, Discourse key,
   PostHog key) and write the new values into `/etc/slack-bot/env`. The old ones have lived in
   the App Platform UI.
3. In the memory repo, delete any `shared/MEMORY.md` line that teaches fetching Slack files with
   `curl -H "Authorization: Bearer $SLACK_BOT_TOKEN"` — attachments now arrive as local paths and
   the shell has no token, so the recipe only wastes the first run's turn.
4. Scale the App Platform worker to 0 (or delete the app). Confirm the bot shows offline in Slack.
5. `/opt/slack-bot/deploy.sh` and watch the logs for `[secrets] Dropped privileges`,
   `[memory] Cloned`/`Pulled`, `qmd index updated` and the Socket Mode connection.
6. Delete the `DIGITALOCEAN_ACCESS_TOKEN` repo secret.

## CI deploy key

Generate a key pair on your machine (`ssh-keygen -t ed25519 -f slack-bot-deploy -N ''`) and add
three repo secrets:

| Secret | Value |
|---|---|
| `DROPLET_HOST` | the droplet's IP or DNS name |
| `DROPLET_SSH_KEY` | contents of the private key file |
| `DROPLET_KNOWN_HOSTS` | output of `ssh-keyscan -H <ip>` (the workflow pins the host key) |

Install the public half for the `deploy` user with a forced command. The key can only redeploy:
no shell, no port forwarding, and `sudo` is limited to that one root-owned script, so even a
mis-edited `authorized_keys` line yields an unprivileged shell, not root.

```
# /home/deploy/.ssh/authorized_keys  (mode 600, owned by deploy)
command="sudo /opt/slack-bot/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... slack-bot-deploy
```

Check it from your machine before relying on it: `ssh -i slack-bot-deploy deploy@<droplet>` must
run the deploy (or fail inside `deploy.sh`), and `ssh -i slack-bot-deploy deploy@<droplet> cat /etc/slack-bot/env`
must run the deploy too, never the `cat`. A GitHub release then builds the image and runs
`deploy.sh` over SSH (see `.github/workflows/docker-release.yml`).

## Day 2

- **Logs**: `docker compose -f /opt/slack-bot/docker-compose.yml logs -f --tail 200`
- **Rotate a secret**: edit `/etc/slack-bot/env`, then `/opt/slack-bot/deploy.sh`. The file is a
  bind mount, so its content is not in anything Compose hashes — `deploy.sh` therefore runs
  `up -d --force-recreate`; a bare `docker compose up -d` or `restart` would keep the old process
  and the old tokens.
- **Roll back**: `IMAGE_TAG=v1.2.3 docker compose -f /opt/slack-bot/docker-compose.yml up -d`.
- **Data**: `/var/lib/slack-bot/data` holds the memory clone, sessions and the attachment cache
  (14-day / 2 GB, least recently used first); `/var/lib/slack-bot/tmp` is the container's `/tmp`,
  where skills clone repos (`deploy.sh` removes entries older than 7 days). Both survive
  redeploys; back up only if you care about sessions (memory is in git).
- **Limits**: `cpus: 3.5` and `pids_limit: 4096` keep a runaway build or fork bomb in an agent
  shell from starving sshd and dockerd. If `docker inspect slack-claw-bot --format '{{.State.OOMKilled}}'`
  turns true or runs die under load, resize to General Purpose 4 vCPU / 16 GB and raise the
  compose memory limit; nothing else changes.
- **What this does not do yet**: the agent's tools run as the same uid as the server, so one
  thread's run can read another thread's cached attachments and session transcripts, and could
  plant a same-size file in the attachment cache. Running the tools under their own uid is the
  next hardening step.
