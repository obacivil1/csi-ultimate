# CSI-Ultimate Scraper Audit & Capability Matrix

**Audit Date:** 2026-09-10  
**Auditor:** Senior Script Developer Review  
**Project:** CSI-Ultimate v9.0.0

---

## 1 — Executive Summary

The project contains **33+ scraper modules** across 6 directories, targeting **14 websites**. The architecture has a strong core (`core/`) but suffers from significant duplication across `app/`, `scripts/`, and legacy paths. Anti-detection and rate-limiting are production-grade. Data storage (JSON-on-disk) is the critical bottleneck for scalability.

**Overall Grade: B+** (Strong engineering, poor consolidation, no DB, no tests)

---

## 2 — Scraper Capability Matrix

### 2.1 Classifieds & Lead Scrapers

| Scraper | File | Target | Tech | Anti-Detect | Data Fields | Export | Grade |
|---|---|---|---|---|---|---|---|
| **Muqawil.org** | `core/crawler-core.mjs` + `run.mjs` | Contractor directory (SA) | Playwright + Stealth | Fingerprint rotation, adaptive delay 3–8s, history dedup | Name, phone, email, city, specialty, size, website | JSON/CSV/XLSX | **A** |
| **Expatriates.com** | `scripts/extract-planning-engineer.mjs` | Job/classified ads (SA) | Playwright + Stealth | Per-host rate limit, ban detection | Title, location, phone, email, date, category | JSON/CSV | **A-** |
| **Gumtree** | `core/bridge.mjs` (site config) | UK classifieds | Playwright + Stealth + FlareSolverr | Tiered stealth (normal/hard/extreme), Cloudflare wait | Title, price, phone, email, location, description | JSON/CSV/XLSX | **A-** |
| **Craigslist** | `core/bridge.mjs` (site config) | London classifieds | Playwright + Stealth | Adaptive rate limiter, fingerprint pool | Title, price, location, description, images | JSON/CSV/XLSX | **A-** |
| **Preloved** | `core/bridge.mjs` (site config) | UK classifieds | Playwright + Stealth | Self-healing selectors, scan-mode link discovery | Title, price, category, location | JSON/CSV/XLSX | **B+** |
| **OLX Pakistan** | `core/bridge.mjs` (site config) | Pakistan classifieds | Playwright + Stealth | Per-host limiter, Cloudflare bypass | Title, price, phone, location | JSON/CSV/XLSX | **B+** |
| **OpenSooq KSA** | `core/bridge.mjs` (site config) | Saudi classifieds | Playwright + Stealth | FlareSolverr fallback, ban detection | Title, price, phone, location | JSON/CSV/XLSX | **B+** |

### 2.2 Job Board Scrapers

| Scraper | File | Target | Tech | Anti-Detect | Data Fields | Export | Grade |
|---|---|---|---|---|---|---|---|
| **Indeed SA** | `core/indeed-api.mjs` + `bridge.mjs` | Job listings | Publisher API → RSS → Browser fallback | API-first (no detection needed), 10-min cache | Title, company, location, salary, date, URL | JSON/CSV/XLSX | **A+** |
| **Bayt.com** | `app/bayt_jobs.mjs` | Job listings (MENA) | Playwright + Stealth | Cloudflare challenge handling | Title, company, location, description | JSON/CSV | **B** (CF issues) |
| **Google Jobs** | `scripts/jobs-planning-engineer.mjs` | Job widget | Google SERP → Playwright | Minimal (public widget) | Title, company, location, date | JSON | **B** |
| **Bing SERP** | `scripts/job-hunter/nav.mjs` | Link discovery | HTTP fetch | Fingerprint rotation, 700ms–12s adaptive | URLs, snippets | Internal | **A-** |
| **LinkedIn** | `scripts/job-hunter/_probe_li.mjs` | Profile probe | Playwright | Login-wall detection, abandoned | N/A (probe only) | N/A | **D** (blocked) |

### 2.3 Saudi B2B / Tender Scrapers

| Scraper | File | Target | Tech | Anti-Detect | Data Fields | Export | Grade |
|---|---|---|---|---|---|---|---|
| **Etimad Tenders** | `scripts/lead-gen/etimad-tenders.mjs` | Saudi government tenders | Playwright | Delay 4s between pages, stateful session | Tender ID, title, entity, value, deadline, status | JSON (served via web API) | **A** |
| **Etimad Awards** | `scripts/lead-gen/etimad-awards.mjs` | Contract awards + bidders | Playwright | Same + Arabic table parsing | Award ID, winner, value, bidders, dates | JSON | **A** |
| **Etimad Update** | `scripts/lead-gen/etimad-update.mjs` | Incremental tender refresh | Playwright | Same as etimad-tenders | Delta records only | JSON (git-committed) | **A** |
| **Saudi Gulf Projects** | `scripts/lead-gen/scrape-saudi-gulf-projects.mjs` | Project news RSS | xml2js RSS parser | N/A (RSS = no detection) | Title, description, date, URL | JSON | **A+** |
| **Muqawil All Regions** | `scripts/lead-gen/muqawil-all-regions.mjs` | Full contractor DB | Playwright | Stealth + concurrency 6 | All fields + phone mining | JSON (8,136 records) | **A** |

### 2.4 Presentation & Pipeline Generators

| Module | File | Purpose | Input | Output | Grade |
|---|---|---|---|---|---|
| **Presentation Engine** | `engine/presentation-engine.mjs` | 8-slide PPTX proposals | Company JSON data | PPTX (cover, exec summary, data, capabilities, portfolio, EVM, recs, closing) | **A** |
| **Scrape + Present** | `app/scrape_and_present.mjs` | Scrape → PPTX pipeline | URL/keyword | PPTX + data | **B+** |
| **Sales PPT** | `scripts/lead-gen/sales_ppt.mjs` | Sales deck generator | Lead data | PPTX | **B** |
| **Email Pipeline (n8n)** | `n8n-workflow/orchestrator.mjs` | Lead scoring + email alerts | Extracted leads | SMTP emails (score ≥65) | **A-** |
| **Full Pipeline** | `app/full_pipeline.mjs` | Classifieds pipeline v1 | Keywords | JSON/CSV/XLSX | **B+** |
| **Pipeline v2** | `app/pipeline_v2.mjs` | Classifieds pipeline v2 | Keywords | JSON/CSV/XLSX | **A-** |

### 2.5 Infrastructure & Support Modules

| Module | File | Purpose | Grade |
|---|---|---|---|
| **Bridge Extractor** | `core/bridge.mjs` | 4-strategy extraction pipeline (API → RSS → Browser → FlareSolverr) | **A** |
| **Rate Limiter** | `core/rate-limiter.mjs` | Adaptive per-host + ban detection + exponential backoff | **A+** |
| **Anti-Detect** | `core/anti-detect.mjs` | 3-tier stealth (normal/hard/extreme) | **A** |
| **Fingerprint Engine** | `core/fingerprint-engine.mjs` | Random browser fingerprint + UA pool | **A** |
| **Behavior Engine** | `core/behavior-engine.mjs` | Human-like mouse/keyboard simulation | **A-** |
| **FlareSolverr Client** | `core/flare-solver.mjs` | CF bypass sidecar + LRU cache | **A-** |
| **Canonical Extractor** | `core/canonical-extractor.mjs` | Standardized record model + phone/email validation | **A** |
| **Site Adapter** | `core/site-adapter.mjs` | Per-site config loader + validation | **A** |
| **Dedupe** | `core/dedupe.mjs` | URL + content hash + Bloom filter | **A** |
| **Cache** | `core/cache.mjs` | L1/L2 TTL cache | **B+** |
| **Exporter** | `core/exporter.mjs` | XLSX/CSV/JSON + bilingual headers | **A** |
| **Session Manager** | `core/session-manager.mjs` | Cookie/token persistence + webhook alerts | **B+** |
| **Validation Engine** | `core/validation-engine.mjs` | Trust score A–F, field accuracy, site certification | **A** |
| **Insight Engine** | `core/insight-engine.mjs` | Lead quality scoring | **A-** |
| **Scheduler** | `core/scheduler.mjs` | Persisted crawl jobs | **B+** |

---

## 3 — Domain Coverage Summary

| Domain | Sites Covered | Scraper Quality | Status |
|---|---|---|---|
| **Saudi Contractors** | muqawil.org | Excellent | Production (8,136 records) |
| **Saudi Tenders** | tenders.etimad.sa | Excellent | Production (auto-update via GitHub Actions) |
| **Saudi Projects** | saudigulfprojects.com | Excellent | Production (daily RSS) |
| **UK Classifieds** | gumtree, craigslist, preloved | Very Good | Production |
| **SA/UAE Classifieds** | sa.opensooq.com | Good | Production |
| **Pakistan Classifieds** | olx.com.pk | Good | Production |
| **Job Boards** | indeed.com (API), expatriates.com | Very Good | Production |
| **Job Boards** | bayt.com | Fragile | Cloudflare blocked |
| **LinkedIn** | linkedin.com | Blocked | Login-wall, probe only |
| **Planning Forums** | planningplanet.com | Good | Lead extraction |

---

## 4 — Technical Strengths

| # | Strength | Evidence |
|---|---|---|
| 1 | **Multi-strategy extraction** | Bridge uses 4 fallback strategies: API → RSS → Browser → FlareSolverr |
| 2 | **Adaptive rate limiting** | Per-host limits (700ms–12s), exponential backoff, recovery factor 0.9 |
| 3 | **Ban detection** | Content-based (captcha, CF, DDoS patterns) + HTTP code (403/429/503) |
| 4 | **Fingerprint rotation** | Random UA, viewport, WebGL, canvas fingerprint per session |
| 5 | **Indeed API-first** | Publisher API + 10-min cache → RSS fallback → Browser last resort |
| 6 | **Email validation pipeline** | MX verification + DNS cache + scoring ≥30 + blocked domain list |
| 7 | **UAT instrumentation** | Structured lifecycle tags, E001–E014 error codes, alert webhooks |
| 8 | **Bilingual export** | EN/AR headers for Arabic clients via exporter.mjs |
| 9 | **Self-healing selectors** | Scan-mode regex link discovery when primary selectors fail |
| 10 | **Site certification system** | Trust score A–F, field accuracy metrics, audit samples |

---

## 5 — Critical Issues & Risks

| # | Issue | Severity | Impact |
|---|---|---|---|
| 1 | **No database** | **HIGH** | All data in JSON files on disk; O(n) re-reads per request; no ACID; no concurrent access safety |
| 2 | **Triple extraction duplication** | **HIGH** | `bridge.mjs` / `canonical-extractor.mjs` / `engine/server.mjs` each implement extraction differently |
| 3 | **33+ diagnostic scripts** | **MEDIUM** | `scripts/diagnostics/` contains dead code; `state/test_*.mjs` clutter |
| 4 | **3 HTTP servers running** | **MEDIUM** | `app/server.mjs` (3456) + `engine/server.mjs` (3030) + `web/server.mjs` (3000 PM2) — overlapping |
| 5 | **Hardcoded secrets** | **HIGH** | Admin email `obacivil@gmail.com` in code; JWT_SECRET in docker-compose |
| 6 | **No .env validation** | **MEDIUM** | 15+ env vars with silent defaults; missing JWT_SECRET = runtime crash |
| 7 | **No structured logging** | **MEDIUM** | All `console.log`; no rotation, no levels, no file output in production |
| 8 | **No automated tests** | **HIGH** | Zero unit/integration tests; validation only manual via diagnostic scripts |
| 9 | **Bayt.com Cloudflare** | **MEDIUM** | Site config exists but scraper is effectively blocked |
| 10 | **LinkedIn completely blocked** | **LOW** | Probe-only; login wall cannot be bypassed ethically |
| 11 | **ToS compliance risk** | **HIGH** | Stealth/fingerprint rotation on classifieds/job boards violates most ToS |
| 12 | **Scattered rate-limit constants** | **LOW** | etimad DELAY_MS=4000, app sleeps — not centralized in rate-limiter.mjs |

---

## 6 — Senior Developer Recommendations

### Phase 1: Stabilize (1–2 weeks)

| # | Action | Priority | Effort |
|---|---|---|---|
| 1 | **Consolidate extraction** → Merge `bridge.mjs` + `canonical-extractor.mjs` into one `core/extractor.mjs`; delete duplicates in `engine/server.mjs` | P0 | 3 days |
| 2 | **Add .env + boot validation** → `dotenv` + schema check at startup; fail-fast on missing required vars | P0 | 0.5 day |
| 3 | **Archive dead code** → Move `scripts/diagnostics/`, `state/test_*.mjs`, root artifacts to `archive/` | P1 | 0.5 day |
| 4 | **Add structured logging** → Replace `console.log` in `core/` with `pino` (JSON output, log levels, file rotation) | P1 | 2 days |
| 5 | **Kill duplicate servers** → Keep only `web/server.mjs` (PM2); merge `engine/server.mjs` routes into it; deprecate `app/server.mjs` | P1 | 1 day |

### Phase 2: Strengthen (2–4 weeks)

| # | Action | Priority | Effort |
|---|---|---|---|
| 6 | **SQLite/Postgres for core data** → Replace `data/*.json` with DB for tenders, contractors, awards, projects; keep JSON only for config | P0 | 1 week |
| 7 | **Add integration tests** → Playwright test suite for each site adapter; CI via GitHub Actions | P0 | 1 week |
| 8 | **Centralize rate-limit config** → All delay/timeout constants in `config/defaults.json`; import everywhere | P1 | 1 day |
| 9 | **Extract hardcoded secrets** → Move admin email, JWT config, API keys to `.env`; never commit | P0 | 0.5 day |
| 10 | **Add job queue (BullMQ/Redis)** → Replace `WorkerQueue` + JSON state with proper job queue for crawl scheduling | P1 | 3 days |

### Phase 3: Scale (1–2 months)

| # | Action | Priority | Effort |
|---|---|---|---|
| 11 | **Proxy rotation support** → `CSI_PROXY` already exists; implement proxy pool with health checks | P1 | 2 days |
| 12 | **Bayt.com fix** → Either solve CF challenge via FlareSolverr v2 or abandon and document | P2 | 2 days |
| 13 | **Add new sites** → LinkedIn Sales Navigator (paid API), Twitter/X API, Arabia.com | P2 | 1 week |
| 14 | **Monitoring dashboard** → Grafana + Prometheus for crawl success rates, ban counts, extraction accuracy | P2 | 1 week |
| 15 | **API versioning** → `/api/v1/` prefix; deprecate current endpoints gracefully | P2 | 2 days |

---

## 7 — Per-Scraper Detailed Notes

### 7.1 Muqawil.org (Best-in-class)
- **8,136 contractor records** across all Saudi regions
- Phone mining pass (`muqawil-phones.mjs`) with concurrency 6
- Filtered CLI export (--city, --has-email, --has-phone, --size, --format)
- **Recommendation:** Add periodic re-scrape (monthly) to catch new contractors; consider web scraping for phone numbers that require detail-page visits

### 7.2 Etimad Tenders/Awards (Production-critical)
- Auto-update via GitHub Actions every 6 hours
- Full tender list + awards with bidder analysis
- Arabic table parsing (complex DOM)
- **Recommendation:** The 4s delay is excessive for RSS-like updates; reduce to 2s with ban-detection fallback. Add tender-value parsing (currently text-based, not numeric)

### 7.3 Indeed Integration (Gold standard)
- API-first approach (Publisher API) → 10-min cache → RSS fallback → Browser last
- **Recommendation:** This pattern should be the template for ALL job board scrapers. Replicate for Bayt (if API available) and LinkedIn (if API access obtained)

### 7.4 Job Hunter Engine (Advanced but fragile)
- Multi-source: expatriates.com + Bing discovery + Indeed API
- Budget-managed (420s default)
- Advisor scoring per source (persisted in `jobhunter-advisor.json`)
- MX email verification with DNS cache
- **Recommendation:** The advisor scoring system is sophisticated but untested. Add unit tests for the scoring logic; the budget system needs a UI/dashboard for monitoring

### 7.5 Classifieds Pipeline (Functional but duplicated)
- `full_pipeline.mjs` (v1) and `pipeline_v2.mjs` (v2) coexist
- v2 uses `WorkerQueue` + `rate-limiter` + `exporter` properly
- v1 is legacy
- **Recommendation:** Delete v1; v2 is the production path. Document the pipeline stages clearly

---

## 8 — Code Metrics

| Metric | Value |
|---|---|
| Total scraper files | 33+ |
| Core infrastructure modules | 57 (in `core/`) |
| Diagnostic/test scripts | 46+ (in `scripts/diagnostics/`) |
| Target websites | 14 |
| Production datasets | 5 (muqawil, etimad-tenders, etimad-awards, saudi-projects, expat-jobs) |
| Total records scraped | 8,136+ (muqawil) + all etimad tenders/awards |
| Env variables | 15+ |
| HTTP servers | 3 (should be 1) |
| Automated tests | 0 |
| Database | 0 (JSON only) |
| Lines of code (estimated) | 15,000+ |
| Dependencies | 25+ (package.json) |

---

## 9 — Final Assessment

| Category | Grade | Notes |
|---|---|---|
| **Anti-Detection** | A+ | Industry-standard stealth; adaptive rate limiting; fingerprint rotation; FlareSolverr fallback |
| **Data Extraction** | A- | Strong bridge pattern; 4-strategy fallback; self-healing selectors |
| **Email/Contact Mining** | A | MX verification, scoring, blocked domains, context-aware extraction |
| **Architecture** | B | Good core design; poor consolidation; triple duplication; 3 servers |
| **Data Storage** | D+ | JSON files only; no DB; no concurrent access safety; O(n) reads |
| **Testing** | F | Zero automated tests |
| **Documentation** | C | Bilingual console output; no API docs; no architecture diagrams |
| **Scalability** | C+ | Works for current scale; will break at 10x load without DB + job queue |
| **Security** | C | Hardcoded secrets; no .env validation; ToS compliance risks |
| **Operations** | B | PM2 + Docker + GitHub Actions cron; but no monitoring/alerting |

**Overall: B+ (Strong engineering foundation, critical gaps in consolidation, testing, and data layer)**

---

## 10 — Implementation Status (updated 2026-09-10)

Progress applied in parallel after the audit. Verified via `npm run test` → **26/26 tests pass**.

| # | Audit Recommendation | Status | Evidence |
|---|---|---|---|
| 1 | Consolidate extraction (`bridge.mjs` + `canonical-extractor.mjs` → `core/extractor.mjs`) | **DONE** | `core/extractor.mjs` is the single extraction gateway (CF gate + canonical DOM pass + SAR currency). `bridge.mjs`/`canonical-extractor.mjs` kept as re-export shims. Fixed `engine/server.mjs` calling undefined `canonicalExtract`. Guarded by extraction-comparison tests |
| 2 | Add `.env` + boot validation (`config/env.mjs` + `env.validate()`) | **DONE** | `config/env.mjs`, `.env`, `.env.example`; fail-fast in production on missing/default `JWT_SECRET` |
| 3 | Archive dead code | **DONE** | `scripts/diagnostics/` → `archive/scripts/diagnostics/`; `state/test_*` → `archive/state/test_scripts/`; root artifacts → `archive/root_artifacts/` |
| 4 | Add structured logging | **DONE** | `core/logger.mjs` (JSON, levels, child bindings) wired into `bridge.mjs`, `flare-solver.mjs`, `rate-limiter.mjs`, `web/server.mjs`, `engine/server.mjs`, `app/server.mjs` (deprecation) |
| 5 | Kill duplicate servers | **DONE** | `engine/server.mjs` (3030) is now a **deprecated compatibility shim** re-exporting `web/routes/engine.mjs`; all engine routes (crawl, search/SSE, sites, reports, jobs, validation, insights, evidence) are mounted at `/api` in `web/server.mjs` (3000) with the engine UI at `/engine`. `app/server.mjs` (3456) marked DEPRECATED (kept for `START_SCRAPER.bat`) |
| 6 | SQLite for core data | **DONE** | `core/db.mjs` (WAL, upsert); `scripts/db-import.mjs` imported tenders 8,303 / contractors 13,375 / awards 20 / projects 1,222 |
| 7 | Add automated tests | **DONE (unit)** | `tests/` via `node --test`: config, db, rate-limiter, canonical, extraction-comparison (26 tests green). Playwright per-site integration = PHASE 2 |
| 8 | Centralize rate-limit config | **DONE** | `config/defaults.json` (`rateLimit`); `core/rate-limiter.mjs` reads it; etimad uses `siteDelay.etimadMs` (4000) |
| 9 | Extract hardcoded secrets | **DONE** | Admin email, JWT, SMTP, API keys → `.env`; `validate()` enforces in production |
| 10 | Job queue (BullMQ/Redis) | NOT STARTED | Future phase 2 |
| 11 | Proxy rotation | NOT STARTED | `CSI_PROXY` exists; pool w/ health checks pending |
| 12 | Bayt.com fix | NOT STARTED | CF challenge via FlareSolverr v2 evaluation |
| 13 | New sites | NOT STARTED | — |
| 14 | Monitoring dashboard | NOT STARTED | — |
| 15 | API versioning | NOT STARTED | — |

### Regression-fix bonus findings (found via new tests)
- `core/db.mjs#query` ignored `params` (passed only limit/offset) — fixed, now interpolates `params` + limit/offset.
- `core/rate-limiter.mjs` BAN_PATTERNS missed Cloudflare's `"just a moment"` / `"checking your browser"` interstitial — added (real ban-detection gap).
- `core/canonical-extractor.mjs` `detectCurrency` did not recognize `SAR`/`ر.س`/`ريال` — added.
- `canonical-extractor.mjs` had **no Saudi phone support**: `cleanPhone`/`isValidPhone` were GB-only (`0[0-9]...`/`+44`). Added SA formats (`+9665xxxxxxxx`, local `05xxxxxxxx` → `+966`), and fixed SA-priority ordering so `055...` (Arabic sites) normalizes to `+9665...` instead of being parsed as a UK-style number.
- `canonical-extractor.mjs#getAllText` crashed on pages where `querySelectorAll` matched elements without `innerText` (Arabic classifieds) — the whole extract crashed. Hardened with optional chaining; `crumbs` and `telLinks` similarly hardened.
- **`engine/server.mjs` called undefined `canonicalExtract`** — every ad extraction through engine would have thrown `ReferenceError`. Routed to `core/extractor.mjs`.
- `tests/config.test.mjs` originally used `await import` at top level of a sync test → syntax error; rewritten.
- jsdom (used for offline DOM extraction tests) does not implement `innerText` — the test harness shims it via `textContent`.

### Security hardening (2026-09-10) — post-audit review

Triage produced 4 critical/high + 3 medium findings in the `web/` app. All fixed immediately (in parallel) and verified live.

| # | Severity | Finding | Fix | Verification |
|---|---|---|---|---|
| 1 | **CRITICAL** | `capture-order` accepted any client-supplied `MOCK-`/`ADMIN-` order id → any registered user could upgrade to `professional` with no PayPal charge | Legacy `MOCK-` rejected with 400 for **every** user; `ADMIN-` mock restored **admin-only** (verified via `isAdmin(email)` on the JWT) and still goes through the same plan/order validation | Live E2E: normal user `MOCK-999` → `400 {"error":"طلب وهمي غير مسموح"}`; admin `ADMIN-` flow intact |
| 2 | **CRITICAL** | Startup `console.log` printed every `PAYPAL`/`JWT`/`PORT` env key name | Removed; replaced with structured `logger.info` of booleans only (`paypalConfigured`, `sandbox`) | No key names in `/api/_health` or boot logs |
| 3 | **HIGH** | `GET /api/payments/config` returned real `clientId` + list of PAYPAL env keys to any visitor | Returns `{ configured, live }` only | Live: `{"configured":false,"live":false}` |
| 4 | **HIGH** | `web/data/users.json` (users + bcrypt hashes) was git-tracked | `git rm --cached` + added to `.gitignore` (file stays local; deploy boots to empty store safely) | `git status` shows `D web/data/users.json` |
| 5 | **MEDIUM** | PayPal webhook accepted unauthenticated POSTs; no signature check | Full local validation: requires `PAYPAL_WEBHOOK_ID`, transmission headers, and constant-time HMAC-SHA256 of `transmission_id\|transmission_time\|webhook_id\|crc32(body)` keyed with client secret | Missing headers/secret → 400/401 |
| 6 | **MEDIUM** | CORS `origin:true, credentials:true` echoed any origin with cookies | Restrictive allow-list from `ALLOWED_ORIGINS` env (default: production domain + localhost) | Non-listed origin → no CORS headers |
| 7 | **MEDIUM** | Global 200/15min limiter only; auth/payments share it | Added `authLimiter` 30/15min + `paymentLimiter` 20/hour, mounted before routers | Verified boot + probe |

Additional hardening during the same pass:
- `web/middleware/auth.mjs` read `process.env.JWT_SECRET` directly and called `process.exit(1)`; now reads the centralized `env.JWT_SECRET` and throws a descriptive boot error instead.
- Webhook upgrade only ever targets the user whose stored `paypalSubscriptionId` matches the PayPal `order_id` (unchanged invariant, now behind signature verification).
- Corrected the admin test-mode flow so `create-order` (issues `ADMIN-`) and `capture-order` (consumes it) share the same `isAdmin` check — consistent and not re-entrant per user.

### Remaining priorities (from audit)
1. ~~Consolidate extraction~~ **DONE** via `core/extractor.mjs` (single gateway, tests green).
2. ~~Full route merge of `engine/server.mjs` into `web/server.mjs`~~ **DONE** (2026-09-10): single-source `web/routes/engine.mjs` mounted on `web/server.mjs`; stripped dup `/api/health` + removed permissive `Access-Control-Allow-Origin:*` on the SSE stream; verified live on both servers.
3. Playwright per-site adapter integration suite + GitHub Actions CI.
4. Job queue (BullMQ/Redis), proxy pool, monitoring dashboard, API versioning (Phase 3).
