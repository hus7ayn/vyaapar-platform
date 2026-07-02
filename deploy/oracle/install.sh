#!/usr/bin/env bash
# Production install for any Ubuntu VM (Oracle Always Free, GCP e2-micro, etc.)
# Run ON THE VM after SSH:
#   bash deploy/oracle/install.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "=============================================="
echo "  Vyaapar — production installer (Ubuntu VM)"
echo "=============================================="

# ─── 1. Docker ──────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo ">> Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" 2>/dev/null || true
  echo ">> Docker installed. If this is first install, run: newgrp docker"
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose plugin missing. Install Docker Compose v2."
  exit 1
fi

# ─── 2. Detect public IP ────────────────────────────────────────────────────
PUBLIC_IP=""
if command -v curl >/dev/null 2>&1; then
  PUBLIC_IP="$(curl -fsSL -m 5 ifconfig.me 2>/dev/null || curl -fsSL -m 5 icanhazip.com 2>/dev/null || true)"
fi

# ─── 3. Create .env if missing ──────────────────────────────────────────────
if [[ ! -f .env ]]; then
  echo ">> Creating .env from template..."
  cp deploy/oracle/env.template .env

  if [[ -n "$PUBLIC_IP" ]]; then
    sed -i "s|http://REPLACE_WITH_YOUR_VM_PUBLIC_IP|http://${PUBLIC_IP}|g" .env
    echo ">> Set PUBLIC_URL to http://${PUBLIC_IP}"
  fi

  # Generate secrets
  if command -v openssl >/dev/null 2>&1; then
    DB_PASS="$(openssl rand -hex 16)"
    JWT1="$(openssl rand -hex 32)"
    JWT2="$(openssl rand -hex 32)"
    MINIO="$(openssl rand -hex 16)"
    ENC="$(openssl rand -hex 32)"
    sed -i "s|CHANGE_ME_STRONG_DB_PASSWORD|${DB_PASS}|g" .env
    sed -i "s|CHANGE_ME_jwt_secret_min_32_chars|${JWT1}|g" .env
    sed -i "s|CHANGE_ME_refresh_secret_min_32_chars|${JWT2}|g" .env
    sed -i "s|CHANGE_ME_minio_secret|${MINIO}|g" .env
    sed -i "s|0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef|${ENC}|g" .env
    echo ">> Generated random secrets in .env"
  else
    echo "WARN: openssl not found — edit .env passwords manually before continuing."
  fi
else
  echo ">> Using existing .env"
fi

# shellcheck disable=SC1091
source .env 2>/dev/null || true
echo ""
echo "   PUBLIC_URL = ${PUBLIC_URL:-not set}"
echo ""

# ─── 4. Build & start ───────────────────────────────────────────────────────
echo ">> Building images (10–20 min on free ARM VM)..."
docker compose -f docker-compose.prod.yml build --no-cache

echo ">> Starting stack..."
docker compose -f docker-compose.prod.yml up -d

echo ">> Waiting for app..."
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1/api/v1/health" >/dev/null 2>&1; then
    echo "   App healthy"
    break
  fi
  sleep 3
done

# ─── 5. Seed (first deploy) ─────────────────────────────────────────────────
echo ">> Seeding demo data (safe to re-run)..."
docker compose -f docker-compose.prod.yml exec -T api sh -c \
  'TS_NODE_COMPILER_OPTIONS='"'"'{"module":"commonjs"}'"'"' pnpm exec ts-node prisma/seed.ts' \
  || echo "   Seed skipped or already done"

echo ""
echo "=============================================="
echo "  DEPLOYED"
echo "=============================================="
echo "  App:     ${PUBLIC_URL:-http://YOUR_IP}"
echo "  Login:   admin@grandplaza.demo / Demo@123456"
echo "  POS:     ${PUBLIC_URL:-http://YOUR_IP}/pos"
echo "  API docs:${PUBLIC_URL:-http://YOUR_IP}/api/docs"
echo ""
echo "  Oracle Cloud: open port 80 in VCN Security List + Ingress Rules"
echo "  Backup:       bash deploy/oracle/backup.sh"
echo "=============================================="
