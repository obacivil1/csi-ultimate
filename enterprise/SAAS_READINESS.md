# SAAS Readiness Assessment

## Overview
Multi-tenant foundation for CSI Ultimate — authentication, authorization, plan enforcement, and organization management.

## Architecture
- **Auth**: Custom implementation using Node `crypto.pbkdf2Sync` (no dependencies)
- **Persistence**: JSON-file-based store in `state/saas/` (same pattern as engine)
- **Session**: `crypto.randomUUID()` tokens, 24-hour TTL, validated on every request
- **Roles**: `owner → admin → analyst → viewer` hierarchy
- **Plans**: Starter (10 sources, 25k records), Professional (50 sources, 250k records), Ultimate (unlimited)

## Implemented

### Backend
| Route | Status | Notes |
|-------|--------|-------|
| `POST /api/auth/register` | ✅ | Creates org + owner user |
| `POST /api/auth/login` | ✅ | Validates credentials, returns session |
| `POST /api/auth/logout` | ✅ | Deletes session |
| `GET /api/auth/session` | ✅ | Validates token, returns user+org |
| `GET/PUT /api/org` | ✅ | Org details read/update |
| `GET /api/org/users` | ✅ | List users |
| `POST /api/org/users` | ✅ | Invite user (enforces plan limit) |
| `PUT /api/org/users/[id]` | ✅ | Role change (owner/admin only) |
| `DELETE /api/org/users/[id]` | ✅ | Remove user (owner/admin only, self-protection) |
| `GET /api/plans` | ✅ | Public plan listing |
| `GET /api/usage` | ✅ | Org usage vs plan limits |

### Frontend
| Component | Status | Notes |
|-----------|--------|-------|
| `lib/auth-context.tsx` | ✅ | React context, session restore from localStorage |
| `components/auth/guard.tsx` | ✅ | Route guard with role hierarchy check |
| `app/login/page.tsx` | ✅ | Login/register form with tab toggle |
| `app/admin/page.tsx` | ✅ | Org details, user management, usage stats, invite flow |
| `components/layout/sidebar.tsx` | ✅ | "Admin" link in system nav |
| `components/layout/app-shell.tsx` | ✅ | AuthProvider wrapping the app |

## Outstanding

### Required Before Production
| Item | Risk | Notes |
|------|------|-------|
| Cookie-based middleware | Medium | Client-side guard is sufficient but middleware prevents flash of unprotected content |
| Stripe/Payment integration | Deferred | Per spec — not implementing yet |
| Email/password reset | Low | `postmark` or `resend` integration needed |
| Team session management | Low | No "revoke all sessions" or "force logout" |
| Rate limiting | Medium | Auth endpoints have no brute-force protection |
| Fuzzy duplicate matching | HIGH | From verification report — exact URL match only |
| Sample-size transparency | Medium | Trust indicators don't show N for small samples |

### Nice-to-Have
| Item | Notes |
|------|-------|
| OAuth (Google/GitHub) | Useful for enterprise, not MVP |
| Audit log | Track role changes, invites, logins |
| 2FA | TOTP via `otplib` |
| Webhook notifications | Plan exceeded, new team member |
| SSO (SAML/OIDC) | Enterprise only |
| API keys (non-expiring) | For programmatic access |

## Security Notes
- Passwords: pbkdf2 with 100,000 iterations, 64-byte salt, sha512
- Sessions: random UUID, 24h TTL, stored in JSON file
- Role checks: server-side on every mutating admin endpoint
- No secrets or keys committed anywhere
- No auth library dependency — custom implementation is lightweight but lacks battle-testing

## File Structure
```
enterprise/
├── lib/
│   ├── saas-types.ts       # Data model types
│   ├── plans.ts            # Plan definitions + limit checking
│   ├── saas-store.ts       # Persistence layer (fs + crypto)
│   └── auth-context.tsx    # React auth provider + hooks
├── components/
│   └── auth/
│       └── guard.tsx       # Protected route wrapper
├── app/
│   ├── api/
│   │   ├── auth/           # login, logout, register, session
│   │   ├── org/            # org details, users, users/[id]
│   │   ├── plans/          # public plan listing
│   │   └── usage/          # org usage summary
│   ├── login/page.tsx      # Auth page
│   └── admin/page.tsx      # Admin console
└── state/
    └── saas/               # Created at runtime (not in repo)
        ├── users.json
        ├── orgs.json
        ├── sessions.json
        └── usage.json
```
