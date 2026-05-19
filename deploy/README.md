# Deploying hvac.muskit.in

This directory contains the production infrastructure for the HVAC platform.

## Architecture

```
internet  ─►  Nginx 443/TLS  ─►  127.0.0.1:3000 (Node app)  ─►  Postgres 5432
                                       │
                                       └─►  Python bin-energy engine (spawned)
```

Three files matter:

| File | Purpose |
|------|---------|
| `../Dockerfile` | Builds the runtime image (Node 20 + Python 3.11). |
| `../docker-compose.yml` | App + Postgres stack. |
| `nginx-hvac.muskit.in.conf` | Public TLS termination for `hvac.muskit.in`. |
| `hvac.service` | systemd unit (alternative to Docker). |

## One-time server setup

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
sudo mkdir -p /opt/hvac && sudo chown $USER /opt/hvac
cd /opt/hvac && git clone https://github.com/<owner>/hvac-load-calculator.git .
cp .env.example .env   # then fill in OPENAI_API_KEY, SMTP_*, POSTGRES_*

sudo cp deploy/nginx-hvac.muskit.in.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/nginx-hvac.muskit.in.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d hvac.muskit.in
```

## Bring up the stack

```bash
cd /opt/hvac
docker compose pull   # or `docker compose build` for first-time
docker compose up -d
docker compose logs -f app
```

## CI/CD

GitHub Actions builds an image on every push to `main`, pushes it to GHCR,
then SSHes to the production host and runs `docker compose up -d --no-deps app`.

Repository secrets required:

| Secret | Purpose |
|--------|---------|
| `DEPLOY_HOST` | Production server hostname or IP |
| `DEPLOY_USER` | SSH login (must be in the `docker` group) |
| `DEPLOY_SSH_KEY` | PEM-format private key for that user |

## Health & rollback

- Health probe: `curl -fsS https://hvac.muskit.in/`
- Roll back: `docker compose pull ghcr.io/<owner>/hvac-muskit:<previous-sha> && docker compose up -d --no-deps app`

## Environment variables

The application reads these (see `envLoader.js`):

| Variable | Default | Notes |
|----------|---------|-------|
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `3000` | App port |
| `DATABASE_URL` | – | Postgres connection string |
| `OPENAI_API_KEY` | – | Enables AI advisor and AI design narration |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Override default model |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | – | Outbound email |
