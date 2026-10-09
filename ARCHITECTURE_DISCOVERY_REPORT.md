# ARCHITECTURE_DISCOVERY_REPORT.md

**Directive:** SPECIALIZED_VULNERABILITY_DETECTION_ENGINE (Race Conditions + Advanced Authorization)
**Phase:** PHASE 0 — DISCOVERY (read-only)
**Status:** Complete. **No implementation changes were made for this directive.**
**Repo:** `E:\N8N\scraper\scraper2\csi-ultimate`
**Method:** 4 parallel read-only code explorations (tree/entries, request-session-scope, detectors-reports-tests, Python recon side). No files created, modified, or executed beyond the existing test suite baseline.

> Working-tree note: `git status` shows many pre-existing modifications from unrelated work (job-hunter, web routes, recon, etc.). Recommend committing or stashing before any Phase 1 work so the security engine has a clean regression baseline.

---

## 1. Repository tree (2 levels, purpose per directory)

- `app/` — legacy ad-hoc scrape-and-present scripts (`server.mjs`, `pipeline_v2.mjs`, `scrape_*.mjs`).
- `core/` — main Node crawler library (~79 `.mjs`): `crawler-core`, `discovery-engine`, `stealth-*`, `proxy-pool`, `db`, detectors.
- `engine/` — proposal/insight engine (`presentation-engine.mjs`, `server.mjs`, `extractors/`).
- `web/` — production Express 5 app (`server.mjs`, `routes/`, `middleware/`, `scheduler.mjs`, `public/`).
- `config/` — `env.mjs`, `index.mjs`, `defaults.json`, `sites/*.json`, `semantic-classifier/`.
- `scripts/` — ops entry points: `analytics/`, `job-hunter/run-hunter.mjs`, `legacy/crawlers/`, `lead-gen/`, `stage-tests/`, `db-import.mjs`.
- `recon/` — Python authorized bug-bounty recon pipeline (`cli.py`, `core/`, `brain/`, `decider/`, `scope/`, `tests/`).
- `local-lab/` — intentionally vulnerable Flask target (`target/app.py`, `run_target.py`, `engine/auth.py`) + ~50 tests. **Best existing validation-lab seed.**
- `n8n-workflow/` — n8n automation (`csi_pipeline_flow.json`, `crm.json`, `pipeline.mjs`, `orchestrator.mjs`).
- `enterprise/`, `templates/`, `assets/`, `takeoff/`, `planning_tools/` — reports/UI/planning-report Python helpers.
- `data/`, `output/`, `proposals/`, `reports/`, `deliverables/`, `presentations/`, `state/`, `log(s)/`, `checkpoints/` — SQLite/JSON outputs, PPTX/PDF artifacts, history.
- `docs/`, `archive/`, `legacy/`, `tests/`, `content_plan/` — docs, old code, Node tests.
- Root Python one-offs: `pentest_tool.py` (1208-line monolith), `dcma_14_point.py`, `convert_to_pptx.py`, `build_report.py`.
- Notable docs: `SECURITY.md`, `SCRAPER_AUDIT.md`, `docs/ARCHITECTURE_REALITY_CHECK.md`, `docs/ARCHITECTURE_PROOF.md`.

No files named `*race*`, `*scanner*`, `*toctou*`, `*bola*`, `*bfla*` exist.

## 2. Execution entry points

- `package.json` scripts: `start` (`node run.mjs`), `serve` (`node web/server.mjs`), `report:*` (analytics), `stage2a–5`, `hunt` (`scripts/job-hunter/run-hunter.mjs`), `test` (`node --test --test-force-exit tests/*.test.mjs`), `db:import`, `start/test:legacy`.
- `run.mjs` — CLI sales automation: Playwright-stealth crawl → `engine/presentation-engine.mjs` → PPTX to `proposals/`, dedupe via `log/history.json`.
- `web/server.mjs` — Express 5 + JWT/cookies/rate-limit/CORS/compression; mounts `routes/{auth,tenders,contractors,payments,dashboard,awards,projects,export,alerts,admin,v1,engine}` + scheduler/cache. Docker `CMD`, port 3000. Alt servers: `engine/server.mjs`, `app/server.mjs`.
- `scripts/job-hunter/run-hunter.mjs`, `scripts/legacy/crawlers/csi-crawler-v9.mjs`, `scripts/analytics/{field-completeness,tender-alerts,verify-audit}.mjs`.
- `recon/cli.py` — `verify-scope|scan|idor|feedback` → `core/orchestrator.py` → report.
- `pentest_tool.py` — root scanner, scoped by `scope.yaml`.
- `local-lab/run_target.py` — Flask target on `127.0.0.1:5001`.

## 3. Runtime model

- **Languages:** Node.js ESM (`"type":"module"`, Docker `node:22`) + Python 3 (recon/pentest/report scripts). No TypeScript sources found (`.mjs`/`.py` only).
- **Served as:** (a) CLI crawler `node run.mjs`; (b) web server `node web/server.mjs`; (c) n8n workflows + `orchestrator/pipeline.mjs`; (d) Python CLIs (`recon/cli.py`, `pentest_tool.py`) against the Flask `local-lab` target.
- **Python ↔ Node relationship:** separate tools, **zero shared code/imports**; duplicated HTTP stacks, rate limiting, audit, and reports. Overlap is domain-only (Node scrapes; Python recon/pentests).

## 4. Python modules (`recon/` + root)

- `recon/cli.py` — argparse entry (`verify-scope|scan|idor|feedback`), nuclei/httpx/katana output parsers.
- `recon/core/` — `scope_validator`, `http_client` (sole sender), `orchestrator` (subprocess katana/httpx/nuclei/subfinder), `idor_probe`, `robots_cache`, `rate_limiter`, `js_extractor`, `audit_log` (hash-chained), `report_builder`.
- `recon/brain/` (pure, no network) — `endpoint_ranker`, `pattern_finder`, `anomaly_finder`, `hypothesis_builder`, `brain.py`.
- `recon/decider/` (pure planning) — `decision_brain`, `priority_engine`, `action_planner`, `strategy`, `feedback_loop`, `decision_log`.
- `recon/scope/sessions/state/reports/` — scope examples, session cookies, `feedback.jsonl`, JSON reports.
- `pentest_tool.py` — checks: headers/tech/robots/SSL/methods/CORS/cookies/XSS/redirect/error-SQLi/time-SQLi; `ScopeEnforcer`, `SafetyStop`.
- No `pyproject.toml` / root `requirements.txt`; `recon/requirements.txt` → `httpx, beautifulsoup4, pydantic, pytest(+asyncio)`.

## 5. JS modules (`core/`, `web/`, `scripts/`)

- Request/crawl: `core/http-fetch.mjs`, `core/general-crawl.mjs`, `core/general-mission.mjs`, `core/canonical-extractor.mjs`, `core/extractor.mjs`, `core/anti-detect.mjs`.
- Stealth/session: `core/fingerprint-engine.mjs` (13 crowd profiles), `core/behavior-engine.mjs` (Bézier mouse/scroll), `scripts/job-hunter/nav.mjs` (`Session`), `scripts/job-hunter/engine.mjs` (`Engine`).
- Safety: `core/ssrf-guard.mjs`, `core/rate-limiter.mjs`, `core/proxy-pool.mjs`.
- Detectors: `ban-detector`, `tech-detector`, `anomaly-scorer`, `topic-classifier`, `semantic-page-classifier`, `drift-detector`, `opportunity-scorer`, `contact-miner`.
- Data/report: `core/db.mjs`, `core/report-factory.mjs`, `core/exporter.mjs`, `core/reporter.mjs`, `core/dashboard.mjs`, `core/audit-chain.mjs`, `core/anchor-ledger.mjs`, `core/logger.mjs`, `core/privacy-mask.mjs`.
- Web: `web/server.mjs`, `web/routes/*.mjs` (incl. `auth`, `export`, `engine`, `general` with `POST /crawl`), `web/middleware/auth.mjs`, `web/scheduler.mjs`.

## 6. Request engine

- Node: `core/http-fetch.mjs::httpFetch()/httpFetchDocument()` — native `fetch`, rotated UA/header order, `waitForHost()` + circuit breaker, manual redirect ≤5, opt-in 5-min cache, `classifyBan/tech/anomaly/trust` scoring; returns `{ok,blocked,kind}` with Playwright fallback signal. `core/ssrf-guard.mjs::safeFetch()` — `redirect:manual` + `assertPublicUrl` per hop (≤5).
- Python: `recon/core/http_client.py::HttpClient` — **sole recon sender** (`httpx.AsyncClient`, `follow_redirects=False`); envelope `scope → robots → limiter → audit`; manual redirect ≤5; `429/503` ×3 with `Retry-After`/exp-backoff.
- Gap: `core/proxy-pool.mjs` (scored pool, health probes) is **not consumed** by `httpFetch`/`safeFetch`.

## 7. Browser engine

- `playwright` + `playwright-extra` + `puppeteer-extra-plugin-stealth`, headless Chromium.
- `core/fingerprint-engine.mjs` — geo-aligned locale/tz/geo, canvas/audio/WebGL/`webdriver` spoofing.
- `core/behavior-engine.mjs::simulateHumanBehavior/humanScroll/recordSiteResponse`.
- `scripts/job-hunter/nav.mjs::Session.go()` — `goto(domcontentloaded,45s)`, challenge/ban detect + context rotation, per-host `AdaptiveRateLimiter`.
- `core/general-crawl.mjs::browserFetch` — lazy `anti-detect.mjs:createPage()` + `installPlaywrightSsrfGuard` (aborts non-public `route/**/*`).

## 8. Session / authentication handling

- **No test-account / login-flow support for targets.** Node `Session` holds only a rate limiter + `stat{requests,ok,blocked}` — no cookies/headers/login. Recon `sessions: dict[str,dict]` injects only static cookies via header builder.
- `web/routes/auth.mjs` + `web/middleware/auth.mjs` is the app's **own** JWT/bcrypt user system — not target authentication. Must not be confused with scan identities.
- Consequence: Identity matrix (User A/B, tenants, roles) and authenticated differential testing are **entirely missing** — both new engines need a first-class `Session`/`Identity` abstraction with login Mott/cookie-jar support.

## 9. Target / scope handling

- Node: `core/ssrf-guard.mjs::assertPublicUrl/safeFetch/installPlaywrightSsrfGuard` — blocks loopback/private/link-local/CGNAT/multicast, `localhost`, metadata endpoints; verifies all DNS A-records. `web/routes/general.mjs POST /crawl` + `runMission` clamp `depth≤3, maxPages≤100`.
- Python: `recon/core/scope_validator.py` (Pydantic `Scope`) — `scope.json` must exist, tz-aware validity window, authorization-document SHA256 match, **exact** `allowed_hosts` (no wildcards), schemes/ports, `denied_paths`, contact UA, `max_rps≤100`; per-URL `assert_allowed()` + interactive `I CONFIRM → confirmed` gate enforced by `HttpClient` and `Orchestrator`.
- `scope.yaml` (pentest_tool): loopback-only `127.0.0.1:5001`, excluded `/admin/delete`, `/api/payments`, `max_rps:5`, `allow_state_changing:false`.
- Emergency stop: **partial** — `pentest_tool.SafetyStop` (server errors ≥3, WAF block, data exposure); **no global kill-file/operator abort**; recon has only per-tool timeout/skip. `verify-scope` demands interactive confirm (CI-unfriendly).
- Risk: **two scope systems, two enforcers, two `ScopeError` classes** (`scope.yaml` loose dict vs `scope.json` strict Pydantic) — drift risk; unify behind one gate interface in Phase 1.

## 10. Crawling / discovery

- `core/general-crawl.mjs::parseHtmlDocument/extractText/crawlUrls` — jsdom title/headings/text/links/images/tables/contact mining; BFS `queue+seen+perHost/maxPerHost/delayMs`; follows ≤25 internal links while `level<depth`.
- `core/general-mission.mjs::runMission` — crawl → classify → topic filter → `db.upsertDocuments` → report files.
- `scripts/job-hunter/engine.mjs` — expatriate pagination + `site:` Bing queries (domain-specific, reusable pattern only).
- `recon/core/orchestrator.py` — shells out to katana/httpx/nuclei/subfinder; `_filter_output_file/_is_in_scope_line`; `js_extractor.py` grabs `<script src>` + `/api/|/vN/` URLs, scope-filtered.

## 11. Endpoint inventory

- **No vuln-oriented endpoint store exists.** Recon inventory = flat `out_dir/raw/*/*.txt` files filtered by `assert_allowed` (no DB). Node inventory = `documents` DB rows (tenders/contractors/awards/projects) — content-oriented, not Endpoint/Request/Response objects.
- Missing: `Endpoint{method,path,params,auth,tenant}`, normalized `Request/Response`, `Resource/Object` graph.

## 12. Response normalization

- `parseHtmlDocument/extractText`, `canonical-extractor.mjs` (Playwright single-pass DOM + currency/block/ban classification), `report-factory.flattenDocs()` row schema (`url/host/title/chars/links/images/tables/dominantTopic/topicPct/emails/phones/whatsapp/social/hasContact`).
- `httpFetch` returns `{ok,blocked,kind}`; recon uses raw subprocess stdout + `ToolResult{tool,exit_code,lines}`.
- Missing: unified normalized `Response{status,headers,bodyHash,parsedJson,timing,stateIndicators}` shared by both stacks.

## 13. Storage

- `data/csi.db` (SQLite+WAL, `better-sqlite3`; schema in `core/db.mjs::migrate()`): `tenders/contractors/awards/projects`, `documents{id,source,doc_type,url,url_hash!U,raw_json,canonical_json,contacts_json,topic,status,confidence,extracted_at,run_id}`.
- `data/*.json` interop files; `state/` ~105 entries (`crawls.json`, sessions, records, `pattern-registry.json`, `anchor_ledger.jsonl`, analytics alerts); `scripts/analytics/*` are read-only over these.
- `recon/reports/` (JSON + audit-log SHA256) vs `reports/` (Node) — separate.

## 14. Detector registration

- **No plugin contract, no registry.** Detectors are called via direct imports (`classifyBan/detectTechnologies/scoreResponse` inside `http-fetch.mjs`, `canonical-extractor.mjs`, `anti-detect.mjs`). Adding a detector today means editing call sites — the exact anti-pattern the directive forbids replicating. Phase 1 must introduce a registry **without** touching existing call sites.

## 15. Concurrency facilities

- `core/rate-limiter.mjs` — `AdaptiveRateLimiter/RetryHandler/RequestThrottle/CircuitBreaker/getHostLimiter/waitForHost` (per-host adaptive delay, breaker closed/open/half-open, exp-backoff + jitter).
- `recon/core/rate_limiter.py` — asyncio token-bucket per host + `max_per_host` cap / `QuotaExceeded`; `robots_cache.py` uses `asyncio.Lock`.
- `scripts/job-hunter/engine.mjs` — worker pool `CONC≤6`, `budgetMs/deadline/timeLeft()` guards (good budget pattern to copy).
- Recon orchestrator: `_concurrency=min(ceil(rps),25)` + `-rl/-c` pacing + 300s tool timeout; web `job-manager` enqueue/cancel.
- Missing: **synchronized bounded-parallel executor** (barrier/latch start for race probing) — must be built, with hard ceilings per directive §20.

## 16. Reporting

- `core/report-factory.mjs::buildReport()` → `{meta{title,generatedAt,format:general-report-v1},stats,hosts[],topics[],sources[],docs[]}`; renders `report.json/csv/xlsx/html/deck.html`; signed via `audit-chain.mjs`/`anchor-ledger.mjs`. `exporter.mjs` (xlsx/json/csv, AR/EN headers), `reporter.mjs::SessionReporter` (console+JSON), `dashboard.mjs`, `web/routes/export.mjs` (plan-gated CSV).
- Recon: `report_builder.build/write_report` + hash-chained `AuditLog`; existing isolated IDOR finding schema at `recon/cli.py:396` (`{type:idor,confidence:medium,url,evidence:{session_a/b_status,body_a/b_sha256,identifier_key},reproduction_steps[],impact,remediation}`) — useful evidence-shape precedent, hash-only (never stores bodies).
- Finding schemas today: Ban `{banned,kind,confidence(0-100),evidence[],reason,action}`; Anomaly `{score(0-1),decision:allow|step_up|deny,signals[],explanation[],fallback}`; Tech `[{tech,matched}]+{missingHeaders,score}`.
- Gaps for the directive: no `Expected Boundary` / `Observed Behavior` / `Why Security-Relevant` / `Program Scope Considerations` fields; Markdown + machine JSON required by §27 must be added in the new report generator, not retrofitted into `report-factory`.

## 17. Logging

- `core/logger.mjs` — JSON-lines to stdout (stderr for errors), `LEVELS SILENT..DEBUG` via env, `child(bindings)`, safe-stringify. **No correlation/request IDs** anywhere in `core/` (only `run_id` DB column). **Logger performs no redaction**; redaction lives separately in `core/privacy-mask.mjs` (deny-by-default DSL) and `recon report_builder.scrub()` (drops password/token/cookie/auth/secret/jwt, truncates >4096 chars, truncation is silent).
- Directive §26 requires per-test records (timestamp, target, endpoint, identity, test type, correlation ID, concurrency, timing, response summary, state before/after, evidence refs, confidence) — does not exist; new engines must emit it from day one with scrub-before-write.

## 18. Configuration

- `config/sites/*.json` (+`_disabled/`), `config/defaults.json`, `config/env.mjs` (loads `.env`, enforces `JWT_SECRET≥32chars`); `.env` gitignored + `.env.example` (PORT, JWT_SECRET, SMTP, PAYPAL, `CSI_*`, FlareSolverr, cache TTL).
- `scope.yaml` + `recon/scope/*.example/test.json` + `authorization.pdf`. Two-scope-system risk noted in §9.

## 19. Test infrastructure

- Node: `node --test --test-force-exit tests/*.test.mjs` — 31 files + `tests/unit/` (8) + `tests/verification/` fixtures; covers ban/tech/anomaly/topic, extraction, site configs, db, audit-chain/anchor-ledger, SSRF security, http-fetch/rate-limiter/proxy-pool/fingerprint, job-hunter, crawl/mission, contact-miner, config, tender-alerts, report-factory. **Baseline in this session: 270/270 pass.**
- Python: `recon/pytest.ini` (`asyncio_mode=auto`); `recon/tests/` 11 files + `brain/` 5 + `decider/` 6 (~22 modules); root `test_pentest_tool_scope.py` (~250 lines); `local-lab/tests/test_*.py` ~50 (auth checks/abuse/authorized/hostguard/activescan/XSS/payloads).
- `local-lab` Flask target + its tests are the ready-made Phase 6 (validation lab) seed — extend with race/negative-control scenarios rather than building a lab from scratch.

## 20. External dependencies

- npm: `express, better-sqlite3, playwright(+extra), puppeteer-extra-plugin-stealth, jsdom, jsonwebtoken+bcrypt, express-rate-limit, node-cron, nodemailer, pptxgenjs, xlsx, xml2js, cloudscraper`.
- Python: `httpx, beautifulsoup4, pydantic, pytest(+asyncio)` (recon only; no root manifest). External binaries shelled by recon: katana, httpx, nuclei, subfinder (missing-tool → `skipped=True, exit 0`, which can mask a broken pipeline as success).

## 21. Security controls (already present — reuse, don't duplicate)

- SSRF guard (Node + Playwright route abort), dual scope gates + `I CONFIRM`, per-host adaptive rate limiting + circuit breakers, budgets/deadlines, hash-chained audit logs + anchored reports, report scrubbing, app JWT/bcrypt + plan-gated exports, `SafetyStop` (partial e-stop).

## 22. Known limitations (for the two new engines)

1. No Identity/Role/Tenant/Resource/Object/Workflow/State/Transition/Evidence/Finding/ConfidenceScore models anywhere.
2. No authenticated target sessions (no login flow, no cookie jar, no second-identity support) — blocks the §13 test matrix entirely until built.
3. No endpoint inventory DB; recon uses flat text files.
4. No normalized Request/Response envelope shared across stacks.
5. No detector plugin contract; detectors hardwired at call sites.
6. No synchronized-concurrency primitive (race probing needs barrier-start, not just worker pools).
7. No differential-analysis helper (status/structure/field/state comparison of A-vs-B responses).
8. No confidence-scoring function; severities today are heuristic weights.
9. No correlation IDs; logger has no redaction (redaction lives elsewhere).
10. No global emergency stop / kill-switch; `verify-scope` interactivity is CI-unfriendly.
11. Proxy pool exists but is unwired; `pentest_tool.py` is a 1208-line name-coupled monolith; missing external tools report success-as-skipped.

## 23. Technical risks

- Dual scope systems + dual enforcers + dual `ScopeError` → unify behind one gate interface; until then every new sender must call **both** gates.
- Duplicated HTTP/rate-limit/robots/audit/report stacks (Python vs Node) → new shared models must be language-agnostic specs first (JSON-schema/Pydantic + JSDoc typedefs), single implementation per stack only where justified by §19.
- Dirty working tree (unrelated modifications) → freeze a baseline commit before Phase 1.
- `pentest_tool.py` monolith and name-coupled `_PHASES` → do not extend; leave untouched.
- Silent `skipped=True` on missing tools → new engines must fail loudly on missing preconditions.
- Silent report-scrub truncation → evidence pipeline must preserve full hashes + truncated flag.
- Mixed AR/EN comments and magic paths (`state/feedback.jsonl` via env) → new code: English, explicit paths, no magic.

---

## 24. Answers to the directive's 12 questions

1. **Discovery:** `core/general-crawl.mjs` (BFS jsdom crawl), `core/general-mission.mjs`, recon `orchestrator.py` (katana/httpx/nuclei/subfinder) + `js_extractor.py`, job-hunter pagination/Bing discovery (pattern only).
2. **HTTP requests:** `core/http-fetch.mjs` (+`safeFetch` SSRF variant) and `recon/core/http_client.py` (sole recon sender); browser fallback via Playwright `Session.go()` / `browserFetch`.
3. **Sessions:** Node `Session` (rate-limit + stats only, no auth); recon `sessions` dict (static cookies only); app JWT (own users, not targets). **Authenticated target sessions: none.**
4. **Endpoint storage:** none fit for purpose (flat recon txt files; content-oriented Node documents DB).
5. **Concurrency:** `AdaptiveRateLimiter` + circuit breakers (Node), asyncio token bucket (Python), worker pools + budget/deadline guards, tool pacing, web job-manager. No synchronized-start primitive.
6. **Findings:** ban/tech/anomaly classifiers (heuristic scores), recon hash-only `possible_idor`, `pentest_tool` commodity checks. **No race, no BOLA/BFLA, no TOCTOU anywhere** (verified by grep; only isolated lab authz harness).
7. **Reports:** `report-factory` (json/csv/xlsx/html/deck, signed), recon `report_builder` + chained audit log, web CSV export. Schemas lack boundary/expected-vs-observed fields.
8. **Insertion points (minimum disruption):** new additive package (e.g. `security-engine/`) that *consumes* `HttpClient`/`httpFetch`, `Session`/browser contexts, rate limiters, both scope gates, and both report builders — zero edits to existing call sites; lab-validated against `local-lab` (already loopback-scoped in `scope.yaml`).
9. **Reuse:** `http_client.py` + `http-fetch.mjs`, both rate limiters, `robots_cache`, `ScopeValidator` + `ssrf-guard`, Playwright session/fingerprint/behavior stack, `idor_probe` (reference only), both report builders, `AuditLog`/audit-chain, `local-lab` + both test suites.
10. **Do not modify (unsafe):** scope-validation semantics, `ssrf-guard`, `web/routes/auth.mjs` + middleware, `core/db.mjs::migrate()`, existing detector behavior/call sites, `pentest_tool.py` phases, recon orchestrator wiring, `.env`/secret handling.
11. **Missing abstractions:** the full §6 data model (Target→ConfidenceScore), detector plugin contract, authenticated Identity/Session, synchronized parallel executor, differential engine, confidence scorer, kill-switch, correlation IDs.
12. **Smallest reversible patch:** additive `security-engine/` skeleton containing (a) shared model specs (Pydantic + JSDoc, no behavior), (b) a detector-registry interface with **zero** enabled-by-default detectors, (c) a scope-gate wrapper calling both existing gates and refusing ambiguous scope, (d) one lab-only smoke test proving candidate→observation→evidence runs with no findings on safe controls. Rollback = delete the directory (+ one feature-flag line, if any). Gate: `npm test` 270/270 + full `pytest` stay green.

---

## 25. Phase 0 gate

- [x] Repository tree, entries, runtime, modules, engines, scope, storage, detectors, concurrency, reporting, logging, config, tests, deps, controls, limitations, risks — documented above.
- [x] 12 directive questions — answered in §24.
- [x] Zero implementation changes made for this directive in this phase.
- [ ] **Reviewer approval required before any Phase 1 work begins** (per directive §24/PHASE 0 gate).
