# Authentication Audit Report

## Summary
**Score: 8/10** — All auth flows verified. Registration, login, session persistence, and logout work end-to-end. Gaps include lack of password reset and rate limiting.

---

## Flows Verified

### Registration
| Step | Status | Details |
|------|--------|---------|
| Email uniqueness check | ✅ | `409 Conflict` if email already registered |
| Password validation | ✅ | Min 8 characters enforced server-side + client-side |
| Organization creation | ✅ | New org created with "starter" plan |
| User creation | ✅ | Owner role assigned to registering user |
| Session creation | ✅ | Session token returned + cookie set |
| Response | ✅ | Returns `{ token, user, org }` + `Set-Cookie` header |

### Login
| Step | Status | Details |
|------|--------|---------|
| Email lookup | ✅ | Case-insensitive via `.toLowerCase()` |
| Password verification | ✅ | pbkdf2 constant-time comparison via `verifyPassword` |
| Session creation | ✅ | New session token + cookie |
| Invalid credentials | ✅ | `401 Unauthorized` — no user enumeration (`Invalid credentials` for both bad email and bad password) |
| Response | ✅ | Returns `{ token, user, org }` + `Set-Cookie` header |

### Session Persistence
| Step | Status | Details |
|------|--------|---------|
| Cookie-based auth | ✅ | `csi-session` cookie, `SameSite=Lax`, 24h TTL |
| Automatic resend | ✅ | Browser sends cookie with every same-origin request |
| Session validation | ✅ | `/api/auth/session` validates token + checks TTL |
| Expired session cleanup | ✅ | Expired sessions cleaned up on access; `cleanupExpiredSessions()` available for batch cleanup |
| Page refresh persistence | ✅ | Cookie persists across refreshes; auth context calls `checkSession()` on mount |

### Logout
| Step | Status | Details |
|------|--------|---------|
| Server-side session deletion | ✅ | Session removed from `sessions.json` |
| Cookie clearance | ✅ | `Set-Cookie: csi-session=; Max-Age=0` |
| Client state reset | ✅ | Auth context sets `{ user: null, org: null, token: null }` |
| Error resilience | ✅ | Logout succeeds even if server is unreachable (client state cleared) |

### Route Protection
| Step | Status | Details |
|------|--------|---------|
| Admin page | ✅ | `AuthGuard` with `requiredRole="admin"` — redirects to `/login` if not authenticated |
| Login page | ✅ | Redirects to `/` if already authenticated |
| API routes (SaaS) | ✅ | `getSessionFromReq` on every request — returns 401 if invalid |
| API routes (engine) | ✅ | `getSessionFromReq` on every request — returns 401 if invalid |
| Plans API | ✅ | Public — intentionally unprotected |

## Token Flow

```
Browser                          Server
  │                                │
  │── POST /api/auth/login ──────▶│ (cookie set in response)
  │◀──── { token, user, org } ────│ (+ Set-Cookie: csi-session=xxx)
  │                                │
  │── GET /api/auth/session ─────▶│ (cookie auto-sent)
  │◀── { authenticated, user } ───│
  │                                │
  │── GET /api/sites ────────────▶│ (cookie auto-sent)
  │◀───────── { sites } ──────────│
  │                                │
  │── POST /api/auth/logout ─────▶│ (session deleted, cookie cleared)
  │◀────── { ok: true } ──────────│ (+ Set-Cookie: csi-session=; Max-Age=0)
```

## Cookie Configuration
| Property | Value | Rationale |
|----------|-------|-----------|
| Name | `csi-session` | — |
| HttpOnly | Yes | Prevents XSS-based token theft |
| SameSite | `Lax` | Mitigates CSRF; allows GET navigations |
| Path | `/` | Available to all routes |
| Max-Age | 86400 seconds (24h) | Matches session TTL |
| Secure | Not set | OK for localhost; should be added in production |

## Gaps

### Medium
1. **No password reset flow** — users cannot recover accounts without admin intervention.
2. **No rate limiting** — registration and login endpoints can be brute-forced.
3. **No email verification** — accounts are active immediately after registration.
4. **No "remember me"** — session duration is fixed at 24h.

### Low
5. **No MFA / 2FA** — requirement for enterprise customers.
6. **No session revocation UI** — admin cannot force-logout users.
7. **No login audit trail** — no record of successful/failed login attempts.
