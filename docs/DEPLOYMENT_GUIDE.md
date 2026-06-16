# Deployment Guide — CSI-Ultimate v1.0-RC

---

## Prerequisites

| Requirement | Minimum Version |
|-------------|-----------------|
| Node.js | 18.x (tested on 24.16.0) |
| npm | 8.x |
| OS | Windows 10+, macOS 12+, Ubuntu 20.04+ |

## Installation

```bash
# 1. Extract or clone the project
cd csi-ultimate

# 2. Install dependencies
npm install

# 3. Verify installation (no browser automation)
node csi-crawler-v9.mjs --help

# 4. Install Playwright browsers (required for headless browsing)
npx playwright install chromium
```

## Dependencies

| Package | Purpose |
|---------|---------|
| playwright | Browser automation engine |
| playwright-extra | Plugin wrapper for Playwright |
| puppeteer-extra-plugin-stealth | Anti-detection evasion |
| xlsx | Excel (.xlsx) export |

All installed automatically by `npm install`.

## Environment Setup

No environment variables are required. The system uses:
- **Config files**: `config/sites/*.json` — site-specific profiles (7 pre-configured)
- **Job persistence**: `.crawl-scheduler.json` — auto-created on first scheduled crawl
- **Output**: `output/` — auto-created on first crawl

### Optional Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `HEADLESS` | Set to `false` to watch browser | `true` |
| `CRAWL_TIMEOUT` | Page timeout in ms | `30000` |
| `RATE_LIMIT` | Min ms between requests | `2000` |

## First Run Procedure

### 1. Basic Keyword Search

```bash
node csi-crawler-v9.mjs --url https://www.expatriates.com --search "driver" --max-pages 3
```

Expected output:
- Dashboard initialises with progress bars
- Crawl completes in 30–60 seconds
- Excel file created in `output/` directory

### 2. Verify Output

```bash
# List crawl output files
Get-ChildItem -LiteralPath output/ -Filter "*.xlsx" | Select-Object Name, Length
```

Check that the Excel file contains:
- Title, Price, Location, Description, URL columns
- At least 1 ad row

### 3. Run Test Suite

```bash
npm test
```

Expected output: All unit tests pass (32/32 or full suite).

### 4. Multi-Site Quick Test

```bash
node csi-crawler-v9.mjs --url https://www.gumtree.com --search "bicycle" --max-pages 2
node csi-crawler-v9.mjs --url https://london.craigslist.org --search "sofa" --max-pages 2
```

## Verification Commands

### Help and Version

```bash
node csi-crawler-v9.mjs --help      # Print full CLI reference
node csi-crawler-v9.mjs --version   # Print version
```

### Command Reference

```bash
# Keyword search (single)
node csi-crawler-v9.mjs --url <URL> --search "<keyword>"

# Keyword search (multiple)
node csi-crawler-v9.mjs --url <URL> --search "keyword1,keyword2,keyword3"

# Category crawl
node csi-crawler-v9.mjs --url <URL> --categories

# Smart search (keyword-filtered categories)
node csi-crawler-v9.mjs --url <URL> --smart-search --search "<keyword>"

# Probe (test site connectivity and structure)
node csi-crawler-v9.mjs --probe <URL>

# Scheduled crawl
node csi-crawler-v9.mjs --url <URL> --search "<keyword>" --schedule 1h

# View scheduled jobs
node csi-crawler-v9.mjs --url <URL> --status

# Export formats
node csi-crawler-v9.mjs --url <URL> --search "<keyword>" --format json
node csi-crawler-v9.mjs --url <URL> --search "<keyword>" --format csv
node csi-crawler-v9.mjs --url <URL> --search "<keyword>" --format excel,csv,json

# Concurrency tuning
node csi-crawler-v9.mjs --url <URL> --search "kw1,kw2,kw3" --concurrency 3

# Custom config profile
node csi-crawler-v9.mjs --url <URL> --search "<keyword>" --profile myprofile

# Max pages / max ads limits
node csi-crawler-v9.mjs --url <URL> --search "<keyword>" --max-pages 5 --max-ads 20

# Test mode
node csi-crawler-v9.mjs --test

# Live validation tests
node csi-crawler-v9.mjs --test-live
```

## Installing Playwright Browsers

If you see errors about missing browser executables:

```bash
npx playwright install chromium
```

This downloads Chromium to `~\.cache\ms-playwright\` (~300 MB).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Cannot find module 'playwright'` | Run `npm install` |
| `Browser not found` | Run `npx playwright install chromium` |
| `ECONNREFUSED` on search | Site may be blocking — try `--probe` first |
| All pages return null | Site structure may have changed — check config |
| Cloudflare challenge appears | Documented limitation — see KNOWN_LIMITATIONS.md |
| Slow crawl | Increase `--parallel` or reduce `--max-pages` |
