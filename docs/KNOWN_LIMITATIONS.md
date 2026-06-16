# Known Limitations — CSI-Ultimate v1.0-RC

---

## Cloudflare / Anti-Bot Protection

### Description
Some sites (expatriates.com intermittently, bayt.com consistently) serve Cloudflare Turnstile challenges on detail/listing pages.

### Impact
- **expatriates.com**: ~40% of detail pages fail extraction. Search works consistently. Full page discovery completes.
- **bayt.com**: Detail pages blocked entirely. Search returns results but extraction fails.

### Current Mitigations
- Browser automation (Playwright with stealth plugin)
- Retry handler (3 attempts with exponential backoff)
- Adaptive rate limiting reduces request frequency

### Future Work
- Cloudflare solver integration
- Playwright anti-detection improvements
- Rotating proxy support

---

## JS-Rendered Sites

### Description
The crawler uses Playwright (headless browser) to render JavaScript, but some sites with heavy dynamic loading or complex SPAs may not fully render by the standard wait time.

### Current Mitigations
- Extended wait time on slow pages
- Retry with full page reload
- Fallback to static HTML extraction

### Known Affected Sites
- None currently — all 7 configs work within acceptable limits

---

## Site-Specific Maintenance Expectations

| Site | Maintenance Need | Frequency |
|------|-----------------|-----------|
| expatriates.com | Update selectors if site redesign occurs | Monthly check |
| gumtree.com | `data-q` attribute selectors stable | Low maintenance |
| london.craigslist.org | Link classifier refinement | Low maintenance |
| olx.com.pk | URL template may change quarterly | Quarterly check |
| preloved.co.uk | Selectors stable | Low maintenance |
| bayt.com | Requires anti-bot bypass | Continuous |
| sa.opensooq.com | Site restructured — config refresh needed | One-time fix |

---

## Performance Limitations

### Large-Scale Crawls
- Single-process architecture — no horizontal scaling
- Sequential keyword processing within a single site run
- No distributed queue or worker farm

### Recommended Limits
| Resource | Recommended Max | Notes |
|----------|----------------|-------|
| Concurrent keywords | 5 | Beyond this, rate limiting becomes aggressive |
| Pages per session | 500 | Beyond this, memory usage climbs |
| Schedule interval | 1h minimum | Sub-hour intervals may overlap |
| Concurrent sites | 3 | Using shared browser pool |

### Memory
- **Idle**: ~80 MB
- **Single crawl (50 pages)**: ~250 MB
- **Large crawl (500 pages)**: ~800 MB
- **Leak potential**: Cache grows unbounded within a session; no automatic eviction

---

## Known Non-Limitations (Intentional Design Choices)

| Choice | Reason |
|--------|--------|
| No distributed mode | Out of scope for v1.0 — single-node is sufficient for classifieds-scale |
| No proxy rotation | Not needed for UK/GCC general classifieds; adds complexity |
| No Docker image | Node.js direct deployment is simpler; Docker available on request |
| No database backend | File-based storage sufficient for crawl volumes |
| No web UI | CLI-first for automation; dashboard is terminal-based |
