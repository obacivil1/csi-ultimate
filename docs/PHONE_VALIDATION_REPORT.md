# Phone Validation Report

## Summary

| Metric | Before | After | Delta |
|---|---|---|---|
| Phone coverage (engine claim) | 100% (25/25) | — | — |
| Real UK phones (validated) | 76% (19/25) | 80% (20/25) | +4% |
| Ad ID garbage (false positives) | 20% (5/25) | 0% (0/25) | −20% |
| Ambiguous/unclassified | 4% (1/25) | — | — |

## Validation Rules Applied

1. **UK mobile format**: Must match `07` + 9 digits (11 total). Also accepts `+447...` and `447...` formats.
2. **Ad ID rejection**: If the phone number matches the URL's last path segment (the Gumtree ad ID), it is rejected.
3. **Identifier rejection**: If the number starts with a non-zero digit and is 7-11 digits without a leading 0, it is rejected (classic ad-ID pattern `54184XXXXX`).
4. **Length bounds**: Minimum 11 digits after stripping formatting. Maximum 15.

## False Positives Removed

| Record Title | Raw Phone | URL Ad ID | Reason |
|---|---|---|---|
| Chefs - Aylesbury... | 5418479659 | 5418479659 | Matches URL path segment |
| Live In Carers Needed... | 5418484761 | 5418484761 | Matches URL path segment |
| Cleaner Full-Time... | 5418451751 | 5418451751 | Matches URL path segment |
| Live in Carer... | 5418480683 | 5418480683 | Matches URL path segment |
| Community Fundraiser... | 5418447119 | 5418447119 | Matches URL path segment |

These 5 records previously inflated phone coverage to 100%. After validation, real phone coverage is 80% (20/25).

## Per-Record Detail

| Title | Raw Phone | Normalized | Status |
|---|---|---|---|
| Chefs - Aylesbury... | 5418479659 | 5418479659 | AD_ID — rejected |
| Live In Carers Needed... | 5418484761 | 5418484761 | AD_ID — rejected |
| Cleaner Full-Time... | 5418451751 | 5418451751 | AD_ID — rejected |
| Live in Carer Earn up to £4,100... | 5418480683 | 5418480683 | AD_ID — rejected |
| Community Fundraiser... | 5418447119 | 5418447119 | AD_ID — rejected |
| Volunteer Office Role (×15) | 07861874524 | 07861874524 | VALID |
| Cash In Hand / Student Jobs (×2) | 07427748080 | 07427748080 | VALID |
| Brand Ambassador | 07427248400 | 07427248400 | VALID |
| START NOW Cash In Hand | 07915002334 | 07915002334 | VALID |
| Brand Ambassador | 075146443659 | 07514644365 | VALID (truncated 12→11 digits) |

## Impact on Derived Metrics

| Metric | Before (contaminated) | After (cleaned) |
|---|---|---|
| Phone coverage | 100% | 80% |
| Field accuracy (unweighted avg) | 61% | 57% |
| High-value records (phone+price+location) | 10 | 5 |
| Duplicate phone groups | 2 groups (15+2) | 2 groups (15+2) — unchanged (ad IDs were unique, not in groups) |
| Trust score field-accuracy component | 40% of 61 = 24.4 | 40% of 57 = 22.8 |

The duplicate detection is unaffected because the 5 ad-ID records each had unique numbers (no duplicates among them). The trust score drops ~2 points due to lower field accuracy.
