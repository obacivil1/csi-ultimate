# Tenant Isolation Audit Report

## Summary
**Score: 7/10** — SaaS API routes enforce org isolation. Engine proxy routes require authentication (cookie-based). The engine itself is single-tenant — full multi-tenant data isolation requires separate engine instances per org.

---

## SaaS Routes (Isolation Verified ✅)

| Route | Auth Required | Org Filtering | Status |
|-------|---------------|---------------|--------|
| `POST /api/auth/login` | No (auth) | N/A | ✅ Creates session for the user's org |
| `POST /api/auth/register` | No (auth) | N/A | ✅ Creates new org per registration |
| `POST /api/auth/logout` | No (auth) | N/A | ✅ Deletes session |
| `GET /api/auth/session` | Cookie/header | N/A | ✅ Returns session's org |
| `GET /api/org` | Cookie/header | `session.orgId` | ✅ Reads only caller's org |
| `PUT /api/org` | Cookie/header + role | `session.orgId` | ✅ Updates only caller's org |
| `GET /api/org/users` | Cookie/header | `session.orgId` | ✅ Lists only caller's org users |
| `POST /api/org/users` | Cookie/header + admin | `session.orgId` | ✅ Creates user in caller's org |
| `PUT /api/org/users/[id]` | Cookie/header + admin | `session.orgId` cross-check | ✅ Validates target belongs to same org |
| `DELETE /api/org/users/[id]` | Cookie/header + admin | `session.orgId` cross-check | ✅ Validates target belongs to same org |
| `GET /api/usage` | Cookie/header | `session.orgId` | ✅ Reads only caller's org usage |
| `GET /api/plans` | No (public) | N/A | ✅ Public plan data |

## Engine Proxy Routes (Auth Required ✅, Org Isolation ⚠️)

All 19 engine proxy routes now require authentication via cookie, header, or query param. However, the engine itself is **single-tenant** — it stores all crawls, sites, schedules, and reports in shared state files (`../state/`). There is no org-level filtering in the engine.

| Route | Auth | Org Isolation | Notes |
|-------|------|---------------|-------|
| `POST /api/crawl` | ✅ Cookie/header | ⚠️ Engine-level only | All orgs share same engine state |
| `GET /api/crawl/[id]` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/crawl/[id]/export` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/crawl/[id]/records` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/crawl/[id]/results` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `POST /api/crawl/[id]/stop` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/crawl/[id]/stream` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/events` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/health` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/jobs` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/reports` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/reports/latest` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/schedules` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `POST /api/schedules` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `PUT /api/schedules/[id]` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `DELETE /api/schedules/[id]` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `PUT /api/schedules/[id]/toggle` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/settings` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `PUT /api/settings` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/sites` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/sites/[hostname]` | ✅ Cookie/header | ⚠️ Engine-level only | — |
| `GET /api/sites/[hostname]/discover` | ✅ Cookie/header | ⚠️ Engine-level only | — |

## Auth Mechanism

Authentication flows in priority order:
1. `Authorization: Bearer <token>` header (server-side API calls)
2. `csi-session=<token>` cookie (automatically sent by browser on same-origin requests)
3. `?token=<token>` query parameter (SSE streams, GET requests)

## Gaps

### Critical
1. **Engine is single-tenant** — no org-level data segregation. Org A can see Org B's crawls through engine proxy routes if they know the crawl IDs. Mitigation: require separate engine instances per org in production (each with different `CSI_PORT` and `state/` directory). Add `orgId` to engine state files to enable single-instance multi-tenant mode.

### Medium
2. **No rate limiting** — auth endpoints and engine proxy routes have no brute-force protection. Mitigation: add `express-rate-limit` to the engine or use Next.js middleware.
3. **No audit log** — admin role changes, invites, and logins are not logged. Mitigation: implement `state/saas/audit.json` append-only log.
4. **Sessions not scoped to IP/user-agent** — a stolen token can be used from any IP. Mitigation: store IP hash in session and validate on each request.

### Low
5. **No CSRF protection** — but since auth uses `SameSite=Lax` cookies, CSRF is mitigated for mutating requests.
6. **Session cleanup is passive** — expired sessions are only cleaned up when accessed. Mitigation: periodic cleanup via cron or startup.
