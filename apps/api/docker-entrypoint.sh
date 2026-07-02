#!/bin/sh
set -e
cd /app/apps/api
pnpm exec prisma migrate deploy
exec "$@"
