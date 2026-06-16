# Release Notes — CSI-Ultimate v1.0-RC

**Release Date:** 2026-06-12
**Version:** 9.0.0 → v1.0-RC

---

## Major Capabilities

- **Adaptive Discovery Engine** — Auto-discovers site structure, link patterns, and page types without hardcoded site-specific rules.
- **Semantic Page Classification** — Classifies pages as listing, detail, category, pagination, or search-result using content analysis rather than URL patterns.
- **Cross-Site Knowledge Transfer** — Learning from one site generalises to others via structural knowledge graphs.
- **Auto-Recovery** — Retry handlers, queue isolation, browser pool recovery, and scheduler resumption handle failures gracefully.
- **Scheduled Crawls** — Built-in cron-like scheduler with job persistence across restarts.
- **Real-Time Dashboard** — Live console dashboard showing crawl progress, decisions, and export status.

## Supported Modes

| Mode | Flag | Description |
|------|------|-------------|
| Keyword Search | `--search <keyword>` | Search one or more keywords |
| Category Crawl | `--categories` | Walk category tree and crawl |
| Scheduled Crawl | `--schedule <interval>` | Schedule recurring crawl |
| Test Mode | `--test` | Run unit test suite |
| Live Test | `--test-live` | Run live site validation tests |
| Smart Search | `--smart` | Keyword-filtered category crawl |
| Probe | `--probe` | Test site connectivity and structure |

## Supported Exports

| Format | Extension | Command |
|--------|-----------|---------|
| Excel | `.xlsx` | Default (auto-generated) |
| JSON | `.json` | `--export json` |
| CSV | `.csv` | `--export csv` |
| All | — | `--export all` |

All exports include: title, price, location, description, phone, email, URL, site name, crawl timestamp.

## Verified Sites

| Site | Status | Extraction Rate |
|------|--------|-----------------|
| expatriates.com | Full pipeline | ~60% (Cloudflare intermittent) |
| gumtree.com | Full pipeline | 100% |
| london.craigslist.org | Full pipeline | ~20% (link classifier refinement needed) |
| olx.com.pk | Full pipeline | 100% |
| preloved.co.uk | Full pipeline | 100% |
| bayt.com | Search + discovery | Blocked on detail pages (Cloudflare) |
| sa.opensooq.com | Search + discovery | Site structure changed |

## Key Improvements from Migration

- **From 26+ hardcoded site files** → 7 config-driven site profiles (JSON)
- **From manual pipeline** → fully automated adaptive discovery engine
- **From single-site architecture** → multi-site with knowledge transfer
- **From no failure handling** → 4-layer recovery (retry, queue, pool, scheduler)
- **From no persistence** → config profiles, session reports, exported data
- **Hardening suite** — 57/57 tests passing across 10 validation areas
- **Production acceptance** — 5/5 scenarios validated end-to-end
