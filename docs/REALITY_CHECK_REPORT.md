# REALITY CHECK REPORT

Date: 2026-06-13

## 1. Which sites truly work?

**Three sites produce real, extractable data with >90% title coverage:**

- **gumtree.com**: 25 records, phone 80%, price 24%, trust score 62, 0% blocked. The only site with public phone numbers. CERTIFIED-adjacent.
- **london.craigslist.org**: 75 records (3 runs × 25 ads), price 100%, title 100%, trust score ~79, 0% blocked. Requires 15s crawl delays to avoid rate limiting. No phone/email (craigslist uses internal relay).
- **preloved.co.uk**: 60 records (3 runs × 20 ads), price 95%, location 100%, title 100%, trust score ~81, 0% blocked. No phone/email (hidden behind click-to-reveal).

## 2. Which sites partially work?

- **sa.opensooq.com**: 18 records (3 runs × 6 ads), title 100%, email 17%, trust score ~49. Jobs category has very few listings (5-6 per page) and no salary/price data. Could potentially improve by targeting general classifieds categories instead of jobs.

## 3. Which sites are blocked?

- **bayt.com**: HTTP 403, Cloudflare challenge on every attempt. Even with Playwright stealth plugin, the anti-bot check blocks page content.
- **olx.com.pk**: HTTP 403, Cloudflare error 1005 "Access denied". All OLX sites globally use Cloudflare.
- **expatriates.com**: Previously confirmed 100% blocked across 42+ CLI runs.

## 4. Which sites should be removed from the product?

| Site | Remove? | Reason |
|------|---------|--------|
| bayt.com | ✅ YES | 100% Cloudflare blocked. No bypass possible without enterprise anti-bot tools. |
| olx.com.pk | ✅ YES | 100% Cloudflare blocked. Same as bayt. |
| expatriates.com | ✅ YES | 100% blocked across 42+ attempts. |
| sa.opensooq.com | ⚠️ MAYBE | Only 18 records from 3 runs, 0% price/phone/location. Only useful if Arabic selectors are fixed and better categories are targeted. |
| london.craigslist.org | ❌ NO | 75 records, 100% price, trust ~79. Valuable for market pricing data despite 0% phone. |
| preloved.co.uk | ❌ NO | 60 records, 95% price, 100% location, trust ~81. Cleanest data of all non-Gumtree sources. |
| gumtree.com | ❌ NO | 25 records, 80% phone. The only source with phone coverage. Keep as primary. |

## 5. Is the product actually useful today?

**Yes, but with significant caveats.**

- **Gumtree extraction is production-quality** (80% phone, 62 trust score) but limited to ~25 records per crawl.
- **Craigslist and Preloved provide high-value price and location data** (95-100% coverage) but zero phone/email coverage makes them unsuitable for contact-based use cases.
- **The unification work (P0) succeeded** — single extractor, single validation pipeline, consistent export format across all sources.
- **3 of 7 configured sources are completely unusable** due to Cloudflare blocking.

### What the product CAN do today
- Extract classifieds from 3 working sources (Gumtree, Craigslist, Preloved)
- Produce clean JSON/CSV/XLSX exports
- Calculate trust scores, field accuracy, duplicate metrics
- Detect blocked sources and report block rates

### What the product CANNOT do today
- Phone-based extraction from any source other than Gumtree
- Bypass Cloudflare on blocked sites
- Scale individual sources past 25-75 records per crawl session
- Provide certifiable data (>100 records, >60 trust) from any single source

### Bottom line
The architecture works. The extractor is unified. The validation pipeline is sound. But phone-dependent certification across multiple sources is fundamentally limited by site design — most classifieds platforms hide phone numbers. For price/location research, the product delivers. For contact-based classifieds aggregation, Gumtree is the only viable source.