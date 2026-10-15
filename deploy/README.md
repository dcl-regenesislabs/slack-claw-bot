# Droplet deployment

One DigitalOcean droplet runs the bot as a single Docker Compose service. Secrets live in one
root-only file on the box; the image, this repo and CI never carry them.

## Who can see the secrets

Anyone who is root on the droplet (SSH as root, `sudo`, or membership in the `docker` group —
`docker inspect` prints a container's environment). That is true for every secret-storage
scheme once the process is running, so the control is **who can SSH in**, not where the file
sits. Keep root SSH to the one or two people who operate the bot, key-only, and give CI a
separate key that can only run `deploy.sh`.

## One-time setup

1. **Droplet**: Ubuntu 24.04 LTS, **CPU-Optimized 4 vCPU / 8 GB** ($84/mo) — proven enough
   for 5 concurrent agents doing clone/build/PR work. Add your SSH key at creation; no
   password login.
2. **Volume**: a 100 GB Block Storage volume attached to the droplet. The 50 GB root disk fills
   with repo clones; the volume also survives a resize or rebuild. Choose "manually format and
   mount", then:
   ```bash
   mkfs.ext4 /dev/disk/by-id/scsi-0DO_Volume_<name>
   mkdir -p /var/lib/slack-bot
   echo '/dev/disk/by-id/scsi-0DO_Volume_<name> /var/lib/slack-bot ext4 defaults,nofail,discard 0 2' >> /etc/fstab
   mount -a
   ```
3. **Firewall** (DO Cloud Firewall attached to the droplet): inbound **SSH only**, from your IP
   or your VPN range. Nothing else — Slack Socket Mode is outbound, the health endpoint is
   loopback. Outbound: all.
4. **Host**:
   ```bash
   apt-get update && apt-get install -y docker.io docker-compose-v2 unattended-upgrades
   systemctl enable --now docker
   mkdir -p /opt/slack-bot /etc/slack-bot /var/lib/slack-bot/data /var/lib/slack-bot/tmp
   chown 1000:1000 /var/lib/slack-bot/data /var/lib/slack-bot/tmp   # the container runs as uid 1000 (node)
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
   `/opt/slack-bot/`, `chmod +x /opt/slack-bot/deploy.sh`.
7. **Registry login** (only if the GHCR package is private): a GitHub PAT with `read:packages`
   only, `docker login ghcr.io -u <user>` — it lands in `/root/.docker/config.json`, root-only.
8. **First start**: `/opt/slack-bot/deploy.sh`, then `docker compose -f /opt/slack-bot/docker-compose.yml logs -f`.

## Cutover from App Platform

Slack Socket Mode spreads events across every connected client of the app, so two bots running
at once split threads between different code and session stores, and the schedule runner fires
twice. Do these in order, in one sitting:

1. Finish the one-time setup above, **without** running `deploy.sh` yet.
2. Rotate every token (Slack bot + app tokens, GitHub PAT, `claude setup-token`, Discourse key,
   PostHog key) and write the new values into `/etc/slack-bot/env`. The old ones have lived in
   the App Platform UI.
3. Scale the App Platform worker to 0 (or delete the app). Confirm the bot shows offline in Slack.
4. `/opt/slack-bot/deploy.sh` and watch the logs for `[memory] Cloned`/`Pulled` and the Socket
   Mode connection.
5. Delete the `DIGITALOCEAN_ACCESS_TOKEN` repo secret and add the three below.

## CI deploy key

Generate a key pair on your machine (`ssh-keygen -t ed25519 -f slack-bot-deploy -N ''`) and add
three repo secrets:

| Secret | Value |
|---|---|
| `DROPLET_HOST` | the droplet's IP or DNS name |
| `DROPLET_SSH_KEY` | contents of the private key file |
| `DROPLET_KNOWN_HOSTS` | output of `ssh-keyscan -H <ip>` (the workflow pins the host key) |

Install the public half on the droplet with a forced command so it can only redeploy — it
cannot open a shell or read the secrets file:

```
# /root/.ssh/authorized_keys
command="/opt/slack-bot/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... slack-bot-deploy
```

A GitHub release then builds the image and runs `deploy.sh` over SSH (see
`.github/workflows/docker-release.yml`).

## Day 2

- **Logs**: `docker compose -f /opt/slack-bot/docker-compose.yml logs -f --tail 200`
- **Rotate a secret**: edit `/etc/slack-bot/env`, then `/opt/slack-bot/deploy.sh` (compose
  recreates the container; a bare `restart` does not reread `env_file`).
- **Roll back**: `IMAGE_TAG=v1.2.3 docker compose -f /opt/slack-bot/docker-compose.yml up -d`.
- **Data**: `/var/lib/slack-bot/data` holds `.auth.json`, the memory clone, sessions and
  attachments; `/var/lib/slack-bot/tmp` is the container's `/tmp`, where skills clone repos
  (`deploy.sh` removes entries older than 7 days). Both survive redeploys; back up only if you
  care about sessions (memory is in git).
- **Resize**: if `docker inspect slack-claw-bot --format '{{.State.OOMKilled}}'` turns true or
  runs die under load, resize to General Purpose 4 vCPU / 16 GB and raise the compose memory
  limit; nothing else changes. Disk pressure: `df -h /var/lib/slack-bot`, grow the volume.
