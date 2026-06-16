# P0 — Extraction Pipeline Unification Audit

## Pipeline Inventory

### Pipeline 1: Engine (working, 25 records)

| Attribute | Detail |
|---|---|
| Entry point | `engine/server.mjs:59-86` (`extractAdData`) |
| Files involved | `engine/server.mjs` |
| Extraction flow | Playwright `page.evaluate()` with regex on `document.body.innerText` |
| Dependencies | playwright-extra, puppeteer-extra-plugin-stealth |
| Output schema | `{ title, description, price, currency, email, phone, location, url, timestamp }` |
| Phone method | Loose regex `(?:\+?\d{1,3}...)?\(?\d{3,4}\)?...\d{4}` (matches ad IDs) |
| Phone quality | 76% real UK, 20% ad-ID garbage, 4% unknown |
| Price method | Currency-prefix regex `(?:£|₹|Rs\.?\s*\|price\|salary\|rent)...` |
| Export | None — JSON file only to `state/records/` |
| Consumers | `/api/validation/*`, `/api/insights`, `/api/evidence/*` |
| Record ID | `d2753198-0bca-4330-aea4-3f17bdcb4673` |

### Pipeline 2: Web Server (partial, 15 records across 4 runs)

| Attribute | Detail |
|---|---|
| Entry point | `web/server.mjs:274-368` (`runCrawlJob`) |
| Files involved | `web/server.mjs`, `core/crawler-core.mjs` (933 lines), `core/exporter.mjs` |
| Extraction flow | `extractAd()` in `crawler-core.mjs` — classification engine → semantic analysis → selector-based extraction |
| Dependencies | SemanticPageClassifier, PageDecisionEngine, PatternRegistry, AdaptiveDiscoveryEngine, ExplorationStrategy, HypothesisValidator, AdaptiveLearningLoop, OpportunityScorer, UniversalKnowledgeEngine, CrossSiteReasoner, KnowledgeTransferEngine, plus rate-limiter, queue, cache, dedupe |
| Output schema | `{ adId, title, description, phones, emails, whatsapp, location, price, company, category, postedDate, url }` |
| Phone method | Selector-based `a[href^="tel:"]` + country-code regex, filters `adId` from results |
| Phone quality | 0% (all 15 records have empty phones — selectors fail on Gumtree) |
| Price method | Selector-based `sel.price` + complex currency/regex fallback |
| Export | CSV + XLSX + JSON via `core/exporter.mjs` |
| Consumers | `/api/crawl/:id/records`, `/api/reports`, export download endpoints |
| Example | `output/web/job_1781311782449/` (3 bike records, no phones) |

### Pipeline 3: CLI (dead, 0 records in 42+ runs)

| Attribute | Detail |
|---|---|
| Entry point | `csi-crawler-v9.mjs` |
| Files involved | `csi-crawler-v9.mjs` (491 lines), same crawler-core.mjs dependencies as Pipeline 2 |
| Extraction flow | Same as Pipeline 2 — calls `extractAd()` from crawler-core.mjs |
| Dependencies | Same as Pipeline 2 plus: category-walker, keyword-search, smart-search, scheduler, post-search, reporter |
| Output schema | Same as Pipeline 2 |
| Phone quality | N/A — never extracted anything |
| Price method | N/A |
| Export | Same as Pipeline 2 |
| Consumers | None (all runs against expatriates.com, 100% Cloudflare blocked) |
| Failure cause | Targets expatriates.com (Cloudflare blocked), never tested against Gumtree |

## Dependency Graph

```
                  ┌─────────────────────────────────────────────┐
                  │            ENGINE (port 3030)                │
                  │         engine/server.mjs (435 lines)        │
                  │                                              │
                  │  extractAdData() ─── inline regex-based      │
                  │       ↓                                     │
                  │  state/records/{jobId}.json                  │
                  │       ↓                                     │
                  │  validation-engine.mjs → trust/metrics      │
                  │  insight-engine.mjs → insights              │
                  └─────────────────────────────────────────────┘

                  ┌─────────────────────────────────────────────┐
                  │         WEB SERVER (port 3030/alt)           │
                  │          web/server.mjs (403 lines)          │
                  │                                              │
                  │  ┌→ core/crawler-core.mjs (933 lines)        │
                  │  │   extractAd() ─── classification → eval   │
                  │  │       ↓                                   │
                  │  │   output/web/{jobId}/                     │
                  │  │       ↓                                   │
                  │  └→ core/exporter.mjs → JSON/CSV/XLSX       │
                  │                                              │
                  │  Dependencies:                               │
                  │  ┌→ core/browser-pool.mjs                    │
                  │  ├→ core/rate-limiter.mjs                    │
                  │  ├→ core/queue.mjs                           │
                  │  ├→ core/cache.mjs                           │
                  │  ├→ core/dedupe.mjs                          │
                  │  ├→ core/semantic-page-classifier.mjs        │
                  │  ├→ core/page-decision-engine.mjs            │
                  │  ├→ core/pattern-registry.mjs                │
                  │  ├→ core/adaptive-discovery-engine.mjs       │
                  │  ├→ core/exploration-strategy.mjs            │
                  │  ├→ core/hypothesis-validator.mjs            │
                  │  ├→ core/adaptive-learning-loop.mjs          │
                  │  ├→ core/opportunity-scorer.mjs              │
                  │  ├→ core/universal-knowledge-engine.mjs      │
                  │  ├→ core/knowledge-transfer-engine.mjs       │
                  │  └→ core/cross-site-reasoner.mjs             │
                  └─────────────────────────────────────────────┘

                  ┌─────────────────────────────────────────────┐
                  │         CLI (csi-crawler-v9.mjs)             │
                  │                                              │
                  │  Same extractAd() as Web Server              │
                  │  + category-walker.mjs                       │
                  │  + keyword-search.mjs                        │
                  │  + smart-search.mjs                          │
                  │  + scheduler.mjs                             │
                  │  + post-search.mjs                           │
                  │  + reporter.mjs                              │
                  │                                              │
                  │  Produces: 0 records                         │
                  └─────────────────────────────────────────────┘
```

## Schema Comparison

| Field | Engine | Web Server / CLI | Canonical (target) |
|---|---|---|---|
| `id` | — | `adId` | `id` |
| `site` | Not stored | Not stored | `site` |
| `url` | `url` | `url` | `url` |
| `title` | `title` | `title` | `title` |
| `price` | `price` | `price` | `price` |
| `currency` | `currency` | — | `currency` |
| `phone` | `phone` (string) | `phones` (pipe-delimited string) | `phone` (string) |
| `email` | `email` | `emails` (pipe-delimited string) | `email` (string) |
| `location` | `location` | `location` | `location` |
| `category` | — | `category` | `category` |
| `extractedAt` | `timestamp` | — | `extractedAt` |
| Extra fields | `description` | `description`, `company`, `whatsapp`, `postedDate`, semantic metadata | (optional extras allowed) |

## Phone Extraction Comparison

| Criterion | Engine (regex) | Web/CLI (crawler-core) |
|---|---|---|
| `tel:` links | Not used | Yes — primary source |
| Ad-ID filtering | **No** — matches ad IDs | Yes — explicit `adId` exclusion |
| Country-codes | Not used | Yes — configurable per site |
| Regex pattern | Loose `\d{3,4}[-.\s]?\d{3}[-.\s]?\d{4}` | Staged: country-code regex + `\d{8,14}` + `0\d{9,10}` |
| Real phones on Gumtree (test) | 76% (19/25) mixed with 20% garbage | 0% (selectors fail) |

## Decision: Canonical Extractor

**Winner: Hybrid approach**

Take the engine's simplicity (direct Playwright, no classification overhead) + the crawler-core's phone-filtering logic + a unified schema.

New location: `core/canonical-extractor.mjs`

All three entry points will call this module.
