# Vyaapar Windows Desktop

The desktop app is a **thin Electron client** — it doesn't run its own server. Every shop PC connects to the **same one centrally-hosted server** (deployed once, via `deploy/gcp` or `deploy/oracle`), the same way a browser connects to a website. A shop PC only runs the Electron shell — no Docker, no local Postgres, no local API or web server.

```
┌───────────────────────┐        ┌───────────────────────┐
│  Shop PC #1            │        │  Shop PC #2            │
│  Electron shell only   │        │  Electron shell only   │        ...
└───────────┬────────────┘        └───────────┬────────────┘
            │                                  │
            └──────────────┬───────────────────┘
                            ▼
              https://your-business.example.com
     (one deploy: nginx + api + web + postgres —
      see docker-compose.prod.yml, deploy/gcp, deploy/oracle)
```

This is the same principle as any hosted web app — the "desktop app" just wraps it in a native window with a device ID for the offline POS queue.

## One-time: deploy the central server

Do this once per business, not per PC. Either:

- `deploy/gcp/GCP_SETUP.md`, or
- `deploy/oracle/install.sh` (+ `deploy/oracle/backup.sh` for backups)

Both stand up the full `docker-compose.prod.yml` stack (nginx, api, web, postgres) on one server. Note the URL you end up with (e.g. `https://your-business.example.com`) — every shop PC's Electron app connects to that same address.

## Setting up a shop PC

1. Install `Vyaapar Setup.exe` (see build instructions below) and launch it.
2. First launch shows a **"Connect this PC"** screen — enter the business's server address once. It's saved locally on that PC from then on.
3. If the server can't be reached, an **offline screen** appears with a manual **Retry** button (and a **Change server address** option) instead of a blank window.

No Docker, no local database, no other services to install on the shop PC.

## Local development (testing the Electron shell itself)

For developing/testing the desktop shell against a local dev stack:

```bash
pnpm docker:up      # postgres for local dev only
pnpm desktop:dev     # API + Web + Electron, pre-wired to http://localhost:3000
```

`desktop:dev` sets `DESKTOP_SERVER_URL=http://localhost:3000` so it skips the first-run screen during development. This local stack is a **dev convenience**, not what ships to shop PCs — see the section above for that.

**Demo login:** `admin@grandplaza.demo` / `Demo@123456`

## Build Windows `.exe`

```bash
pnpm --filter @nexus/desktop dist:win
```

Output: `apps/desktop/release/Vyaapar Setup.exe`. This installer does not bundle a server — it's the same thin client for every shop, pointed at whichever server address the shop owner enters on first launch (or bake one in for a single-tenant build via the `DESKTOP_SERVER_URL` env var at build/run time).

## Architecture

| Layer | Runs on |
|-------|---------|
| Electron | Shop PC — opens window, stores server URL + device ID, provides offline POS queue |
| `apps/web` + `apps/api` + Postgres | The one central server only |

## Scripts

| Command | What it does |
|---------|--------------|
| `pnpm desktop:dev` | Local dev: API + Web + Electron against localhost |
| `pnpm dev` | API + Web only (browser, local dev) |
| `pnpm desktop:win` | Build the Windows installer |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Connect this PC" keeps appearing | The address wasn't saved — re-enter it and click Connect; check the central server is reachable from this PC |
| Offline screen on launch | Check this PC's internet connection, then click Retry; if it persists, check the central server is up |
| Wrong server / moved to a new deploy | Click "Change server address" on the offline screen, or clear `desktop.json` in the app's userData folder |
