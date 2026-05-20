#!/usr/bin/env bash
# ============================================================
# One-shot bootstrap for the Musk-IT HVAC platform on a
# Hostinger VPS KVM 2 (Ubuntu 22.04 LTS).
#
# What it does:
#   1. Updates apt and installs base utilities, Docker engine,
#      Docker Compose v2, Nginx, certbot, UFW, fail2ban,
#      unattended-upgrades.
#   2. Creates a 2 GB swapfile if RAM < 4 GB (KVM 2 has 8 GB so
#      it usually skips this — harmless if it does run).
#   3. Opens 22/80/443 in UFW, blocks the rest.
#   4. Drops the repository under /opt/hvac (clones if missing,
#      pulls if already there).
#   5. Wires the Nginx site for hvac.muskit.in.
#   6. Pulls a Let's Encrypt cert with certbot --nginx.
#   7. Starts the docker-compose stack.
#
# Usage (as root or via sudo):
#     curl -fsSL https://raw.githubusercontent.com/<owner>/hvac-load-calculator/main/deploy/bootstrap-hostinger.sh -o bootstrap.sh
#     sudo bash bootstrap.sh
#
# Required environment variables (export before running, or
# the script will prompt):
#     GIT_REMOTE   — git URL to clone, e.g. https://github.com/owner/hvac-load-calculator.git
#     LETSENCRYPT_EMAIL — email for Let's Encrypt registration
#
# Optional:
#     APP_DOMAIN   — defaults to hvac.muskit.in
#     APP_DIR      — defaults to /opt/hvac
# ============================================================

set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:-hvac.muskit.in}"
APP_DIR="${APP_DIR:-/opt/hvac}"
GIT_REMOTE="${GIT_REMOTE:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"

step() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
fail() { printf "\n\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

require_root() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    fail "Run this as root (sudo bash $0)."
  fi
}

prompt_if_empty() {
  local var_name="$1"; local prompt_text="$2"
  if [ -z "${!var_name:-}" ]; then
    read -rp "$prompt_text: " value
    [ -z "$value" ] && fail "$var_name is required."
    printf -v "$var_name" "%s" "$value"
    export "$var_name"
  fi
}

# -------------------------------------------------------------
require_root
step "Hostinger VPS bootstrap → ${APP_DOMAIN}"

prompt_if_empty GIT_REMOTE "Git remote URL"
prompt_if_empty LETSENCRYPT_EMAIL "Let's Encrypt contact email"

# -------------------------------------------------------------
step "Updating apt and installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade
apt-get install -y \
    ca-certificates curl gnupg lsb-release git ufw \
    nginx certbot python3-certbot-nginx \
    fail2ban unattended-upgrades \
    htop tmux jq

# -------------------------------------------------------------
step "Installing Docker engine + Compose v2"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
     https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# -------------------------------------------------------------
step "Configuring swap (only if RAM < 4 GB)"
ram_mb=$(free -m | awk '/^Mem:/ {print $2}')
if [ "$ram_mb" -lt 4096 ] && [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
  echo "vm.swappiness=10" >> /etc/sysctl.d/99-swap.conf
  sysctl -p /etc/sysctl.d/99-swap.conf || true
else
  echo "(skipped — RAM ${ram_mb} MB, or /swapfile already exists)"
fi

# -------------------------------------------------------------
step "Configuring UFW firewall (22 / 80 / 443)"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# -------------------------------------------------------------
step "Enabling unattended-upgrades + fail2ban"
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now fail2ban

# -------------------------------------------------------------
step "Cloning / updating repository in ${APP_DIR}"
mkdir -p "${APP_DIR}"
if [ -d "${APP_DIR}/.git" ]; then
  git -C "${APP_DIR}" fetch --all --prune
  git -C "${APP_DIR}" reset --hard origin/main || git -C "${APP_DIR}" pull --rebase
else
  git clone "${GIT_REMOTE}" "${APP_DIR}"
fi

# -------------------------------------------------------------
step "Preparing .env (copy from example if missing)"
if [ ! -f "${APP_DIR}/.env" ]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  # generate a strong DB password
  DB_PASS=$(openssl rand -hex 24)
  sed -i "s/CHANGE_ME_strong_password/${DB_PASS}/g" "${APP_DIR}/.env"
  echo "(generated random Postgres password — review ${APP_DIR}/.env)"
fi

# -------------------------------------------------------------
step "Installing Nginx site for ${APP_DOMAIN}"
NGINX_CONF="${APP_DIR}/deploy/nginx-hvac.muskit.in.conf"
DEST_AVAIL="/etc/nginx/sites-available/${APP_DOMAIN}"
DEST_ENABLE="/etc/nginx/sites-enabled/${APP_DOMAIN}"
cp "${NGINX_CONF}" "${DEST_AVAIL}"
ln -sf "${DEST_AVAIL}" "${DEST_ENABLE}"
rm -f /etc/nginx/sites-enabled/default
mkdir -p /var/www/letsencrypt/.well-known/acme-challenge
chown -R www-data:www-data /var/www/letsencrypt
nginx -t
systemctl reload nginx

# -------------------------------------------------------------
step "Requesting Let's Encrypt certificate for ${APP_DOMAIN}"
if [ ! -d "/etc/letsencrypt/live/${APP_DOMAIN}" ]; then
  certbot --nginx \
    -d "${APP_DOMAIN}" \
    --redirect \
    --agree-tos \
    --no-eff-email \
    -m "${LETSENCRYPT_EMAIL}" \
    -n
  systemctl reload nginx
else
  echo "(certificate already exists for ${APP_DOMAIN})"
fi

# -------------------------------------------------------------
step "Bringing up docker compose stack"
cd "${APP_DIR}"
docker compose pull || true
docker compose build --pull
docker compose up -d
docker compose ps

# -------------------------------------------------------------
step "Smoke test"
sleep 5
if curl -fsS --max-time 10 -H "Host: ${APP_DOMAIN}" http://127.0.0.1:3000/ >/dev/null; then
  echo "✓ App responds on 127.0.0.1:3000"
else
  echo "⚠ App did not respond on 127.0.0.1:3000 — check: docker compose logs app"
fi

if curl -fsS --max-time 10 "https://${APP_DOMAIN}/" -o /dev/null; then
  echo "✓ TLS endpoint https://${APP_DOMAIN}/ responds"
else
  echo "⚠ https://${APP_DOMAIN}/ did not respond — confirm DNS A record points to $(curl -s4 ifconfig.me) and certbot succeeded."
fi

step "Done."
cat <<EOF

Next steps:
  1. Visit https://${APP_DOMAIN}/   (root already serves the app)
  2. Edit ${APP_DIR}/.env and add OPENAI_API_KEY, SMTP_*, Razorpay keys as needed.
     Then:  cd ${APP_DIR} && docker compose up -d
  3. View logs:    docker compose logs -f app
  4. Postgres CLI: docker compose exec db psql -U hvac -d hvac

Backups:
  - Postgres volume:  /var/lib/docker/volumes/hvac_pgdata
  - App data volume:  /var/lib/docker/volumes/hvac_appdata
  - .env file:        ${APP_DIR}/.env  (NEVER commit)
EOF
