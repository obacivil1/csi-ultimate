# REAL_WORLD_VALIDATION.md

**Date**: 2026-06-11
**Crawler Version**: v9.0.0 (csi-crawler-v9.mjs)
**Node Version**: v24.16.0
**Browser**: Playwright (headless Chromium) + puppeteer-extra-plugin-stealth

---

## Sites Tested

| # | Site | Mode | Result |
|---|------|------|--------|
| 1 | expatriates.com | `--search` (GET) | **SUCCESS** 5/5 ads |
| 2 | expatriates.com | `--search --post` | **FAILED** 0 ads |
| 3 | expatriates.com | `--categories` | **PARTIAL** Cloudflare block |
| 4 | expatriates.com | `--smart-search` | **PARTIAL** Cloudflare block |
| 5 | expatriates.com | `--probe` | **SUCCESS** mechanism identified |
| 6 | olx.com.pk | `--search` (GET) | **FAILED** 0/3 ads extracted |

---

## Site 1: expatriates.com — GET Search Mode

**Command**: `--url https://www.expatriates.com --search "driver" --max-ads 5 --max-pages 2 --delay 500 --output ./output/validate-get`

### Discovery Metrics
- Keywords searched: 1 ("driver")
- Ad links discovered: 50 (page 1, cached from previous run)
- Ad links after dedupe: 5
- Pages crawled: 0 (cache hit)

### Extraction Metrics
- Ads targeted: 5
- Ads extracted: 5
- Extraction success rate: **100%**
- Retries: 0
- Errors: 0

### Classification Metrics
- All 5 URLs classified as `JOB_AD_PAGE` (confidence: 0.625)
- Classification appears conservative (0.625 = moderate confidence)

### Export Verification
- Excel file: `output\crawl_2026_06_11_03_57_2026-06-11_0358.xlsx` (22,711 bytes)
- JSON report: generated
- Formats used: Excel only (default)

### Runtime
- Duration: 12.4s
- Speed: ~24 ads/minute
- Cache hits: 0 (all fresh requests)

### Verdict: **PASS** — Full discovery + extraction + export pipeline works.

---

## Site 2: expatriates.com — POST Search Mode

**Command**: `--url https://www.expatriates.com --search "driver,cook" --post --max-ads 5 --max-pages 2 --delay 500 --output ./output/validate-post`

### Discovery Metrics
- Keywords searched: 2 ("driver", "cook")
- Strategy: `puppeteer-noform` (keyword 1), `puppeteer-fail` (keyword 2)
- Ad links discovered: **0**

### Extraction Metrics
- Ads targeted: 0
- Ads extracted: 0
- Extraction success rate: N/A

### Failures
1. **fetch POST returned null** — `postViaFetch()` failed silently (line 96-108 of post-search.mjs). Returned `null`, triggering Puppeteer fallback.
2. **Puppeteer blocked by Cloudflare** — `smartLoad()` of `/classifieds/search/` returned Cloudflare challenge (title: "Just a moment...", 265 bytes). Puppeteer fallback then fails with `puppeteer-noform` or `puppeteer-fail`.
3. **POST assumption is wrong** — `--probe` mode reveals expatriates.com search uses **GET not POST**:
   ```json
   {
     "method": "GET",
     "endpoint": "https://www.expatriates.com/scripts/search/search.epl",
     "paramName": "q",
     "formId": "home_search_form"
   }
   ```

### Runtime
- Duration: 1m 19s (wasted on failing POST requests + Puppeteer fallbacks)
- Errors: 0 (silent failures)

### Verdict: **FAIL** — POST search mode is non-functional for expatriates.com. The site uses GET. POST mode was built on an incorrect assumption. Even if POST were correct, Cloudflare blocks the Puppeteer fallback.

---

## Site 3: expatriates.com — Categories Walk Mode

**Command**: `--url https://www.expatriates.com --categories --max-ads 5 --max-pages 2 --delay 500 --output ./output/validate-cat`

### Discovery Metrics
- Categories in tree: 319 (cached from previous session)
- Categories processed: 8+ (timed out after 5m)
- Categories with real data: 4 (Subscribe, My Ads, Place an Ad, browse classifieds)
- Ad links from classifieds page: **185** (matched from 205 total links)
- Categories blocked by Cloudflare: 4 (Bahrain, Riyadh, Jeddah, Dammam — and all subsequent)

### Extraction Metrics
- Ads targeted: 5 (limited by `--max-ads`)
- Cannot verify extraction due to timeout

### Classification Metrics (per-page decisions)
- `Subscribe` page → EXTRACT_CONTENT (p100) — false positive (subscription form, not an ad)
- `My Ads` page → EXTRACT_CONTENT (p100) — false positive (sign-in page after redirect)
- `Place an Ad` page → EXTRACT_CONTENT (p100) — false positive (posting form, not an ad)
- `browse classifieds` → EXTRACT_CONTENT (p100) — correct (classified listing page)
- `Bahrain`, `Riyadh`, `Jeddah`, `Dammam` → LOW_PRIORITY_CRAWL (p5) — correct (Cloudflare-blocked, no data)

### Intelligence Layer Activity
- `[PATTERN_LEARNED]` — new patterns generated per URL
- `[PATTERN_MATCH]` — pattern reuse at 0.51–0.88 confidence
- `[ADAPTIVE_HYPOTHESIS_CREATED]` — POSSIBLE_LISTING_PAGE hypothesis at 0.53–0.848 confidence
- `[OPPORTUNITY_DISCOVERED]` — scores from 0.136 (LOW) to 0.548 (MEDIUM)
- Adaptive memory remained all zeros (no successful extraction to call `recordOutcome()`)

### Blocking Issue
**Cloudflare challenges every category subpage** after the first few requests. The `puppeteer-extra-plugin-stealth` does not bypass expatriates.com's Cloudflare protection for subpages. The homepage and first few pages load OK, then Cloudflare activates on subsequent requests.

### Verdict: **PARTIAL** — Category tree building works. First 4 pages process correctly (185 real ad links from classifieds/). Intelligence layer executes for every page. But Cloudflare blocks all further category pages, preventing meaningful crawl.

---

## Site 4: expatriates.com — Smart Search Mode

**Command**: `--url https://www.expatriates.com --search "driver" --smart-search --max-ads 3 --max-pages 2 --delay 500 --output ./output/validate-smart`

### Discovery Metrics
- Step 1 (form discovery): **SUCCESS** — found form: `action="https://www.expatriates.com/scripts/search/search.epl" input="q"`
- Step 2 (URL pattern probing): **BLOCKED** — Cloudflare on every subsequent request

### Failures
1. First request to home page succeeds (form discovered)
2. All subsequent requests (probing URL patterns) hit Cloudflare
3. `smartLoad()` returns `"cloudflare"` classification for all probe URLs

### Verdict: **PARTIAL** — Smart-search form discovery works correctly. The probing phase is blocked by Cloudflare rate limiting. Smart-search would work on sites without aggressive bot protection.

---

## Site 5: expatriates.com — Probe Mode

**Command**: `--url https://www.expatriates.com --probe https://www.expatriates.com`

### Result
```json
{
  "method": "GET",
  "endpoint": "https://www.expatriates.com/scripts/search/search.epl",
  "paramName": "q",
  "formId": "home_search_form"
}
```

### Verdict: **PASS** — Probe mode correctly identifies the search mechanism.

---

## Site 6: OLX Pakistan — GET Search Mode

**Command**: `--url https://www.olx.com.pk --search "car" --max-ads 3 --max-pages 1 --delay 500 --output ./output/validate-olx`

### Discovery Metrics
- Keywords searched: 1 ("car")
- Search URL constructed: `https://www.olx.com.pk/scripts/search/search.epl?q=car` (hardcoded expatriates pattern)
- Redirected to: `https://www.olx.com.pk/notfound`
- Links discovered: 182 (from the 404 page — false positives)
- Candidate ad links: 3 (filtered by `selectCandidateLinks()`)
- Classification of links: VEHICLE_AD_PAGE, REAL_ESTATE_AD_PAGE (confidence 0.990)

### Extraction Metrics
- Ads targeted: 3
- Ads extracted: 0
- Extraction success rate: **0%**
- Retries: 3 per URL (total 9 attempts)
- Errors: 3 (all "scrape returned null")

### Failures
1. **Search URL is site-specific** — `keyword-search.mjs` constructs URL as `{baseUrl}/scripts/search/search.epl?q={keyword}` which only works on expatriates.com. OLX returned a 404 redirect.
2. **Ad link selection is generic but noisy** — 182 links found from a 404 page (most are navigation links, not ads)
3. **`extractAd()` is site-specific** — OLX ad page structure differs from expatriates.com. The `extractAd()` function in `crawler-core.mjs` doesn't understand OLX's HTML, returns `null` for all URLs.
4. **Cloudflare triggers after repeated scraping** — OLX also uses Cloudflare, returning "Access denied" after 3 retries per URL.

### Classification Metrics
- OLX category pages classified as VEHICLE_AD_PAGE (0.990) — plausible but incorrect (these are category listing pages, not individual ad pages)
- `extractAd()` returned null because OLX ad page structure is incompatible

### Runtime
- Duration: 43.2s (mostly retries)
- Errors: 3

### Verdict: **FAIL** — Discovery is noisy (wrong search URL), extraction is completely broken for non-expatriates.com sites. The `extractAd()` function and search endpoint are hardcoded for expatriates.com.

---

## Summary Metrics

| Metric | expatriates.com GET | expatriates.com POST | expatriates.com Categories | expatriates.com Smart | OLX.com.pk |
|--------|--------------------|----------------------|---------------------------|----------------------|------------|
| Discovery | ✅ 50 links | ❌ 0 links | ✅ 185 links (1 page) | ✅ form found | ⚠️ 182 noisy links |
| Extraction | ✅ 5/5 (100%) | N/A | N/A (timeout) | N/A (blocked) | ❌ 0/3 (0%) |
| Classification | ✅ 0.625 confidence | N/A | ✅ decisions per page | ✅ form ID correct | ⚠️ 0.990 but wrong |
| Export | ✅ Excel (22KB) | ❌ none | ❌ none (timeout) | ❌ none (blocked) | ❌ none |
| Errors | 0 | 0 (silent) | Cloudflare after 4 pages | Cloudflare | 3 extraction errors |
| Intelligence | ✅ all modules | ❌ N/A | ✅ pattern/opportunity | ✅ form discovery | N/A |

---

## Blocking Issues

### P1 — Cloudflare bypass insufficient
- **Impact**: Affects ALL modes on expatriates.com after 1-4 requests. Affects OLX after retries.
- **Evidence**: Every subpage returns `title="Just a moment..."` with 265 bytes. `smartLoad()` classifies as `cloudflare`. `puppeteer-extra-plugin-stealth` does not bypass.
- **Affected modes**: `--categories` (blocked after page 4), `--post` (blocked immediately), `--smart-search` (blocked after step 1), any repeated extraction.

### P2 — POST search mode is non-functional
- **Impact**: `--post` flag produces 0 ads and wastes 79s on failing fallbacks.
- **Root cause**: expatriates.com search uses **GET**, not POST. The `postViaFetch()` function returns `null` because the POST request is rejected. Puppeteer fallback then hits Cloudflare.
- **Evidence**: `--probe` confirms method=GET. Previous audit assumed POST based on HTML inspection of form method.

### P3 — `extractAd()` is site-specific to expatriates.com
- **Impact**: 0% extraction on OLX.com.pk. Cannot support generic classified sites.
- **Root cause**: `extractAd()` in `crawler-core.mjs` uses selectors and patterns designed for expatriates.com's ad page HTML structure. OLX's HTML is structurally different.

### P4 — Search URL hardcoded for expatriates.com
- **Impact**: `keyword-search.mjs` constructs `{baseUrl}/scripts/search/search.epl?q={keyword}`. OLX.com.pk returns 404 because its search path is different.
- **Root cause**: The search URL pattern is not configurable or auto-detected per site. `probeSearchMechanism()` exists in `post-search.mjs` but is never called to auto-detect the search endpoint.

### P5 — `--schedule` and `--status` flags crash
- **Impact**: `scheduler.listJobs()` and `scheduler.addJob()` are method name errors (documented separately). These flags produce TypeError crashes.

---

## Recommendations

1. **Fix `--schedule` and `--status` crashes** (P5) — method name mismatches, trivial fix.
2. **Remove or fix `--post` mode** (P2) — either delete the POST flag (since site uses GET) or make it auto-detect the method via `probeSearchMechanism()`.
3. **Investigate Cloudflare bypass** (P1) — consider rotating user agents, longer delays, or a different stealth approach.
4. **Generalize `extractAd()`** (P3) — make it configurable per site or use adaptive extraction.
5. **Auto-detect search endpoint** (P4) — call `probeSearchMechanism()` at the start of `runSearch()` to determine the correct search URL per site.
