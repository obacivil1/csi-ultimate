# API Documentation

Base URL: `http://localhost:3000`

## Authentication

All endpoints (except auth and plans) require authentication via one of:
- **Cookie**: `csi-session=<token>` (auto-sent by browser)
- **Header**: `Authorization: Bearer <token>`
- **Query param**: `?token=<token>` (GET/SSE only)

### POST /api/auth/register
Create a new organization and owner account.

**Request:**
```json
{
  "email": "jane@example.com",
  "password": "securePass123",
  "name": "Jane Smith",
  "orgName": "Acme Corp"  // optional, defaults to "{name}'s Organization"
}
```

**Response (201):**
```json
{
  "token": "c9a8b7c6-...",
  "user": { "id": "...", "email": "jane@example.com", "name": "Jane Smith", "role": "owner" },
  "org": { "id": "...", "name": "Acme Corp", "plan": "starter" }
}
```

**Errors:**
| Status | Error | Reason |
|--------|-------|--------|
| 400 | "Email, password, and name required" | Missing required fields |
| 400 | "Password must be at least 8 characters" | Password too short |
| 409 | "Email already registered" | Duplicate email |
| 500 | "Registration failed" | Internal error |

### POST /api/auth/login
Authenticate and create a session.

**Request:**
```json
{ "email": "jane@example.com", "password": "securePass123" }
```

**Response (200):**
```json
{
  "token": "c9a8b7c6-...",
  "user": { "id": "...", "email": "jane@example.com", "name": "Jane Smith", "role": "owner" },
  "org": { "id": "...", "name": "Acme Corp", "plan": "starter" }
}
```

**Errors:**
| Status | Error | Reason |
|--------|-------|--------|
| 400 | "Email and password required" | Missing fields |
| 401 | "Invalid credentials" | Bad email or password |
| 500 | "Invalid request" | Internal error |

### POST /api/auth/logout
End the current session.

**Request (empty body):**
```json
{}
```
Cookie is read automatically from the request.

**Response (200):**
```json
{ "ok": true }
```

### GET /api/auth/session
Validate current session and return user + org.

**Cookie or `?token=` is sent automatically.**

**Response (200):**
```json
{
  "authenticated": true,
  "user": { "id": "...", "email": "jane@example.com", "role": "owner" },
  "org": { "id": "...", "name": "Acme Corp", "plan": "starter" }
}
```

**Errors:**
| Status | Error |
|--------|-------|
| 401 | `{ "authenticated": false }` |

---

## Organization Management

### GET /api/org
Get current organization details.

**Auth:** Required (admin+)

**Response:**
```json
{
  "id": "...",
  "name": "Acme Corp",
  "plan": "professional",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-06-13T00:00:00.000Z"
}
```

### PUT /api/org
Update organization details.

**Auth:** Required (admin+)

**Request:**
```json
{ "name": "Acme Corp Ltd." }
```

**Response:** Updated org object

### GET /api/org/users
List users in the current organization.

**Auth:** Required (any authenticated user)

**Response:**
```json
[
  { "id": "...", "email": "jane@example.com", "name": "Jane Smith", "role": "owner", "createdAt": "..." },
  { "id": "...", "email": "bob@example.com", "name": "Bob Jones", "role": "analyst", "createdAt": "..." }
]
```

### POST /api/org/users
Invite a new user to the organization.

**Auth:** Required (admin+)

**Request:**
```json
{ "email": "bob@example.com", "name": "Bob Jones", "role": "analyst" }
```

**Response:**
```json
{ "ok": true }
```

**Notes:** Invited user receives auto-generated password (communicated out-of-band in production). "owner" role cannot be assigned via invite.

**Errors:**
| Status | Error | Reason |
|--------|-------|--------|
| 400 | "Cannot invite an owner" | Owner role reserved for registration |
| 403 | "User limit reached for your plan" | Plan limit exceeded |
| 409 | "User already exists" | Duplicate email |

### PUT /api/org/users/[id]
Change a user's role.

**Auth:** Required (admin+)

**Request:**
```json
{ "role": "admin" }
```

**Errors:**
| Status | Error | Reason |
|--------|-------|--------|
| 403 | "Only the owner can change the owner's role" | Admin cannot modify owner |
| 403 | "Only the owner can assign owner role" | Non-owner trying to create owner |
| 404 | "User not found" | Invalid user ID |

### DELETE /api/org/users/[id]
Remove a user from the organization.

**Auth:** Required (admin+)

**Errors:**
| Status | Error | Reason |
|--------|-------|--------|
| 400 | "Cannot delete yourself" | Self-deletion not allowed |
| 403 | "Cannot delete the organization owner" | Owner cannot be removed |
| 404 | "User not found" | Invalid user ID |

---

## Plans & Usage

### GET /api/plans
List available subscription plans. **Public** (no auth).

**Response:**
```json
[
  {
    "id": "starter",
    "name": "Starter",
    "price": 0,
    "sources": 3,
    "maxCrawls": 50,
    "records": 5000,
    "scheduledJobs": 0,
    "users": 2,
    "exports": 10,
    "features": ["basic-crawling"],
    "description": "For individuals and small evaluations"
  }
]
```

### GET /api/usage
Get current organization usage against plan limits.

**Auth:** Required

**Response:**
```json
{
  "usage": { "crawlsUsed": 12, "recordsCollected": 3400, "exportsGenerated": 3, "storageConsumed": 45, "lastUpdated": "..." },
  "plan": { "id": "starter", "sources": 3, "maxCrawls": 50, "records": 5000, "users": 2, "exports": 10 }
}
```

---

## Engine Proxy Routes

All engine routes require authentication (cookie/header/query param). They proxy to the Express engine.

### POST /api/crawl
Start a new crawl job.

**Request:**
```json
{
  "url": "https://example.com/classifieds",
  "depth": 3,
  "maxPages": 50
}
```

**Response:** Crawl job object from engine.

### GET /api/crawl/[id]
Get crawl job status and details.

**Response:** Crawl object `{ id, status, progress, url, stats, ... }`

### GET /api/crawl/[id]/records
Get paginated records from a completed crawl.

**Query params:** `page` (default 1), `limit` (default 50)

**Response:** `{ records: [...], total, page, limit }`

### GET /api/crawl/[id]/results
Get aggregated results from a completed crawl.

**Response:** Results object with site summary, field stats, etc.

### GET /api/crawl/[id]/export
Export crawl data as a file.

**Query params:** `format` (default "xlsx")

**Response:** Binary file download with appropriate Content-Type and Content-Disposition headers.

### POST /api/crawl/[id]/stop
Stop a running crawl job.

### GET /api/crawl/[id]/stream
SSE stream of crawl progress events.

**Response:** `text/event-stream`

### GET /api/events
Global SSE stream of all platform events (crawl start/complete, errors, etc.).

**Response:** `text/event-stream`

### GET /api/health
Engine health check.

**Response:**
```json
{ "status": "ok", "uptime": 12345 }
```

### GET /api/jobs
List all crawl jobs.

**Response:** Array of job objects.

### GET /api/reports
List all generated reports.

**Response:** Array of report objects.

### GET /api/reports/latest
Get the most recent report.

**Query params:** `site` (optional) — filter by site hostname

### GET /api/schedules
List all crawl schedules.

### POST /api/schedules
Create a new crawl schedule.

### PUT /api/schedules/[id]
Update a crawl schedule.

### DELETE /api/schedules/[id]
Delete a crawl schedule.

### PUT /api/schedules/[id]/toggle
Enable/disable a crawl schedule.

### GET /api/settings
Get engine configuration settings.

### PUT /api/settings
Update engine configuration settings.

### GET /api/sites
List all discovered sites.

### GET /api/sites/[hostname]
Get details for a specific site.

### GET /api/sites/[hostname]/discover
Trigger category/page discovery for a site. 30-second timeout.

---

## Error Codes

| Status | Meaning | Notes |
|--------|---------|-------|
| 200 | Success | — |
| 400 | Bad Request | Missing or invalid fields |
| 401 | Unauthorized | No valid session or token |
| 403 | Forbidden | Insufficient role permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate resource (e.g., email) |
| 500 | Internal Error | Server-side failure |
| 503 | Engine Unavailable | Express engine not running |

## Common Error Response Format
```json
{ "error": "Human-readable error message" }
```

Success responses vary by endpoint but generally return the requested resource directly.
