# Recon Module — Authorized Bug Bounty Reconnaissance

## LEGAL NOTICE
============

This module is intended for use ONLY within the scope of an active,
signed bug bounty program (e.g., HackerOne, Bugcrowd, YesWeHack) or
with explicit written authorization from the target's owner.

Running this module against any system without authorization is illegal
in most jurisdictions and violates the terms of every major bug bounty
platform. The authors and contributors accept no liability for misuse.

Before running:

1. Obtain the program's scope document.
2. Save it as a PDF and compute its SHA-256.
3. Create a scope.json that references that hash.
4. Run `python -m recon.cli verify-scope` to confirm.

The module will refuse to operate without a valid, unexpired scope.
This is a feature, not a bug.

## Overview
Layered design: `ScopeValidator → RateLimiter → RobotsCache → HttpClient → AuditLog → JsExtractor → IdorProbe → ReportBuilder → Orchestrator → CLI`

No request leaves the host without passing the safety envelope (scope, robots, rate limit, audit).

## Usage

### 1. Verify scope
```bash
python -m recon.cli verify-scope --scope recon/scope/scope.json
# prints summary, exits 0. Expired/invalid → exit 2.
# Requires typing "I CONFIRM" before any network activity.
```

### 2. Scan (katana → httpx → nuclei)
```bash
python -m recon.cli scan \
    --scope recon/scope/scope.json \
    --target https://example.com/ \
    --tools katana,httpx,nuclei \
    --out recon/reports/
```
Missing tools are skipped (ToolResult skipped=True), no exception.

### 3. IDOR probe (two sessions)
```bash
python -m recon.cli idor \
    --scope recon/scope/scope.json \
    --endpoints recon/reports/endpoints.txt \
    --session-a recon/sessions/user_a.json \
    --session-b recon/sessions/user_b.json \
    --out recon/reports/
```
Requires two authenticated sessions (different users). Flags `possible_idor` only if both 200, bodies differ (sha256), identifier present (numeric/uuid/param_id).

## Scope file
See `recon/scope/scope.example.json` and `recon/scope/README.md`.
Generate `authorization_sha256`:
```bash
sha256sum authorization.pdf
```

## Sessions
See `recon/sessions/README.md`. Export cookies from a dedicated browser profile. Never commit `sessions/*.json`.

## What the tool will NOT do and why
- No User-Agent rotation, header randomization, TLS spoofing — honest `User-Agent: Name/Version (+contact: email)` is required and verifiable.
- No proxy rotation or traffic anonymization — obscuring origin violates program transparency.
- No WAF/rate-limit evasion, CAPTCHA bypass — evading controls is out-of-scope.
- No authentication bypass, credential guessing, brute-force — only public pages and your own authenticated sessions.
- No payloads (SQLi, XSS, SSRF, RCE, etc.) — separate tool, separate authorization.
- No large wordlist enumeration — only in-scope, deduplicated targets.
- No response body/cookie/token storage — only hashes, metadata, and audit chain. Reports are scrubbed via `SCRUB_KEYS`.
- No `POST/PUT/PATCH/DELETE` — only `GET/HEAD/OPTIONS` against target.
- Every request is gated by `ScopeValidator.assert_allowed`, `RobotsCache.can_fetch`, `RateLimiter.acquire`, and `AuditLog.log` (hash-chained).

## Project layout
```
recon/
  core/scope_validator.py  (gate)
  core/rate_limiter.py
  core/robots_cache.py
  core/audit_log.py
  core/http_client.py      (only place that issues HTTP)
  core/js_extractor.py
  core/idor_probe.py
  core/report_builder.py
  core/orchestrator.py
  cli.py
  tests/
  scope/scope.example.json
  sessions/
  reports/
```

## Constraints (C1–C12)
Zero modifications outside `recon/`, no network without scope/robots/limiter/audit, one honest UA, fail-closed, deterministic (injectable clock/sleeper), no randomness, `logging` not `print()`, `asyncio.create_subprocess_exec` never `shell=True`.

## Testing
```bash
pytest recon/tests -v
# No real network — httpx.MockTransport only.
# No real time — clock/sleeper injected.
```
