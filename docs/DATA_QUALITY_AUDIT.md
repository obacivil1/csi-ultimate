# Data Quality Audit — CSI-Ultimate v1.0-RC

**Date:** 2026-06-12
**Audit Type:** Tier A Production Site Data Quality Validation

---

## Acceptance Thresholds

| Metric | Threshold | Result |
|--------|-----------|--------|
| Missing Titles | < 5% | ✅ PASS |
| Missing Prices | < 10% | ❌ FAIL |
| Missing Descriptions | < 10% | ❌ FAIL |
| Duplicate Records | 0% | ✅ PASS |
| Export Integrity | 100% | ✅ PASS |
| Extraction Success | >= 90% | ❌ FAIL |

---

## Site 1: gumtree.com

### Crawl Configuration

| Parameter | Value |
|-----------|-------|
| URL | https://www.gumtree.com |
| Keyword | bicycle |
| Target Records | 25 |
| Formats | Excel, CSV, JSON |
| Runtime | 3m 3s |

### Data Quality Metrics

| Metric | Count | % | Threshold | Result |
|--------|-------|---|-----------|--------|
| Records Extracted | 25 | — | — | ✅ |
| Missing Titles | 0 | 0.0% | < 5% | ✅ PASS |
| Missing Prices | 0 | 0.0% | < 10% | ✅ PASS |
| Missing Descriptions | 0 | 0.0% | < 10% | ✅ PASS |
| Missing URLs | 0 | 0.0% | < 5% | ✅ PASS |
| Duplicate Records | 0 | 0.0% | 0% | ✅ PASS |
| Export Integrity | 3/3 | 100% | 100% | ✅ PASS |
| Extraction Success | 25/25 | 100% | >= 90% | ✅ PASS |

### Export Files

| Format | Size | Valid |
|--------|------|-------|
| Excel | 45,142 bytes | ✅ |
| CSV | 17,435 bytes | ✅ |
| JSON | 68,416 bytes | ✅ |

### Verdict
PASS — All thresholds met. Gumtree `data-q` selectors provide reliable extraction.

---

## Site 2: preloved.co.uk

### Crawl Configuration

| Parameter | Value |
|-----------|-------|
| URL | https://www.preloved.co.uk |
| Keyword | sofa |
| Target Records | 20 |
| Formats | Excel, CSV, JSON |
| Runtime | 1m 36s |

### Data Quality Metrics

| Metric | Count | % | Threshold | Result |
|--------|-------|---|-----------|--------|
| Records Extracted | 20 | — | — | ✅ |
| Missing Titles | 0 | 0.0% | < 5% | ✅ PASS |
| Missing Prices | 20 | 100.0% | < 10% | ❌ FAIL |
| Missing/Corrupt Descriptions | 15 | 75.0% | < 10% | ❌ FAIL |
| Missing URLs | 0 | 0.0% | < 5% | ✅ PASS |
| Duplicate Records | 0 | 0.0% | 0% | ✅ PASS |
| Export Integrity | 3/3 | 100% | 100% | ✅ PASS |
| Extraction Success | 20/25 | 80.0% | >= 90% | ❌ FAIL |

### Root Cause Analysis

| Issue | Root Cause |
|-------|------------|
| **100% missing prices** | Price selectors in `preloved.co.uk.json` (`.price, [class*='price']`) do not match preloved's current HTML structure. No price data is extracted from any page. |
| **75% corrupt descriptions** | Preloved displays a cookie consent overlay with privacy policy text that the extraction selector (`#description, [class*='description']`) captures instead of the actual ad description. Only 5/20 records have real descriptions (those not blocked by the overlay). |
| **80% extraction success** | 5 of 25 discovered links were category listing pages (`/classifieds/`), not ad detail pages. Link classifier does not distinguish these from ad URLs. |

### Recommendations

1. Update preloved price selector to match current site HTML
2. Add cookie-consent detection/dismissal before description extraction
3. Refine `classifyDiscoveryLink` to reject category listing URLs

### Verdict
FAIL — 3 thresholds breached. Selectors need updating for live site structure.

---

## Site 3: olx.com.pk

### Crawl Configuration

| Parameter | Value |
|-----------|-------|
| URL | https://www.olx.com.pk |
| Keyword | car |
| Target Records | 25 |
| Formats | Excel, CSV, JSON |
| Runtime | 41s |

### Data Quality Metrics

| Metric | Count | % | Threshold | Result |
|--------|-------|---|-----------|--------|
| Records Extracted | 25 | — | — | ✅ |
| Missing Titles | 0 | 0.0% | < 5% | ✅ PASS |
| Missing Prices | 25 | 100.0% | < 10% | ❌ FAIL |
| Missing/Corrupt Descriptions | 15 | 60.0% | < 10% | ❌ FAIL |
| Missing URLs | 0 | 0.0% | < 5% | ✅ PASS |
| Duplicate Records | 0 | 0.0% | 0% | ✅ PASS |
| Export Integrity | 3/3 | 100% | 100% | ✅ PASS |
| Extraction Success | 25/25 | 100% | >= 90% | ✅ PASS |

### Root Cause Analysis

| Issue | Root Cause |
|-------|------------|
| **100% missing prices** | Price selectors in `olx.com.pk.json` (`[class*='price']`) do not match OLX's current HTML structure. No price data extracted from any page. |
| **60% corrupt descriptions** | OLX rate-limits requests aggressively. 15 out of 25 detail pages returned "Error 1015 — You are being rate limited" (Cloudflare). The extraction captures this error page text as the description. |
| **No phone/email extraction** | OLX does not expose phone or email in page HTML for the extracted ad types (car rental services, accessories listings). |

### Recommendations

1. Investigate and update OLX price selectors
2. Implement rate-limit avoidance or backoff strategy for OLX specifically
3. Accept partial description extraction as a site-imposed limitation

### Verdict
FAIL — 2 thresholds breached. Cloudflare rate limiting impacts description quality; price selectors need update.

---

## Cross-Site Export Integrity

| Site | Excel | CSV | JSON | Row Count Match |
|------|-------|-----|------|-----------------|
| gumtree.com | ✅ 45KB | ✅ 17KB | ✅ 68KB | 25 across all formats ✅ |
| preloved.co.uk | ✅ 49KB | ✅ 25KB | ✅ 49KB | 20 across all formats ✅ |
| olx.com.pk | ✅ 45KB | ✅ 18KB | ✅ 49KB | 25 across all formats ✅ |

**Export Integrity Verdict:** 100% — All files non-empty, readable, row counts match across formats.

---

## Site Classification Re-Evaluation

Based on data quality results, the Tier A classification needs revision:

| Site | Current Tier | Data Quality | Proposed Tier |
|------|-------------|--------------|---------------|
| gumtree.com | A | ✅ All thresholds met | **A — Confirmed** |
| preloved.co.uk | A | ❌ Prices 100% missing, Descriptions 75% corrupt | **B — Known Limitations** |
| olx.com.pk | A | ❌ Prices 100% missing, Descriptions 60% corrupt | **B — Known Limitations** |

**Only gumtree.com qualifies as Tier A for data quality.**

---

## Acceptance Threshold Summary

| Threshold | gumtree.com | preloved.co.uk | olx.com.pk |
|-----------|-------------|----------------|------------|
| Missing Titles < 5% | ✅ 0% | ✅ 0% | ✅ 0% |
| Missing Prices < 10% | ✅ 0% | ❌ 100% | ❌ 100% |
| Missing Descriptions < 10% | ✅ 0% | ❌ 75% | ❌ 60% |
| Duplicates = 0% | ✅ 0% | ✅ 0% | ✅ 0% |
| Export Integrity = 100% | ✅ 100% | ✅ 100% | ✅ 100% |
| Extraction Success >= 90% | ✅ 100% | ❌ 80% | ✅ 100% |

**Sites passing all thresholds:** 1/3 (gumtree.com)
**Sites failing thresholds:** 2/3 (preloved.co.uk, olx.com.pk)

---

## Findings

1. **Gumtree.com passes all data quality thresholds** — 100% extraction rate, 0% missing fields, all exports valid.
2. **Preloved price extraction broken** — Selectors do not match current site HTML. 100% of records missing prices.
3. **Preloved description extraction corrupted** — Cookie consent overlay text captured instead of ad descriptions in 75% of records.
4. **OLX price extraction broken** — Selectors do not match current site HTML. 100% of records missing prices.
5. **OLX rate-limited by Cloudflare** — 60% of detail pages return "Error 1015" rate-limit page. Descriptions contain error text.
6. **Export integrity verified** — All 9 export files (3 sites × 3 formats) are non-empty, valid, and row counts match.
7. **Tier A classification needs revision** — Only gumtree.com qualifies as Tier A based on actual data quality. Preloved and OLX should be Tier B.
