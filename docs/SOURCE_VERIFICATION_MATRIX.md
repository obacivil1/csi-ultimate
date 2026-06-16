# SOURCE VERIFICATION MATRIX

Generated: 2026-06-13

## Methodology
- Each accessible site: 3 independent crawls, up to 25 ads each
- Extraction via unified canonical extractor (`core/canonical-extractor.mjs`)
- Validation via `core/validation-engine.mjs`
- Screenshots in `state/verification/screenshots/`
- Exports: JSON, CSV, XLSX per run in `state/verification/`
- All metrics from real extraction — no estimates or simulations

## Matrix

| Site | Run1 | Run2 | Run3 | Records | Trust | Block Rate | Verdict |
|------|------|------|------|---------|-------|------------|---------|
| gumtree.com              | OK   | —    | —    | 25      | 62    | 0   % | PARTIALLY VERIFIED |
| london.craigslist.org    | OK   | OK   | OK   | 75      | 67    | 0   % | PARTIALLY VERIFIED |
| preloved.co.uk           | OK   | OK   | OK   | 60      | 66    | 0   % | PARTIALLY VERIFIED |
| sa.opensooq.com          | OK   | —    | —    | 18      | 27    | 0   % | PARTIALLY VERIFIED |
| bayt.com                 | BLOCKED | BLOCKED | BLOCKED | 0       | N/A   | 100 % | BLOCKED |
| olx.com.pk               | BLOCKED | BLOCKED | BLOCKED | 0       | N/A   | 100 % | BLOCKED |

## Field Accuracy Per Site

| Site | Title | Price | Phone | Email | Location | Currency | Overall |
|------|-------|-------|-------|-------|----------|----------|---------|
| gumtree.com              | 100% | 24 % | 80 % | 0  % | 100% | 28 % | 55 % |
| london.craigslist.org    | 100% | 100% | 0  % | 0  % | 100% | 100% | 67 % |
| preloved.co.uk           | 100% | 95 % | 0  % | 0  % | 100% | 100% | 66 % |
| sa.opensooq.com          | 100% | 0  % | 0  % | 17 % | 0  % | 0  % | 20 % |
| bayt.com                 | 0  % | 0  % | 0  % | 0  % | 0  % | 0  % | 0  % |
| olx.com.pk               | 0  % | 0  % | 0  % | 0  % | 0  % | 0  % | 0  % |

## Duplicate Analysis

| Site | Exact Dups | Near Dups | Unique | Duplicate Rate |
|------|------------|-----------|--------|----------------|
| gumtree.com              | 0          | 15        | 25     | 60    % |
| london.craigslist.org    | 50         | 0         | 25     | 67    % |
| preloved.co.uk           | 40         | 0         | 20     | 67    % |
| sa.opensooq.com          | 10         | 0         | 8      | 56    % |
| bayt.com                 | 0          | 0         | 0      | 0     % |
| olx.com.pk               | 0          | 0         | 0      | 0     % |

## Certification Gate Check

| Requirement | gumtree.com | craigslist.org | preloved.co.uk | opensooq.com | bayt.com | olx.com.pk |
|-------------|-------------|----------------|----------------|--------------|----------|------------|
| totalRecords >= 100            | ❌           | ❌              | ❌              | ❌            | ❌        | ❌          |
| 3 successful runs              | ❌           | ✅              | ✅              | ❌            | N/A      | N/A        |
| block rate < 30%               | ✅           | ✅              | ✅              | ✅            | ❌        | ❌          |
| trust score > 60               | ✅           | ✅              | ✅              | ❌            | ❌        | ❌          |
| exports verified               | ✅           | ✅              | ✅              | ✅            | ❌        | ❌          |
| evidence URLs verified         | ✅           | ✅              | ✅              | ✅            | ❌        | ❌          |

## Verdict Key

- **CERTIFIED**: meets all certification gates (100+ records, 3 runs, <30% block, trust >60, exports + evidence verified)
- **PARTIALLY VERIFIED**: accessible and producing records but does not meet all certification gates
- **BLOCKED**: Cloudflare / anti-bot prevents any extraction
- **FAILED**: extraction attempted but no usable records

## Certification Summary

**No site meets all certification gates.** The primary blocker is the ≥100 record requirement — no single site provides 100+ clean classifieds records with our current approach. gumtree.com is closest (25 records, trust 62) but falls short on volume.

## Evidence

- Extraction records: `state/verification/{site}_run*.json`
- Screenshots: `state/verification/screenshots/*.png`
- Exports: JSON, CSV, XLSX per run in `state/verification/`
