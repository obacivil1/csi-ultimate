# Operations Runbook — CSI-Ultimate v1.0-RC

---

## Scheduler Operations

### Creating a Scheduled Job

```bash
node csi-crawler-v9.mjs --url https://www.expatriates.com --search "engineer" --schedule 1h
```

The `--schedule` flag accepts:
- `1h` — every hour
- `30m` — every 30 minutes
- `2h` — every 2 hours
- `6h` — every 6 hours
- `24h` — daily

### Viewing Scheduled Jobs

```bash
node csi-crawler-v9.mjs --url https://www.expatriates.com --status
```

Output shows:
- Job ID (site + timestamp)
- Schedule interval
- Status (active/completed/failed)
- Last run at
- Next run at
- Run count

### Job Persistence

Jobs are stored in `.crawl-scheduler.json` in the project root. This file is auto-created and persists across restarts. The scheduler checks for due jobs on startup and executes any that are overdue.

### Removing a Scheduled Job

Delete the entry from `.crawl-scheduler.json` or remove the file entirely to clear all jobs.

### Scheduler Behaviour

- Due jobs execute immediately on startup
- After execution, `nextRunAt` is computed from `lastRunAt + interval`
- Failed jobs are rescheduled on a 5-minute cooldown
- Max 5 consecutive failures before a job is paused

---

## Queue Operations

### Architecture

The `WorkerQueue` (`core/queue.mjs`) manages concurrent crawl tasks:

- **Default concurrency**: 2 tasks
- **Isolated failures**: One failed task does not affect others
- **Drain detection**: Queue emits `drain` event when all tasks complete
- **Timeout per task**: Inherits from page timeout (default 30s)

### Monitoring

Queue activity is visible in the live dashboard during a crawl:

```
Queue: [##------] 2/10 active  |  Tasks: 15 completed, 0 failed
```

### Tuning Concurrency

```bash
node csi-crawler-v9.mjs --url <URL> --search "<keyword>" --concurrency 5
```

Increase for faster crawls on responsive sites. Decrease for fragile sites.

---

## Cache Management

### Cache Architecture

Two cache instances in `core/cache.mjs`:

| Cache | Key | Value | Purpose |
|-------|-----|-------|---------|
| `adCache` | Ad URL | Ad data | Avoid re-extracting seen ads |
| `pageCache` | Page URL | Page HTML | Avoid re-fetching seen pages |

### Clear Cache

Cache is in-memory only. It is cleared automatically when the Node process restarts.

To force-clear within a session: not supported currently. Restart the process.

### Cache Behaviour

- Cache keys are normalised URLs (lowercased, trailing slash stripped)
- No TTL — cache lives for the duration of the process
- No auto-eviction — large sessions may accumulate cache entries

---

## Export Management

### Export Formats

| Format | File Extension | Output Location |
|--------|---------------|-----------------|
| Excel | `.xlsx` | `output/crawl_<timestamp>_<site>.xlsx` |
| JSON | `.json` | `output/crawl_<timestamp>_<site>.json` |
| CSV | `.csv` | `output/crawl_<timestamp>_<site>.csv` |

### Export Contents

Each export includes:

| Column | Source |
|--------|--------|
| Title | Extracted from detail page |
| Price | Extracted using price selector |
| Location | Extracted using location selector |
| Description | Extracted from detail page |
| Phone | Extracted from tel: links |
| Email | Extracted from mailto: links |
| URL | Source URL of the ad |
| Site | Site hostname |
| Crawled At | ISO timestamp of extraction |

### Manual Export from Session Report

Session reports are saved to `output/reports/` as JSON. They contain the full crawl data and can be re-exported manually.

### Large Export Handling

For crawls exceeding 500 records, Excel export uses streaming writes. CSV is recommended for very large datasets.

---

## Failure Recovery Procedures

### Recovery Layers

| Layer | Mechanism | Location | Recovery Time |
|-------|-----------|----------|---------------|
| 1. Retry | Exponential backoff (3 attempts) | `core/rate-limiter.mjs` | ~15s |
| 2. Queue Isolation | Failed task removed; queue continues | `core/queue.mjs` | Immediate |
| 3. Browser Pool | Crash recovery with new context | `core/browser-pool.mjs` | ~5s |
| 4. Scheduler Resumption | Failed job rescheduled on 5-min cooldown | `core/scheduler.mjs` | ~5min |

### Common Failure Scenarios

#### Scenario A: Page fails to load

```
Symptom: Dashboard shows "Page returned null — skipping"
Action: None required — retry handler fires automatically
Resolution: After 3 retries, page is skipped with null logged
```

#### Scenario B: Browser crash

```
Symptom: Dashboard shows "Browser context crashed — recovering"
Action: None required — pool creates new context automatically
Resolution: Crawl resumes from queue; no data loss
```

#### Scenario C: All pages returning null

```
Symptom: Crawl completes with 0 ads exported
Action:
1. Run probe: node csi-crawler-v9.mjs --probe <URL>
2. Check site structure: manually visit a listing page
3. If selectors changed, update config/sites/<site>.json
```

#### Scenario D: Scheduler job stuck in "running" state

```
Symptom: --status shows job running indefinitely
Action:
1. Check .crawl-scheduler.json
2. If stale: set status to "failed" manually
3. Restart process to trigger re-evaluation
```

#### Scenario E: Process crash during crawl

```
Symptom: Abrupt termination
Action: Restart with same command
Impact: In-progress exports are lost; queued URLs are not persisted
```

---

## Monitoring Recommendations

### What to Watch

| Signal | Where | Threshold |
|--------|-------|-----------|
| Extraction rate | Dashboard / output | < 50% indicates selector issue |
| Null pages | Dashboard | > 20% consecutive nulls |
| Browser crashes | Dashboard / console | > 3 in 5 minutes |
| Queue backlog | Dashboard | Growing faster than processed |
| Failure count | Console log | > 10 consecutive |

### Health Check Commands

```bash
# Quick smoke test
node csi-crawler-v9.mjs --test

# Live site validation
node csi-crawler-v9.mjs --test-live

# Site probe
node csi-crawler-v9.mjs --probe https://www.expatriates.com

# Check scheduler
Get-Content -LiteralPath .crawl-scheduler.json
```

### Logging

- All crawl activity is logged to console with timestamps
- Session reports in `output/reports/` contain full decision history
- No persistent log files currently — pipe console output to a file:

```bash
node csi-crawler-v9.mjs --url https://www.expatriates.com --search "driver" *>&1 | Tee-Object -LiteralPath "crawl.log"
```

### Backup Recommendations

- Back up `config/sites/` after any selector changes
- Back up `.crawl-scheduler.json` regularly for job continuity
- Export output data to a separate storage location after each crawl session
