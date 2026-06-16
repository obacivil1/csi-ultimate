# CSI-Ultimate — Dependency Map

## External Packages

| Package | Used By | Import |
|---------|---------|--------|
| `playwright-extra` | `browser-pool.mjs` | `import { chromium } from "playwright-extra"` |
| `puppeteer-extra-plugin-stealth` | `browser-pool.mjs` | `import stealth from "puppeteer-extra-plugin-stealth"` |
| `playwright` | (peer dep) | Required by playwright-extra |
| `xlsx` | `exporter.mjs` | `import * as XLSX from "xlsx"` |

## Internal Module Dependencies

```
csi-crawler-v9.mjs (ENTRY POINT)
  ├── browser-pool.mjs
  │     └── (playwright-extra, puppeteer-extra-plugin-stealth)
  ├── queue.mjs
  ├── cache.mjs
  ├── dedupe.mjs
  │     └── (crypto)
  ├── crawler-core.mjs (dynamic import via import())
  │     ├── queue.mjs
  │     ├── cache.mjs
  │     ├── dedupe.mjs
  │     ├── rate-limiter.mjs
  │     ├── semantic-page-classifier.mjs
  │     │     └── (fs, path, url) — dictionaries.json
  │     ├── page-decision-engine.mjs
  │     ├── pattern-registry.mjs
  │     │     └── pattern-similarity.mjs
  │     ├── adaptive-discovery-engine.mjs
  │     ├── exploration-strategy.mjs
  │     ├── hypothesis-validator.mjs
  │     ├── adaptive-learning-loop.mjs
  │     │     └── (fs, path) — state/adaptive-memory.json
  │     ├── opportunity-scorer.mjs
  │     ├── universal-knowledge-engine.mjs
  │     │     ├── structural-knowledge-graph.mjs
  │     │     │     └── (fs, path)
  │     │     └── concept-abstraction-engine.mjs
  │     ├── knowledge-transfer-engine.mjs
  │     │     ├── universal-knowledge-engine.mjs
  │     │     └── concept-abstraction-engine.mjs
  │     └── cross-site-reasoner.mjs
  │           ├── knowledge-transfer-engine.mjs
  │           └── universal-knowledge-engine.mjs
  ├── category-walker.mjs
  │     ├── crawler-core.mjs (smartLoad)
  │     └── cache.mjs (pageCache)
  ├── keyword-search.mjs
  │     ├── crawler-core.mjs (smartLoad, discoverLinksFromHtml, selectCandidateLinks, learnLinkPatterns)
  │     ├── cache.mjs (pageCache)
  │     └── dedupe.mjs
  ├── post-search.mjs
  │     ├── crawler-core.mjs (smartLoad, discoverLinksFromHtml, selectCandidateLinks, learnLinkPatterns)
  │     ├── cache.mjs (pageCache)
  │     └── dedupe.mjs
  ├── exporter.mjs
  │     └── (xlsx)
  ├── scheduler.mjs
  ├── rate-limiter.mjs
  ├── reporter.mjs
  ├── dashboard.mjs
  ├── cli.mjs
  │     └── config-manager.mjs
  ├── config-manager.mjs
  └── integration-tester.mjs
        ├── rate-limiter.mjs (dynamic)
        ├── reporter.mjs (dynamic)
        ├── cli.mjs (dynamic)
        ├── config-manager.mjs (dynamic)
        └── dashboard.mjs (dynamic)
```

## Static vs Dynamic Imports

| Type | File | Target |
|------|------|--------|
| STATIC | v9.mjs:35-39 | browser-pool, queue, cache, dedupe, extractAd |
| STATIC | v9.mjs:42-46 | category-walker, keyword-search |
| STATIC | v9.mjs:50-51 | exporter, scheduler |
| STATIC | v9.mjs:54-66 | post-search, rate-limiter, reporter |
| STATIC | v9.mjs:69-80 | cli, dashboard, config-manager, integration-tester |
| DYNAMIC | v9.mjs:180 | crawler-core.mjs (inside getLinksFromUrl) |
| DYNAMIC | integration-tester.mjs | rate-limiter, reporter, cli, config-manager, dashboard |
