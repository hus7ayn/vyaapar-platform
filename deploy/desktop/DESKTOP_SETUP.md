# Vyaapar Windows Desktop

The desktop app is an **Electron shell around the full web app** — same sidebar, POS, parties, purchases, hotel PMS, reports, and everything else you use in the browser.

```
┌─────────────────────────────────────────────────────────────┐
│  Electron window → http://localhost:3000 (full Next.js app) │
│  ├── All Vyapar features (same as web)                      │
│  ├── Local API + Postgres on this PC                        │
│  └── Cloud: only daily revenue insights upload                │
└─────────────────────────────────────────────────────────────┘
```

## Quick start (localhost)

**1. Start Docker** (Postgres, Redis, MinIO):

```bash
docker start nexus-postgres nexus-redis nexus-minio
# or: pnpm docker:up
```

**2. Run everything** (API + Web + Desktop window):

```bash
pnpm desktop:dev
```

This opens the **full app** in a desktop window — not a stripped-down POS.

**Demo login:** `admin@grandplaza.demo` / `Demo@123456`

## What you get

| Feature | Desktop |
|---------|---------|
| POS billing (Vyapar style) | ✅ |
| Parties, items, inventory | ✅ |
| Sales, purchases, expenses | ✅ |
| Cash & bank, payroll | ✅ |
| Hotel PMS (rooms, folio, HK) | ✅ |
| Reports & GST documents | ✅ |
| Offline POS queue | ✅ |
| Cloud upload | **Insights only** (daily revenue) |

A red banner at the top shows: *"Desktop app — full features on this PC"*.

## Cloud insights sync

1. Go to **Settings → Cloud insights sync**
2. Set your cloud server URL (GCP/Oracle deploy URL, or `http://localhost:4000` for testing)
3. Click **Sync insights now**

Auto-sync runs every 5 minutes in desktop mode.

**Uploaded:** daily sales total, bill count, tax, purchase/expense totals  
**Never uploaded:** individual invoices, parties, stock

## Build Windows `.exe`

On Windows, with API + Web built and running as services on the PC:

```bash
pnpm --filter @nexus/desktop dist:win
```

Output: `apps/desktop/release/Vyaapar Setup.exe`

> Production Windows install should also bundle or auto-start local API + Postgres (see `docker-compose.prod.yml`). The Electron app opens the local web UI.

## Architecture

| Layer | Runs on |
|-------|---------|
| Electron | Opens window, provides device ID |
| `apps/web` | Full UI (Next.js) |
| `apps/api` | Full backend (NestJS + Postgres) |
| Cloud | `shop_daily_insights` table only |

## Scripts

| Command | What it does |
|---------|--------------|
| `pnpm desktop:dev` | API + Web + Electron (recommended) |
| `pnpm dev` | API + Web only (browser) |
| `pnpm desktop:win` | Build Windows installer |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Blank Electron window | Wait for web on :3000, or run `pnpm dev` first |
| Login fails | Start Docker + `pnpm --filter @nexus/api dev` |
| Sync fails | Set cloud URL in Settings, select a shop in top bar |
