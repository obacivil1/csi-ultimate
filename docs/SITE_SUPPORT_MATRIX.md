# Site Support Matrix — CSI-Ultimate v1.0-RC

---

## Legend

| Stage | Icon | Definition |
|-------|------|------------|
| Search | 🔍 | Search by keyword returns listing pages |
| Discovery | 🧭 | Link discovery finds individual ad URLs |
| Extraction | 📄 | Ad data (title, price, etc.) extracted from detail page |
| Classification | 🏷️ | Page correctly classified (listing vs detail) |
| Export | 📦 | Data exported to Excel/JSON/CSV |

---

## Matrix

| Site | Search | Discovery | Extraction | Classification | Export | Notes |
|------|--------|-----------|------------|----------------|--------|-------|
| expatriates.com | ✅ | ✅ | ⚠️ | ✅ | ✅ | ~40% of detail pages trigger Cloudflare Turnstile. Page-level extraction fails intermittently. Search and discovery consistently work. |
| gumtree.com | ✅ | ✅ | ✅ | ✅ | ✅ | Full pipeline verified at 100% extraction rate. `data-q` selectors are stable. Best-performing site. |
| london.craigslist.org | ✅ | ✅ | ✅ | ✅ | ✅ | ~20% extraction efficiency — subcategory refine links mixed with ad URLs. Pipeline works correctly; link classifier needs refinement to distinguish ads from category links. |
| olx.com.pk | ✅ | ✅ | ✅ | ✅ | ✅ | Full pipeline verified. URL template pattern `{baseUrl}/items/q-{keyword}` works. |
| preloved.co.uk | ✅ | ✅ | ✅ | ✅ | ✅ | Full pipeline verified. Selectors stable. |
| bayt.com | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | Search returns results (279 links). Discovery partially works. Detail pages blocked by Cloudflare. Configured as jobs portal — listing pages may have different structure than classifieds. |
| sa.opensooq.com | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | Site structure changed. Requires config refresh. Previous validation showed full pipeline, but current state is unverified. Arabic-language site with RTL layout. |

---

## Detailed Site Profiles

### expatriates.com

| Property | Value |
|----------|-------|
| Hostname | expatriates.com |
| Search URL | `GET /scripts/search/search.epl?q={keyword}` |
| Page Param | `page` |
| Phone Region | GCC (966, 971, 973, 974, 965, 968) |
| Currencies | SAR, AED, KWD, QAR |
| Categories AutoDiscover | Enabled |
| Pagination Selector | `a[rel='next'], .next a, a.next, [class*='next'] a` |
| Extraction Selectors | title, description, phone, email, whatsapp, location, price, company, breadcrumb, date |
| Title Cleanup | expatriates.com |

### gumtree.com

| Property | Value |
|----------|-------|
| Hostname | gumtree.com |
| Search URL | `GET /search?q={keyword}` |
| Phone Region | UK (44) |
| Currencies | GBP, EUR, USD |
| Categories AutoDiscover | Disabled |
| Pagination Selector | `a[rel='next'], a.next, [class*='next'] a, [data-q='next']` |
| Extraction Selectors | title (`[data-q='vip-title']`), description, phone, email, location, price, company, breadcrumb, date |
| Title Cleanup | gumtree.com, Gumtree |

### london.craigslist.org

| Property | Value |
|----------|-------|
| Hostname | london.craigslist.org |
| Search URL | `GET /search/sss?query={keyword}` |
| Phone Region | UK (44) |
| Currencies | GBP, EUR, USD |
| Categories AutoDiscover | Disabled |
| Pagination Selector | Not specified (single-page listings) |
| Extraction Selectors | title, description, phone, email, location, price, company, breadcrumb, date |
| Title Cleanup | craigslist, for sale by owner, for sale |

### olx.com.pk

| Property | Value |
|----------|-------|
| Hostname | olx.com.pk |
| Search URL | `GET {baseUrl}/items/q-{keyword}` |
| Phone Region | PAKISTAN (92) |
| Currencies | PKR, USD |
| Categories AutoDiscover | Disabled |
| Pagination Selector | `a[rel='next'], a.next, [class*='next'] a` |
| Extraction Selectors | title, description, phone, email, whatsapp, location, price, company, breadcrumb, date |
| Ad ID Pattern | `-(\\d+)/?$` |
| Title Cleanup | olx.com.pk, OLX |

### preloved.co.uk

| Property | Value |
|----------|-------|
| Hostname | preloved.co.uk |
| Search URL | `GET /search?q={keyword}` |
| Phone Region | UK (44) |
| Currencies | GBP, EUR |
| Categories AutoDiscover | Disabled |
| Pagination Selector | Not specified |
| Extraction Selectors | title, description, phone, email, location, price, company, date |
| Ad ID Pattern | `/(\\d+)/` |
| Title Cleanup | Preloved, preloved.co.uk |

### bayt.com

| Property | Value |
|----------|-------|
| Hostname | bayt.com |
| Search URL | `GET /en/jobs/?q={keyword}` |
| Phone Region | MIDDLE_EAST (966, 971, 973, 974, 965, 968, 20, 962) |
| Currencies | SAR, AED, KWD, QAR, OMR, BHD, EGP, JOD |
| Categories AutoDiscover | Disabled |
| Pagination Selector | `a[rel='next'], a.next, [class*='next'] a` |
| Extraction Selectors | title, description, phone, email, whatsapp, location, price, company, breadcrumb, date |
| Ad ID Pattern | `/(\\d+)/$` |
| Title Cleanup | bayt.com |

### sa.opensooq.com

| Property | Value |
|----------|-------|
| Hostname | sa.opensooq.com |
| Search URL | `GET /ar/search?q={keyword}` |
| Phone Region | SAUDI_ARABIA (966, 971, 973, 974, 965, 968) |
| Currencies | SAR, AED, KWD, QAR, OMR, BHD, EGP, JOD, USD |
| Categories AutoDiscover | Disabled |
| Pagination Selector | `a[rel='next'], a.next, [class*='next'] a` |
| Extraction Selectors | title, description, phone, email, whatsapp, location, price, company, breadcrumb, date |
| Ad ID Pattern | `-(\\d+)$` |
| Title Cleanup | opensooq.com, السوق المفتوح |
