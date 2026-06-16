# P0 — Post-Unification Verification Report

## Before vs After

| Metric | Before (contaminated) | After (cleaned) | Delta |
|---|---|---|---|
| **Phone coverage** | 100% (25/25) — incl 5 ad IDs | **80%** (20/25) — real UK phones only | −20% |
| **Price coverage** | 40% (10/25) — incl `,` garbage | **24%** (6/25) — clean numeric only | −16% |
| **Email coverage** | 0% | 0% | — |
| **Location coverage** | 100% | 100% | — |
| **Title coverage** | 100% | 100% | — |
| **Currency coverage** | 28% (7/25) | 28% (7/25) | — |
| **Field accuracy (avg)** | 61% | **55%** | −6% |
| **Duplicate rate** | 60% | **60%** (unchanged — ad IDs were unique) | — |
| **Block rate** | 0% | 0% | — |
| **Trust score** | 64 | **62** | −2 |
| **High-value records** | 10 (phone+price+location) | **5** | −5 |
| **False positive phones removed** | 0 | **5** (5418479659, 5418484761, 5418451751, 5418480683, 5418447119) | +5 |

## Unification Deliverables

| Requirement | Status |
|---|---|
| **One extractor** | `core/canonical-extractor.mjs` — all new crawls use this |
| **One schema** | `{ id, site, url, title, price, currency, phone, email, location, category, extractedAt }` |
| **Phone validation** | `cleanPhone()` rejects ad IDs, validates UK mobile format `07XXXXXXXXX`, checks against URL path segment |
| **Price validation** | `cleanPrice()` rejects `,` and empty strings, extracts numeric values |
| **One export pipeline** | `exportAll()` produces JSON + CSV + XLSX from the same data |
| **One validation path** | `validation-engine.mjs` uses `cleanPhone`/`cleanPrice` for accurate field coverage |
| **Trust score</parameter>**
| **Engine exports** | `/api/crawl/:id/export?format=json\|csv\|xlsx` from engine |
| **Web server pipeline** | Deprecated — uses same extractor when called |
| **CLI pipeline** | Deprecated — never produced records |

## Gumtree Verification

| Criterion | Result |
|---|---|
| Records extracted | 25 |
| Phone coverage (valid) | 80% (20/25) |
| Price coverage (clean) | 24% (6/25) |
| Email coverage | 0% (0/25) |
| Location coverage | 100% (25/25) |
| Category coverage | 0% (no category selectors configured) |
| Duplicate rate | 60% (15 same-poster vol ads, 2 same-poster part-time) |
| Block rate | 0% |
| Export verification | JSON ✓, CSV ✓, XLSX ✓ |
| Evidence URLs | All 25 records have Gumtree source URLs |
| Insights regenerated | 6 insights, evidence-backed |

## Remaining Issues

1. **Web server** (`web/server.mjs`) and **CLI** (`csi-crawler-v9.mjs`) still exist as code paths. They import the same `crawler-core.mjs` but should be migrated to `canonical-extractor.mjs`.
2. **5 site configs** have never been tested (bayt, craigslist, olx.pk, preloved, opensooq).
3. **expatriates.com** is 100% Cloudflare blocked.
4. **Gumtree category coverage is 0%** — no category breadcrumb selectors configured in `config/sites/gumtree.com.json`.
5. **Simulated endpoints** (`/api/health` hardcoded scores, `/api/schedules`, `/api/settings`) still exist.

## Conclusion

P0 extraction unification is functionally complete. The canonical extractor produces validated phone/price data. The engine serves validation/evidence/exports from clean data. Remaining work is site coverage (P1), not extraction unification.
