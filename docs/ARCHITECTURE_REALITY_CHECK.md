# ARCHITECTURE_REALITY_CHECK.md

**Date**: 2026-06-11
**Crawler Version**: v9.0.0

---

## Executive Summary

**Verdict: Expatriates-Specific Crawler**

CSI-Ultimate is a single-site crawler built exclusively for `expatriates.com`. The branding, documentation, and module names imply multi-site support, but every critical path is hardcoded to expatriates.com. Non-expatriates sites fail at every stage: search, extraction, classification routing, and export.

---

## Repository Evidence

### 1. Search Layer — HARDCODED

| File | Line | Evidence |
|------|------|----------|
| `core/keyword-search.mjs` | 36-40 | `buildSearchUrl()` constructs `${baseUrl}/scripts/search/search.epl?q=keyword` — hardcoded expatriates search endpoint |
| `core/post-search.mjs` | 40-41 | `SEARCH_ENDPOINT = "https://www.expatriates.com/scripts/search/search.epl"` and `SEARCH_PAGE_URL = "https://www.expatriates.com/classifieds/search/"` |
| `core/post-search.mjs` | 91 | `Origin: https://www.expatriates.com` hardcoded in request headers |
| `core/cli.mjs` | 75 | `--post` flag description: "خاص بـ expatriates.com" (specific to expatriates.com) |

**No mechanism exists to configure search URLs per site.** Search URL construction assumes all sites have `/scripts/search/search.epl` — a path unique to expatriates.com.

### 2. Category Layer — GENERIC (working correctly)

| File | Line | Evidence |
|------|------|----------|
| `core/category-walker.mjs` | 56-101 | `buildCategoryTree()` scans homepage for `<a>` tags, classifies links by regex keyword matching — **generic approach** |
| `core/category-walker.mjs` | 88 | Category keyword regex uses generic terms: `category`, `jobs`, `cars`, `property`, etc. |
| `core/category-walker.mjs` | 161-203 | `CategorySession` persistence is domain-agnostic |

**Verdict: GENERIC** — category discovery would work on any site with a sidebar/nav category structure.

### 3. Discovery Layer — GENERIC with minor bias

| File | Line | Evidence |
|------|------|----------|
| `core/crawler-core.mjs` | 521-527 | `discoverLinksFromHtml()` — generic HTML `<a>` tag extraction |
| `core/crawler-core.mjs` | 549-568 | `selectCandidateLinks()` — generic scoring by link type |
| `core/crawler-core.mjs` | 562 | `cls` in scoring regex — minor expatriates.com bias |

**Verdict: GENERIC** — link discovery is usable across sites.

### 4. Extraction Layer — SITE-SPECIFIC

| File | Line | Evidence |
|------|------|----------|
| `core/crawler-core.mjs` | 664 | `adId` extraction: `/\/cls\/(\d+)/` — **expatriates.com `/cls/` path pattern** |
| `core/crawler-core.mjs` | 676 | `title.replace(/expatriates\.com/gi, "")` — **explicitly strips "expatriates.com" from titles** |
| `core/crawler-core.mjs` | 718-727 | Phone regexes target GCC countries: `+966` (KSA), `+971` (UAE), `+973` (Bahrain), `+974` (Qatar), `+965` (Kuwait), `+968` (Oman) |
| `core/crawler-core.mjs` | 759 | Price regex targets GCC currencies: SAR, AED, KWD, QAR |

**No mechanism exists to configure ad ID patterns, phone regexes, or currency lists per site.** The extraction fails on any site that doesn't use `/cls/` in its ad page URLs.

### 5. Routing / Configuration Layer — NON-EXISTENT

| Aspect | Status |
|--------|--------|
| Site adapter interface | **Does not exist** — no abstract site class or configuration schema |
| Per-site config files | **Does not exist** — no `sites/` directory, no site JSON configs |
| Site routing | **Does not exist** — no site detection, no dispatch to site-specific logic |
| Adding a new site | **Requires code changes** in `keyword-search.mjs`, `post-search.mjs`, `crawler-core.mjs` (at minimum) |

### 6. CLI & Documentation — EXCLUSIVELY expatriates.com

| File | Evidence |
|------|----------|
| `core/cli.mjs` | All 7 examples use `--url https://www.expatriates.com` |
| `core/cli.mjs` | `--test-live` desc: "اختبار على expatriates.com الحقيقي" |
| `core/integration-tester.mjs` | 20+ hardcoded references to `www.expatriates.com`, `/cls/`, `/scripts/search/search.epl` |
| `core/dashboard.mjs` | ASCII mockup shows `expatriates.com` in the header |

### 7. Config Manager — NO SITE-SPECIFIC CONFIG

| File | Evidence |
|------|----------|
| `core/config-manager.mjs` | Profiles store only runtime params: concurrency, maxAds, delay, formats, outputDir |
| `core/config-manager.mjs` | **No site-specific** configuration (search URL, ad pattern, selectors) |

---

## Runtime Evidence

### Compatibility Matrix

| Site | Discovery | Extraction | Classification | Export | Overall |
|------|-----------|------------|---------------|--------|---------|
| **expatriates.com** (GET search) | ✅ 50 links | ✅ 5/5 (100%) | ✅ 0.625 conf | ✅ Excel | **PASS** |
| **expatriates.com** (POST search) | ❌ 0 links | N/A | N/A | ❌ | **FAIL** |
| **expatriates.com** (categories) | ✅ 185 links | ❌ Cloudflare | ✅ per-page | ❌ | **PARTIAL** |
| **expatriates.com** (smart-search) | ✅ form found | ❌ Cloudflare | N/A | ❌ | **PARTIAL** |
| **Bayt.com** | ✅ 40 links (404 page) | ❌ 0/3 (0%) | ✅ 0.990 | ❌ | **FAIL** |
| **OpenSooq** (Jordan) | ✅ 1210 links (noisy) | ❌ 0/3 (0%) | ✅ 0.375-0.875 | ❌ | **FAIL** |
| **OLX Pakistan** | ✅ 182 links (noisy) | ❌ 0/3 (0%) | ✅ 0.990 | ❌ | **FAIL** |
| **Craigslist.org** | ⚠️ 1 link | ❌ 0/1 (0%) | ⚠️ 0.500 | ❌ | **FAIL** |

### Failure Pattern

Every non-expatriates site fails at the same two points:

1. **Search URL wrong**: All sites redirect to 404 because `/scripts/search/search.epl` doesn't exist on any other platform.
2. **Extraction returns null**: `extractAd()` checks `ad.adId` (line 782) which requires `/cls/\d+` in the URL. No other site uses this pattern.

---

## Root Cause Analysis

| Root Cause | Impact | Affected Sites |
|------------|--------|----------------|
| **Hardcoded search URL** (`/scripts/search/search.epl`) | Search returns 404 on all non-expatriates sites | Bayt, OpenSooq, OLX, Craigslist |
| **Hardcoded ad ID pattern** (`/cls/\d+`) | `extractAd()` returns null — ad has no ID | Bayt, OpenSooq, OLX, Craigslist |
| **Hardcoded title cleanup** (`.replace(/expatriates\.com/gi, "")`) | Harmless on other sites (no-op) | — |
| **Hardcoded phone regexes** (GCC country codes) | Misses non-GCC phone numbers | All non-GCC sites |
| **Hardcoded currencies** (SAR, AED, KWD, QAR) | Misses other currencies | All non-GCC sites |
| **No site configuration system** | Every site requires code changes | All non-expatriates sites |

---

## Architectural Verdict

**Expatriates-Specific Crawler**

CSI-Ultimate is not a multi-site crawler. It was built exclusively for `expatriates.com` with hardcoded assumptions in every critical pipeline stage. The codebase cannot crawl any other classified site without source code modifications.

The generic layers (category discovery, link filtering, classification) suggest the developer intended multi-site support, but these layers were never connected to a site configuration system. The extraction and search layers assume expatriates.com's exact URL structure, DOM layout, and regional conventions.

---

## Migration Plan: Toward Generic Multi-Site Architecture

### Required Changes

#### Phase 1: Site Configuration Layer

Create a configuration-driven system for per-site settings:

**New file:** `core/site-adapter.mjs`

```javascript
// Configuration schema per site
{
  "expatriates.com": {
    "search": {
      "method": "GET",
      "endpoint": "/scripts/search/search.epl",
      "paramName": "q"
    },
    "extraction": {
      "adIdPattern": "/cls/(\\d+)",
      "phoneRegion": "GCC",
      "currencies": ["SAR", "AED", "KWD", "QAR"],
      "titleCleanup": ["expatriates.com"],
      "selectors": {
        "title": ["h1", "h2", ".ad-title"],
        "description": [".posting-body", ".ad-body", ".description"],
        "price": ["[class*='price']", "[class*='salary']"],
        "location": ["[class*='location']", "[class*='city']"],
        "phone": ["a[href^='tel:']"],
        "email": ["a[href^='mailto:']"],
        "whatsapp": ["a[href*='wa.me']", "a[href*='whatsapp.com/send']"],
        "company": ["[class*='company']", "[class*='employer']"],
        "breadcrumb": [".breadcrumb a"],
        "date": ["time", "[class*='date']", "[class*='posted']"]
      }
    },
    "pagination": {
      "nextSelector": "a[rel='next'], .next a, a.next"
    }
  }
}
```

**New directory:** `config/sites/` — one JSON file per supported site.

#### Phase 2: Generic Search Engine

Modify `keyword-search.mjs` to read search endpoint from site config instead of hardcoding:

| Change | File | Current (line) | New behavior |
|--------|------|----------------|--------------|
| Search URL | `keyword-search.mjs:38` | `${baseUrl}/scripts/search/search.epl?q=...` | Read from site config's `search.endpoint` + `search.paramName` |
| Search method | `keyword-search.mjs` | Always GET | Support GET/POST from config |
| POST search | `post-search.mjs:40-41` | Hardcoded expat URLs | Read from site config |

#### Phase 3: Generic Extraction Engine

Modify `crawler-core.mjs:extractAd()` to read extraction config per site:

| Change | Current (line) | New behavior |
|--------|---------------|--------------|
| Ad ID pattern | 664: `/\/cls\/(\d+)/` | Read `extraction.adIdPattern` from config |
| Title cleanup | 676: `.replace(/expatriates\.com/gi, "")` | Read `extraction.titleCleanup[]` from config |
| Phone regexes | 718-727: Hardcoded GCC codes | Read region-specific patterns from config |
| Currencies | 759: SAR, AED, KWD, QAR | Read `extraction.currencies` from config |
| Description selectors | 679-686: Hardcoded list | Read `extraction.selectors.description` from config |

#### Phase 4: Generic Classification

The `SemanticPageClassifier` is already config-driven via `config/semantic-classifier/dictionaries.json`. **Minimal work needed.** It already accepts a configurable `dictionaryPath`.

#### Phase 5: Site Auto-Detection

Add automatic site detection when `--url` is provided:

1. Extract base hostname from URL
2. Look for matching config in `config/sites/`
3. Fall back to generic defaults (or error with instructions)

### Effort Estimate

| Phase | Files Changed | Estimated Effort |
|-------|---------------|------------------|
| Phase 1: Site config layer | 2 new files | 2-3 hours |
| Phase 2: Generic search | 3 files | 1-2 hours |
| Phase 3: Generic extraction | 1 file | 2-3 hours |
| Phase 4: Classification | 0-1 files | < 1 hour |
| Phase 5: Auto-detection | 1-2 files | 1 hour |
| **Total** | **7-9 files** | **6-10 hours** |

### Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking existing expatriates.com functionality | Medium | Regression tests with current expatriates.com output |
| Config file format changes over time | Low | Version field in config schema |
| Site selector changes break extraction | Medium | Log extraction failures per site for monitoring |
| Cloudflare blocks all sites regardless | High | Separate issue — not solvable by architecture changes |

---

## Immediate Next Step

Begin Phase 1: Create `core/site-adapter.mjs` with the site configuration schema and loader. Convert the four hardcoded values (search URL, ad ID pattern, phone regexes, currencies) into configurable parameters with expatriates.com as the default configuration.
