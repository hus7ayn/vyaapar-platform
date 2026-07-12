#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Opening Docker Desktop..."
open -a "Docker Desktop" 2>/dev/null || open -a Docker 2>/dev/null || true

echo "==> Waiting for Docker daemon..."
for i in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    echo "    Docker ready (${i}0s)"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: Docker did not start in 10 minutes. Open Docker Desktop manually, then re-run: pnpm docker:up"
    exit 1
  fi
  sleep 10
done

echo "==> Starting Postgres..."
docker compose up -d

echo "==> Waiting for Postgres..."
for i in $(seq 1 30); do
  if docker exec nexus-postgres pg_isready -U nexus -d nexus_platform >/dev/null 2>&1; then
    echo "    Postgres ready"
    break
  fi
  sleep 2
done

echo "==> Syncing database..."
cd apps/api
pnpm exec prisma db push
TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' pnpm exec ts-node prisma/seed.ts 2>/dev/null || pnpm db:seed 2>/dev/null || true
cd "$ROOT"

echo ""
echo "============================================"
echo "  Local stack ready!"
echo "  Web:  http://localhost:3000"
echo "  API:  http://localhost:4000"
echo "  Login: admin@grandplaza.demo / Demo@123456"
echo "============================================"
echo ""
echo "If API is not running yet, start with: pnpm dev"
