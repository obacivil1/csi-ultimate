# Final Gap Analysis — CSI-Ultimate v1.0-RC

**Date:** 2026-06-12
**Scope:** Full-system audit across 13 categories
**Sites:** expatriates.com, gumtree.com, london.craigslist.org, preloved.co.uk, olx.com.pk, bayt.com, sa.opensooq.com

---

## Category 1: Architecture

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| A1 | No dedicated discovery module — discovery logic inline in `csi-crawler-v9.mjs` | Evolutionary design; started as single-site crawler | Tight coupling; cannot test discovery independently | Medium | 2-3h | Extract discovery into `core/discovery-engine.mjs` |
| A2 | No dedicated recovery module — retry/failover in `rate-limiter.mjs` | Retry logic added as afterthought | Recovery logic mixed with rate limiting; cannot independently test | Medium | 1-2h | Extract RetryHandler into `core/recovery.mjs` |
| A3 | Export path hardcoded `./output/` in `buildFilename` | Shortcut in exporter.mjs:36-40 | `--output` flag ignored; all exports go to `./output/` regardless of `--output <dir>` | **✅ FIXED** | 15min | Added `outputDir` parameter to `buildFilename()`, threaded through `exportAll()` and v9 |
| A4 | No dependency injection — tight module coupling | Single-developer project | Difficult to mock/test; every module imports other modules directly | Hard | 4-6h | Accept for v1; document as limitation |
| A5 | No distributed mode support | Not in requirements | Cannot scale across machines | Hard | 40h+ | Document as out-of-scope |
| A6 | Arabic headers in ALL exports (not just Arabic sites) | exporter.mjs:58 uses HEADERS_AR always | Non-Arabic sites export Arabic column names | **Fixable now** | 30min | Pick header language per site config or CLI flag |

---

## Category 2: Extraction

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| E1 | **Preloved location missing** — empty for most ads | `[class*='location']` / `[class*='city']` don't match preloved's `.classified__location` | Missing location field in export | **Fixable now** | 5min | Add `.classified__location` to preloved location selectors |
| E2 | **OLX classifieds description** — fallback picks up promo text | CSS-module auto-generated class names; no stable selector | Description shows "OLX Car Inspection" instead of ad text on car pages | Hard (CSS-module) | 2-3h | Add regex text filter to skip known promo text in description fallback |
| E3 | **OLX Rent-a-Car / service pages price** — `rs,` or empty | Service pages don't have standard `.price` elements; text fallback picks up unrelated text | Low impact (service pages are a minority of listings) | **Fixable now** | 15min | Add service-page-specific skip pattern like `/rs,|rs\?\s*\d+/` to price filter |
| E4 | **Expatriates 14 description selectors** — shotgun approach | Unclear which selector(s) work; all variations included | Slows extraction; first match may be wrong | Medium | 30min | Probe expatriates.com to identify working selectors; remove dead ones |
| E5 | **Bayt extraction 0% due to Cloudflare** | Cloudflare Turnstile blocks all detail pages | Cannot extract any ads from bayt.com | External | Ongoing | Continue monitoring; cannot fix via code changes |
| E6 | **OpenSooq extraction impossible** — all search URLs 404 | Site structure changed; `GET /ar/search` no longer exists | Site is dead for crawling | External | 1h | Probe current URL structure; update config or document as permanently broken |

---

## Category 3: Discovery

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| D1 | **Craigslist ~20% discovery precision** | Link classifier doesn't filter out non-ad pages effectively | Many scraped pages are category/index pages that return null (wasted retries) | **Fixable now** | 1-2h | Add URL pattern filter to `selectCandidateLinks()` for known non-ad URL patterns (/search/, /sale/, etc.) |
| D2 | **Category pages scraped as ads** | `getLinksFromUrl()` returns non-ad links; `classifyPageState()` marks them as "content" | Wasted crawl capacity; retries on pagination/filter pages (observed in preloved: 5/25 failures were category pages) | **Fixable now** | 1h | Add URL pattern exclude list per site config; reject URLs matching `/classifieds/`, `/browse/`, `/search/` before extraction |
| D3 | **No discovery precision metric** | Precision never measured systematically | Cannot quantify improvement; blind to regressions | **Fixable now** | 30min | Add precision tracking to reporter: `discoveryPrecision = adsScraped / totalAttemptedUrls` |
| D4 | **AdaptiveDiscoveryEngine is underutilized** | `generateHypotheses()` is called but results are advisory only (no automated action) | Discovery engine output is logged but doesn't influence link selection | Medium | 2-3h | Wire hypothesis results into `selectCandidateLinks()` decisioning |

---

## Category 4: Classification

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| C1 | **Semantic classifier runs on every page** — no skip for known ad pages | Design: always classify | Adds ~500ms per page for already-known types | **Fixable now** | 30min | Add fast-path: if URL matches known ad pattern, skip classification |
| C2 | **Low-confidence pages still scraped** | No confidence threshold enforced | Pages classified as UNKNOWN_PAGE (confidence 0) consume browser contexts | **Fixable now** | 15min | Add `minClassificationConfidence` config option (default 0.3); reject pages below threshold |
| C3 | **Classifier dictionary outdated** | No update mechanism; all keywords hardcoded in JSON | May miss new site patterns or language variations | Medium | 2-3h | Add dictionary refresh mechanism; pull from config extension files |

---

## Category 5: Export

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| X1 | **Export path ignores `--output` flag** | buildFilename() hardcodes `./output/` | User-specified output dir is never used for export files | **Fixable now** | 15min | Pass outputDir through exportAll → buildFilename |
| X2 | **No export validation** | No post-export integrity checks | Corrupted exports go undetected | **Fixable now** | 30min | Add exportIntegrityCheck(): verify row count, required fields, file size > 0 |
| X3 | **Arabic headers for all exports** | exporter.mjs:58 uses HEADERS_AR always | English sites get Arabic column headers | **Fixable now** | 30min | Add `language` config field; select header set based on it |

---

## Category 6: Scheduler

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| S1 | **No cron expression support** — interval-only | Simple implementation | Cannot schedule "every Monday at 9am"; only "every N hours" | Medium | 3-4h | Add cron-parser dependency; accept cron expressions in `--schedule` |
| S2 | **No failure notification** | Not implemented | Failed scheduled jobs go unnoticed until human checks | **Fixable now** | 1h | Add optional webhook URL to scheduler config; POST failure notifications |

---

## Category 7: Recovery

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| R1 | **No session resume across restarts** | Cache saves ads; no mechanism to skip already-extracted URLs | If crawl interrupted at 150/500 ads, restart duplicates 150 | **Fixable now** | 1h | Wire dedupe to skip already-seen URLs before pushAll; add `--resume` flag that uses dedupe state |
| R2 | **Browser context leak risk** | `release()` in BrowserPool may not be called on all error paths | Stale browser contexts accumulate; pool degrades | Medium | 1h | Add `try/finally` guarantee pattern to all `withPage()` usages; add health-check on acquire |
| R3 | **No memory/queue health monitoring** | Not implemented | Queue can grow unbounded with failed items; no OOM prevention | **Fixable now** | 1h | Add `maxQueueSize` config; reject items beyond limit; add periodic memory check |

---

## Category 8: Data Quality

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| Q1 | **Preloved location missing** | Selector mismatch | Location field empty in exports | **Fixable now** | 5min | Add `.classified__location` to preloved config |
| Q2 | **OLX description on classifieds** — promo text instead of ad text | Fallback picks up the largest div which is often an OLX promo section | Description = "OLX Car Inspection Buy with confidence..." not car details | Medium | 2-3h | Add known-promo-text filter to description fallback in crawler-core.mjs |
| Q3 | **Expatriates extraction quality unverified** | Not tested during DQR phase | Unknown data quality; may have similar selector issues | **Fixable now** | 30min | Run 20-record probe on expatriates.com; check missing/empty fields |
| Q4 | **No cross-site DQ threshold enforcement** | Each site independently validated | No project-wide data quality gate | **Fixable now** | 30min | Add global DQ metric computation in reporter; fail session if threshold breached |

---

## Category 9: Performance

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| P1 | **Cache grows unbounded (10k ad entries)** | l1Max = 10,000 with 7-day TTL | Memory grows over time; no LRU eviction below max | **Fixable now** | 15min | Reduce adCache TTL to 1 day; add periodic purgeExpired() call in scheduler |
| P2 | **3 browser contexts max** | poolOpts size hardcoded | Cannot parallelize beyond 3 concurrent pages | **Fixable now** | 5min | Make concurrency configurable via `--concurrency` (already exists) |
| P3 | **No crawl speed tracking** | Not implemented | Cannot detect performance regressions | **Fixable now** | 15min | Add `adsPerMinute` metric to reporter; track over session |

---

## Category 10: Scalability

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| L1 | **500 pages/session limit hardcoded** | KNOWN_LIMITATIONS.md states it | Cannot crawl large sites beyond 500 pages | **Fixable now** | 5min | Make MAX_PAGES configurable; default 500, allow override |
| L2 | **No benchmark at 100/500/1000 ads** | Not tested | Unknown if export, memory, or scheduler degrades at scale | **Fixable now** | 1h | Run scale tests: 100, 500, 1000 ads; measure memory + timing |
| L3 | **No horizontal scaling** | Distributed mode not in design | Single machine bottleneck | Out of scope | 40h+ | Document as future work |

---

## Category 11: Site Config Quality

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| G1 | **OpenSooq config dead** — all searches 404 | Site structure changed; outdated endpoint | Config exists but produces zero results | **Fixable now** | 1h | Probe current OpenSooq structure; if still broken, demote to Tier D and document |
| G2 | **Expatriates has 14 description selectors** — no probe data | Never pruned; all variations added over time | Extraction may pick wrong element; page load penalty for 14 querySelector calls | **Fixable now** | 30min | Probe expatriates.com; reduce to working selectors only |
| G3 | **No config validation** — JSON schema validation missing | Not implemented | Config typos or missing fields cause runtime errors (observed with `param` vs `paramName` inconsistency) | **Fixable now** | 30min | Add JSON Schema validation on startup; fail fast on config errors |
| G4 | **`param` vs `paramName` inconsistency** | Some configs use `param`, others use `paramName` with `endpoint` | Confusing; new site configs may mix the two | **Fixable now** | 15min | Standardize on `param` for search query parameter name |

---

## Category 12: Anti-Bot

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| B1 | **Bayt.com fully blocked** by Cloudflare Turnstile | Server-side JS challenge; no programmatic bypass | 0% bayt extraction rate | External | Ongoing | Document as external constraint; monitor for changes |
| B2 | **OLX intermittent 1015 rate limit** | Aggressive Cloudflare rate limiting on certain URL patterns | 60% failure rate on some searches | **Fixable now (mitigate)** | 1h | Add per-site request pacing config; increase delay between OLX requests; randomize timing |
| B3 | **Expatriates ~40% Cloudflare failure** | Intermittent challenge page | Variable extraction rate | **Fixable now (mitigate)** | 1h | Retry with longer delays; add user-agent rotation list |
| B4 | **No proxy rotation support** | Not in design | IP-based blocking affects entire crawl session | Medium | 4-6h | Add optional proxy list; cycle on 403/429 detection |

---

## Category 13: Operations

| # | Issue | Root Cause | Impact | Fixability | Effort | Recommendation |
|---|-------|-----------|--------|------------|--------|---------------|
| O1 | **No monitoring/alerting** | Not implemented | System failures go unnoticed | Medium | 4-6h | Add health endpoint; integrate with n8n error handling |
| O2 | **No structured logging** | All logs via console.log/warn/error | No log levels, no searchability, no log rotation | Medium | 3-4h | Add logger module with file output, log levels, rotation |
| O3 | **No metrics dashboard persistence** | Dashboard is in-memory terminal UI only | Historical metrics lost on exit | **Fixable now** | 1h | Save dashboard metrics to JSON report at session end |

---

## Summary

| Category | Issues Found | Fixable Now | External/Out of Scope | Priority |
|----------|-------------|-------------|----------------------|----------|
| 1. Architecture | 6 | 2 | 3 | Medium |
| 2. Extraction | 6 | 3 | 2 | **High** |
| 3. Discovery | 4 | 3 | 0 | **High** |
| 4. Classification | 3 | 2 | 0 | Medium |
| 5. Export | 3 | 3 | 0 | **High** |
| 6. Scheduler | 2 | 1 | 0 | Low |
| 7. Recovery | 3 | 2 | 0 | Medium |
| 8. Data Quality | 4 | 2 | 0 | **High** |
| 9. Performance | 3 | 3 | 0 | Medium |
| 10. Scalability | 3 | 2 | 1 | Medium |
| 11. Site Config | 4 | 4 | 0 | **High** |
| 12. Anti-Bot | 4 | 2 | 2 | Medium |
| 13. Operations | 3 | 1 | 0 | Low |
| **Total** | **48** | **30** | **8** | |

**30 of 48 issues (63%) are fixable within the project.**
**8 are external constraints** (Cloudflare, site structure changes).
**10 require architectural work** (medium-to-hard effort, v1.1 scope).
