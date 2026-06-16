# MULTI-SITE PROOF

## Summary

Three new sites were onboarded using configuration files only, with three
architecture defects discovered and fixed in the core engine (adapter, link
classifier, link extraction). All three sites hit anti-bot protection during
extraction, preventing full end-to-end validation.

---

## Site 1: Bayt.com

| Field       | Result |
|-------------|--------|
| Config      | config/sites/bayt.com.json |
| Engine changes | YES (3 defects) |
| Search      | PASS - 279 links from live DOM (vs 40 with HTML regex) |
| Discovery   | PASS - Individual job pages selected (score 8 vs 7 for categories) |
| Extraction  | FAIL - Cloudflare blocks individual job pages after first request |
| Classify    | PARTIAL - LD+JSON available in initial page load before CF block |
| Export      | FAIL - No ads extracted due to Cloudflare |
| Verdict     | FAIL |

**What worked:** Search URL resolved correctly to /en/jobs/?q=engineer. Live
DOM extraction found 279 candidate links including 91 actual job pages
(individual job URLs like /en/uae/jobs/...-5461434/). Link classifier fix
recognized /jobs/ paths as "detail" type (score +5) instead of "category"
(score +3).

**What failed:** First job page loaded (4899 bytes, full content),
subsequent pages triggered Cloudflare challenge (258 bytes, "Just a
moment..."). All 3 retries exhausted.

---

## Site 2: OLX Pakistan

| Field       | Result |
|-------------|--------|
| Config      | config/sites/olx.com.pk.json |
| Engine changes | YES (uses urlTemplate) |
| Search      | FAIL - Cloudflare blocks search page (Error 1015) |
| Discovery   | FAIL - No links extracted |
| Extraction  | FAIL - N/A |
| Classify    | FAIL - N/A |
| Export      | FAIL - N/A |
| Verdict     | FAIL |

**What worked:** Search URL template resolved correctly to /items/q-car
(path-based search). Adapter fix for urlTemplate works (tested standalone).

**What failed:** OLX search page returns Cloudflare "Access denied" (Error
1015) on every request. Homepage loads fine but search endpoint is
protected. Not fixable through configuration.

---

## Site 3: OpenSooq (السوق المفتوح)

| Field       | Result |
|-------------|--------|
| Config      | config/sites/sa.opensooq.com.json |
| Engine changes | NO (config only) |
| Search      | FAIL - JS-rendered page (729 bytes, empty title, 0 ads) |
| Discovery   | FAIL - Only navigation links found |
| Extraction  | FAIL - N/A |
| Classify    | FAIL - N/A |
| Export      | FAIL - N/A |
| Verdict     | FAIL |

**What worked:** Search URL resolved correctly to /ar/search?q=car. Config
file has correct search endpoint and param.

**What failed:** OpenSooq's search results are rendered entirely via
JavaScript (React SPA). Initial HTML is 729 bytes with empty title. Even
Puppeteer's live DOM (after smartLoad + wait) shows no job/ad content.
Site also returns 403 on direct curl requests.

---

## Reference: Expatriates.com (control test)

| Field       | Result |
|-------------|--------|
| Config      | config/sites/expatriates.com.json |
| Engine changes | NO (unchanged) |
| Search      | PASS - 53 links found |
| Discovery   | PASS - /cls/63482803.html |
| Extraction  | PASS - 2/2 ads extracted (100%) |
| Classify    | PASS - JOB_AD_PAGE detected |
| Export      | PASS - Excel export OK |
| Verdict     | PASS |

**Confirm:** All existing tests pass (35/35) and live extraction unchanged.

---

## Architecture Defects Discovered

### Defect 1: Path-based search not supported (FIXED)
- File: core/site-adapter.mjs
- getSearchUrl() assumed query-param search only (?q=keyword)
- Added "urlTemplate" config option supporting {keyword}/{page}/{baseUrl}
- Required for OLX (/items/q-{keyword}) and similar sites
- Fix: Add urlTemplate support

### Defect 2: Link classifier missing common ad URL patterns (FIXED)
- File: core/crawler-core.mjs (classifyDiscoveryLink)
- Only recognized /ad/, /cls/, /detail/, /view/ as "detail" links
- Missing: /jobs/, /item/, /post/, /listing/ (common on modern sites)
- Without fix, ALL Bayt links classified as "category" (score 3 vs 5)
- Fix: Add /jobs?/, /item/, /post/, /listing/ to detail detection

### Defect 3: HTML regex link extraction misses >50% of links (FIXED)
- File: core/keyword-search.mjs (searchByKeyword)
- Used discoverLinksFromHtml() with regex on page.content()
- Regex misses <a> tags with multi-line content or complex HTML
- Bayt: 492 <a> tags in HTML but regex only found 220 (55% miss rate)
- Fix: Extract links from live DOM via page.evaluate()

---

## Config Files Created

| File | Lines | Purpose |
|------|-------|---------|
| config/sites/bayt.com.json | 45 | Search, extraction, pagination for Bayt jobs |
| config/sites/olx.com.pk.json | 44 | Path-based search, OLX ad extraction |
| config/sites/sa.opensooq.com.json | 44 | Arabic search, OpenSooq extraction |

---

## Final Verdict

Multi-Site Not Proven

All three target sites fail at extraction due to anti-bot protection
(Cloudflare) or JS rendering, not due to architecture issues. The core
engine now correctly discovers and selects individual ad pages for Bayt
(verified by debug), and the config layer supports all necessary site
variations. However, end-to-end extraction requires a Cloudflare bypass
solution that is outside the scope of this migration.
