# Deploying hvac.muskit.in on a Hostinger VPS (KVM 2)

Production blueprint for the Musk-IT HVAC platform on Hostinger's VPS KVM 2
plan (2 vCPU, 8 GB RAM, 100 GB NVMe, Ubuntu 22.04 LTS).

## Current production edge

As of 2026-05-20, `hvac.muskit.in` resolves to `76.13.246.57` and port
`80` redirects to HTTPS, but port `443` presents `CN=TRAEFIK DEFAULT CERT`
and returns Traefik `404`. That means DNS and the VPS are reachable; the
missing piece is a Traefik router/certificate for `hvac.muskit.in`.

Use the Traefik path below when the VPS already has the main `muskit.in`
Traefik stack running. Use the Nginx path only on a VPS where Nginx owns
ports `80` and `443`.

## Architecture

```
   hvac.muskit.in  (DNS A → Hostinger VPS public IPv4)
        │
        ▼
   Traefik or Nginx :443 (TLS via Let's Encrypt)
        │
        ▼
   hvac-app:3000 / 127.0.0.1:3000  (Node 20 app, Docker container)
        │
        ▼
   db:5432 (Postgres 16, Docker container)
        │
        ▼
   Python 3.11 bin-energy engine (spawned by app)
```

Only the public reverse proxy is exposed. The app and database stay on
Docker networking plus loopback for the Nginx path.

## Files in this directory

| File | Purpose |
|------|---------|
| `bootstrap-hostinger.sh` | One-shot installer (apt, Docker, Nginx, certbot, UFW, fail2ban, repo clone, swap, certificate, compose up). |
| `../docker-compose.traefik.yml` | Optional Traefik edge overlay when this repo owns ports `80` and `443`. |
| `traefik/dynamic/hvac.yml` | Traefik file-provider router for `hvac.muskit.in`. |
| `nginx-hvac.muskit.in.conf` | Public site config — TLS, HSTS, gzip, 5-min timeout on `/api/ai/*`. |
| `hvac.service` | systemd unit for a non-Docker install (alternative path). |
| `../Dockerfile` | Node 20 + Python 3.11 runtime image. |
| `../docker-compose.yml` | App + Postgres stack with KVM-2-sized cpu/memory limits. |
| `../.env.example` | Template environment file. |

## Step 1 — DNS

In Hostinger's DNS panel for `muskit.in`, add:

```
Type   Host    Points to                 TTL
A      hvac    <your Hostinger VPS IPv4> 300
```

Confirm with `dig +short hvac.muskit.in` before continuing; DNS must
propagate before the certbot step or the Let's Encrypt http-01 challenge
will fail.

## Step 2 — SSH into the VPS

```bash
ssh root@<your VPS IPv4>
```

Hostinger's default user is `root`. The bootstrap script does not create
an additional user — it relies on systemd-running Docker, so root SSH +
strong key auth is sufficient for a small deployment. If you want a
non-root sudo user, create one before running the script.

## Step 3A — Existing Traefik VPS

The current Hostinger server already answers with Traefik, so this is the
path that fixes the live `TRAEFIK DEFAULT CERT` / `404` symptom.

Fast path:

```bash
cd /opt/hvac
bash deploy/apply-traefik-server-settings.sh
```

The script forces the app server settings to `https://hvac.muskit.in`, pulls
the latest repo, rebuilds the HVAC app, connects it to the existing Traefik
network, installs `deploy/traefik/dynamic/hvac.yml`, and restarts Traefik.

Manual path:

1. Start the HVAC app stack without another public proxy:

```bash
cd /opt/hvac
cp .env.example .env
# fill POSTGRES_PASSWORD, DATABASE_URL, OPENAI_API_KEY if used, SMTP if used
docker compose up -d --build
```

2. Attach `hvac-app` to the Docker network used by the existing Traefik
container. Replace `muskit_website_default` if `docker network ls` shows a
different website stack network name:

```bash
docker network connect muskit_website_default hvac-app || true
```

3. Install the HVAC Traefik router into the existing Traefik file-provider
directory and restart/reload that Traefik container:

```bash
cp /opt/hvac/deploy/traefik/dynamic/hvac.yml /opt/website/traefik/dynamic/hvac.yml
docker compose -f /opt/website/docker-compose.yml restart traefik
```

4. Verify from the VPS:

```bash
docker compose -f /opt/hvac/docker-compose.yml ps
docker compose -f /opt/website/docker-compose.yml logs --tail=120 traefik
curl -fsS https://hvac.muskit.in/
```

If Traefik still returns the default certificate, the dynamic file was not
loaded or the router rule does not match. If it returns `502`, Traefik can
see the router but cannot reach `http://hvac-app:3000`; recheck the shared
Docker network attachment.

## Step 3B — Standalone Traefik VPS

Use this only when no other service owns ports `80` and `443`:

```bash
cd /opt/hvac
cp .env.example .env
# fill POSTGRES_PASSWORD, DATABASE_URL, TRAEFIK_CERT_EMAIL, and optional integrations
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

Traefik will load `deploy/traefik/dynamic/hvac.yml` and issue the
Let's Encrypt certificate through the HTTP challenge.

## Step 3C — Nginx VPS

Use this only if the VPS is intentionally using host Nginx instead of the
existing Traefik stack.

```bash
export GIT_REMOTE="https://github.com/<your-org>/hvac-load-calculator.git"
export LETSENCRYPT_EMAIL="you@example.com"
curl -fsSL "$GIT_REMOTE/-/raw/main/deploy/bootstrap-hostinger.sh" -o bootstrap.sh
sudo bash bootstrap.sh
```

The script will:

1. Update apt and install Docker, Nginx, certbot, UFW, fail2ban, unattended-upgrades.
2. Create a 2 GB swapfile if RAM is below 4 GB (KVM 2 has 8 GB → skips).
3. Open only TCP 22 / 80 / 443.
4. Clone the repo into `/opt/hvac`.
5. Create `/opt/hvac/.env` from the template and generate a random strong Postgres password.
6. Install the Nginx site for `hvac.muskit.in`.
7. Request a Let's Encrypt cert (`certbot --nginx --redirect`).
8. `docker compose up -d`.

When it finishes, visit `https://hvac.muskit.in/` and you should see the
HVAC platform login page.

## Step 4 — Configure optional integrations

Edit `/opt/hvac/.env` and fill in any of:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4-mini

SMTP_HOST=smtpout.secureserver.net
SMTP_PORT=465
SMTP_USER=noreply@muskit.in
SMTP_PASS=...
SMTP_FROM="Musk-IT HVAC <noreply@muskit.in>"

RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Then restart only the app container (no DB downtime):

```bash
cd /opt/hvac
docker compose up -d app
```

## Health, logs, and admin

```bash
# Health from the host
curl -fsS https://hvac.muskit.in/

# Tail app logs
docker compose -f /opt/hvac/docker-compose.yml logs -f app

# Open a psql shell on the running database
docker compose -f /opt/hvac/docker-compose.yml exec db psql -U hvac -d hvac

# Container resource usage
docker stats --no-stream
```

## Updates and rollback

Every push to `main` builds an image and tags it `ghcr.io/<owner>/hvac-muskit:latest`
plus `:<git-sha>` (see `.github/workflows/deploy.yml`). On the server:

```bash
cd /opt/hvac
git pull --rebase
docker compose pull
docker compose up -d
```

To roll back to a specific commit:

```bash
docker pull ghcr.io/<owner>/hvac-muskit:<git-sha>
docker tag ghcr.io/<owner>/hvac-muskit:<git-sha> hvac-muskit:local
docker compose up -d --no-deps app
```

## Backups

Two named Docker volumes hold all persistent state:

| Volume | Path on host | Contents |
|--------|--------------|----------|
| `hvac_pgdata` | `/var/lib/docker/volumes/hvac_pgdata/_data` | Postgres data |
| `hvac_appdata` | `/var/lib/docker/volumes/hvac_appdata/_data` | server-data / JSON store |

A simple nightly backup:

```bash
cat > /etc/cron.daily/hvac-backup <<'SH'
#!/usr/bin/env bash
set -euo pipefail
ts=$(date +%Y%m%d-%H%M)
dest=/var/backups/hvac
mkdir -p "$dest"
docker compose -f /opt/hvac/docker-compose.yml exec -T db \
  pg_dump -U hvac hvac | gzip > "$dest/hvac-${ts}.sql.gz"
tar -C /var/lib/docker/volumes -czf "$dest/appdata-${ts}.tar.gz" hvac_appdata
find "$dest" -type f -mtime +14 -delete
SH
chmod +x /etc/cron.daily/hvac-backup
```

Copy `/var/backups/hvac/` off-box (rclone, scp, S3) at whatever cadence
your project warrants.

## Certificate renewal

`certbot` installs a systemd timer at install time; verify with:

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `502 Bad Gateway` | App container down → `docker compose logs app`. Often missing `.env` or a Postgres password mismatch. |
| `Let's Encrypt challenge failed` | DNS A record for `hvac.muskit.in` not yet pointing to the VPS, or port 80 blocked. |
| Cookies don't stick after login | Make sure `SESSION_COOKIE_SECURE=1` and that the user is on https. The Nginx config already forwards `X-Forwarded-Proto`. |
| Out of memory under heavy AI use | Lower `NODE_OPTIONS` in `docker-compose.yml` (e.g. `--max-old-space-size=1024`) and bump swap to 4 GB. |
| Slow first response after idle | Docker pauses cold containers; this is normal. Use `docker update --restart unless-stopped` (already set). |

## Security checklist

- [x] UFW limits inbound to 22 / 80 / 443
- [x] fail2ban enabled
- [x] unattended-upgrades enabled (kernel + apt security)
- [x] App + DB bound to loopback only (Nginx is the public face)
- [x] HSTS + modern TLS only
- [x] Session cookies forced Secure in production
- [ ] Rotate the Postgres password and SSH keys every 90 days
- [ ] Move backups off-VPS (S3, B2, etc.)

## Non-Docker installation (alternative)

If you'd rather avoid Docker:

```bash
sudo apt install -y nodejs npm postgresql python3
sudo -u postgres createuser -P hvac
sudo -u postgres createdb -O hvac hvac
sudo -u postgres psql -d hvac -f /opt/hvac/db/schema.sql
cd /opt/hvac && npm ci --omit=dev
sudo cp deploy/hvac.service /etc/systemd/system/hvac.service
sudo mkdir -p /etc/hvac && sudo cp .env /etc/hvac/.env
sudo systemctl daemon-reload && sudo systemctl enable --now hvac
```

The systemd unit is hardened with `ProtectSystem=strict`, `NoNewPrivileges`,
etc. and binds the app to 127.0.0.1:3000 the same way the Docker setup does.
