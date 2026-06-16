# Support Tiers — CSI-Ultimate v1.0-RC

---

## Tier Classification

| Tier | Label | Criteria |
|------|-------|----------|
| **A** | Fully Verified Production Sites | Full pipeline verified: search → discovery → extraction → classification → export. Extraction rate ≥ 90%. |
| **B** | Production Sites With Known Limitations | Full pipeline functional. Extraction rate below 90% due to documented site-specific issues. |
| **C** | Experimental / Requires Anti-Bot Work | Search and discovery functional. Extraction blocked or severely degraded by anti-bot protection. |
| **D** | Requires Config Refresh | Site structure changed. Current config does not match live site. Requires re-provisioning. |

---

## Tier A: Fully Verified Production Sites

### gumtree.com

| Property | Value |
|----------|-------|
| **Current Status** | ✅ Production Ready |
| **Last Validation Result** | PASS — 10/10 ads extracted (100%), 42.6s crawl |
| **Extraction Rate** | 100% |
| **Pipeline Stages** | Search: ✅ Discovery: ✅ Extraction: ✅ Classification: ✅ Export: ✅ |
| **Known Issues** | None |
| **Recommended Action** | Monitor monthly for `data-q` selector changes. Low maintenance. |

### preloved.co.uk

| Property | Value |
|----------|-------|
| **Current Status** | ✅ Production Ready |
| **Last Validation Result** | PASS — Full pipeline verified |
| **Extraction Rate** | 100% |
| **Pipeline Stages** | Search: ✅ Discovery: ✅ Extraction: ✅ Classification: ✅ Export: ✅ |
| **Known Issues** | None |
| **Recommended Action** | Routine monitoring. Low maintenance. |

### olx.com.pk

| Property | Value |
|----------|-------|
| **Current Status** | ✅ Production Ready |
| **Last Validation Result** | PASS — Full pipeline verified. Previously blocked (403), now fully functional. |
| **Extraction Rate** | 100% |
| **Pipeline Stages** | Search: ✅ Discovery: ✅ Extraction: ✅ Classification: ✅ Export: ✅ |
| **Known Issues** | URL template `{baseUrl}/items/q-{keyword}` may change quarterly |
| **Recommended Action** | Quarterly config review. Monitor URL template against live site. |

---

## Tier B: Production Sites With Known Limitations

### expatriates.com

| Property | Value |
|----------|-------|
| **Current Status** | ⚠️ Production Ready with Limitations |
| **Last Validation Result** | PASS — 5/5 ads extracted in validation run. However, intermittent Cloudflare on ~40% of detail pages. |
| **Extraction Rate** | ~60% (intermittent Cloudflare blocks detail page extraction) |
| **Pipeline Stages** | Search: ✅ Discovery: ✅ Extraction: ⚠️ Classification: ✅ Export: ✅ |
| **Known Issues** | 1. Cloudflare Turnstile triggers intermittently on detail pages<br>2. Extraction rate varies by session (40–100%) |
| **Recommended Action** | 1. Integrate Cloudflare solver for higher extraction rate<br>2. Accept as-is for use cases where partial data is sufficient<br>3. Consider running during low-traffic hours |

### london.craigslist.org

| Property | Value |
|----------|-------|
| **Current Status** | ⚠️ Production Ready with Limitations |
| **Last Validation Result** | PASS — Pipeline verified. Extraction rate limited by link classifier. |
| **Extraction Rate** | ~20% (subcategory refine links mixed with ad URLs in search results) |
| **Pipeline Stages** | Search: ✅ Discovery: ⚠️ Extraction: ✅ Classification: ✅ Export: ✅ |
| **Known Issues** | 1. Search result pages include subcategory refinement links alongside ad URLs<br>2. Link classifier does not distinguish between ad links and category links on Craigslist<br>3. Pagination selector not configured |
| **Recommended Action** | 1. Refine `classifyDiscoveryLink` to filter category links on Craigslist<br>2. Add pagination selector to site config<br>3. Accept as-is for broad discovery (all ads captured, but many non-ad links also processed) |

---

## Tier C: Experimental / Requires Anti-Bot Work

### bayt.com

| Property | Value |
|----------|-------|
| **Current Status** | ❌ Extraction Blocked |
| **Last Validation Result** | PARTIAL — Search returns 279 links. Extraction fails on detail pages. |
| **Extraction Rate** | 0% (detail pages blocked by Cloudflare) |
| **Pipeline Stages** | Search: ✅ Discovery: ⚠️ Extraction: ❌ Classification: ⚠️ Export: ❌ |
| **Known Issues** | 1. Cloudflare consistently blocks detail page access<br>2. Configured as jobs portal — listing page structure differs from classifieds<br>3. No email/phone extraction possible without detail page access |
| **Recommended Action** | 1. Requires Cloudflare solver integration (out of scope for v1.0-RC)<br>2. Consider alternative jobs site with less aggressive anti-bot<br>3. Re-evaluate after anti-bot improvements |

---

## Tier D: Requires Config Refresh

### sa.opensooq.com

| Property | Value |
|----------|-------|
| **Current Status** | 🔧 Requires Config Update |
| **Last Validation Result** | FAIL — Site structure changed since initial validation |
| **Extraction Rate** | Unknown (current config does not match live site) |
| **Pipeline Stages** | Search: ⚠️ Discovery: ⚠️ Extraction: ⚠️ Classification: ⚠️ Export: ⚠️ |
| **Known Issues** | 1. Site has undergone structural changes<br>2. Current extraction selectors likely do not match<br>3. Arabic-language (RTL) layout may require different selector strategies<br>4. Search endpoint may have changed |
| **Recommended Action** | 1. Run `--probe` to determine current search mechanism<br>2. Manually inspect current site HTML for selector updates<br>3. Update `sa.opensooq.com.json` config file<br>4. Re-validate full pipeline after config refresh |

---

## Summary

| Tier | Sites | Count |
|------|-------|-------|
| **A** — Fully Verified | gumtree.com, preloved.co.uk, olx.com.pk | 3 |
| **B** — Known Limitations | expatriates.com, london.craigslist.org | 2 |
| **C** — Anti-Bot Needed | bayt.com | 1 |
| **D** — Config Refresh Needed | sa.opensooq.com | 1 |
| **Total** | | **7** |

## Recommendation

- **Tier A sites**: Ready for production use with standard monitoring
- **Tier B sites**: Usable in production; document limitations with stakeholders
- **Tier C sites**: Blocked until anti-bot improvements; consider alternative sites
- **Tier D site**: Requires maintenance; do not use until config is refreshed
