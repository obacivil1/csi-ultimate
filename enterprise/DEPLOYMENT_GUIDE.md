# Deployment Guide

## Prerequisites

- **Node.js** 20+ (runtime)
- **npm** 10+
- **Playwright** (browser engine for crawling — installed automatically with `npx playwright install chromium`)

## Environment Variables

| Variable | Required | Default | Source | Description |
|----------|----------|---------|--------|-------------|
| `CSI_PORT` | No | `3030` | Engine | Port for the Express crawling engine |
| `NEXT_PUBLIC_CSI_PORT` | No | `3030` | Frontend (browser) | Port for the engine, exposed to client-side code |

No `.env` file is required for local development. Both variables default to `3030`.

## System Architecture

```
┌──────────────┐     HTTP      ┌──────────────────┐     HTTP      ┌──────────┐
│   Browser    │◄────────────►│  Next.js App     │◄────────────►│  Express  │
│  (React SPA) │               │  (Port 3000)     │               │  Engine   │
│              │               │                  │               │(Port 3030)│
│  - Pages     │               │  - API Routes    │               │          │
│  - Auth UI   │               │  - Auth (cookie) │               │  - Crawl  │
│  - Dashboards│               │  - Proxy to eng  │               │  - Sites  │
│              │               │  - UI SSR/CSR    │               │  - Reports│
└──────────────┘               │  - SaaS store    │               │  - Jobs   │
                               │  - Validation    │               │  - Export │
                               └──────────────────┘               └──────────┘
                                               │
                                        ┌──────┴──────┐
                                        │  File System │
                                        │  ../state/   │
                                        │  ├── crawls/ │
                                        │  ├── sites/  │
                                        │  ├── jobs/   │
                                        │  ├── reports/│
                                        │  └── saas/   │
                                        │      ├── users.json
                                        │      ├── orgs.json
                                        │      ├── sessions.json
                                        │      └── usage.json
                                        └─────────────┘
```

## Startup Process

### Development
```bash
# Terminal 1: Start the Express engine
npm start
# Output: "CSI Crawler Engine v9 running on port 3030"

# Terminal 2: Start the Next.js frontend
cd enterprise
npm run dev
# Output: "▲ Next.js 16.2.9  Local: http://localhost:3000"
```

### Production
```bash
# Build the Next.js app
cd enterprise
npm run build

# Start both processes
# Terminal 1:
CSI_PORT=3030 node csi-crawler-v9.mjs

# Terminal 2:
cd enterprise
npm start
```

## Production Checklist

### Required
- [ ] Set `NODE_ENV=production`
- [ ] Build Next.js app with `npm run build`
- [ ] Set `CSI_PORT` environment variable (default 3030)
- [ ] Start engine process with proper process manager (PM2, systemd)
- [ ] Start Next.js process with `npm start`
- [ ] Configure reverse proxy (nginx/Caddy) for TLS termination
- [ ] Add `Secure` flag to session cookie via middleware if using HTTPS

### Recommended
- [ ] Set up monitoring (health endpoint at `/api/health`)
- [ ] Configure log rotation for engine and Next.js logs
- [ ] Set up PM2 cluster mode for the Next.js app
- [ ] Add rate limiting (nginx or application-level)
- [ ] Set up database/file backup for `state/` directory

### Multi-Tenant Production Setup
For true multi-tenant isolation, each organization should run a separate engine instance:
```
Org A → Engine instance on port 3031, state/org-a/
Org B → Engine instance on port 3032, state/org-b/
```
The Next.js app routes requests based on `session.orgId` to the correct engine port.

## Database Initialization

The system uses **file-based persistence**, not a traditional database.

### Engine State (`../state/`)
Created automatically on first crawl. No initialization needed.

### SaaS State (`../state/saas/`)
Created automatically on first auth operation (register, login). Files include:
- `users.json` — user records
- `orgs.json` — organization records
- `sessions.json` — active session tokens
- `usage.json` — per-org usage counters

No migration scripts or schema setup required. JSON files are created on first write.

## Build Process

```bash
cd enterprise
npm run build    # Compiles TypeScript, optimizes assets, generates static pages
```

Output:
```
✓ Compiled successfully
✓ Running TypeScript
✓ Collecting page data
✓ Generating static pages
✓ Finalizing page optimization

Route (app)
├ ○ /              (static)
├ ƒ /api/auth/*    (dynamic)
├ ƒ /api/*         (dynamic)
└ ...
```

Build output goes to `enterprise/.next/`. Serves via `npm start` or `next start`.

## Health Check

```
GET /api/health
```
Returns engine status. Requires authentication (cookie). Response:
```json
{ "status": "ok", "uptime": 1234 }
```
Or:
```json
{ "error": "Engine unavailable" }
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Engine unavailable" | Engine not running | Start engine: `npm start` |
| "Unauthorized" on API calls | Not logged in / expired session | Visit `/login` |
| Build fails with TypeScript errors | Type mismatch | Check `tsconfig.json` strict mode |
| Port conflict | 3000 or 3030 in use | Set `CSI_PORT` to different value; set `PORT` or use `next dev -p 3001` |
| "Cannot find module" | Dependencies not installed | Run `npm install` in both root and `enterprise/` |
