/**
 * extractor.mjs — Consolidated Extraction Gateway
 * ─────────────────────────────────────────────────────────────────
 * Merges the previously duplicated extraction paths:
 *   - CF/FlareSolverr protection gate  (from bridge.mjs)
 *   - single-pass DOM extraction       (from canonical-extractor.mjs)
 *   - improved currency detection      (SAR/ريال/ر.س)
 *
 * Legacy entry points `core/bridge.mjs` and `core/canonical-extractor.mjs`
 * keep working via re-export shims, but new code should import from here.
 */
import { env } from "../config/env.mjs"
import { extractFromFlareHtml } from "./flare-solver.mjs"
import {
  waitForCloudflare,
  runSearch,
  saveResults,
  sendAlert,
  deepExtraction,
  ErrorCodes,
  scanPageForLinks,
} from "./bridge.mjs"
import { extractAdData as canonicalExtract, detectCurrency } from "./canonical-extractor.mjs"

// ── Main consolidated extractor ─────────────────────────────────
export async function extractAdData(page, siteConfig) {
  const url = page.url()

  const contentReady = await waitForCloudflare(page, null, siteConfig)
  if (!contentReady) {
    const flare = await extractFromFlareHtml(url, siteConfig?.flare)
    if (flare) {
      return {
        id: String(url.match(/\/(\d{6,12})/)?.[1] || ""),
        title: flare.title,
        price: null,
        currency: null,
        phone: flare.phones?.join(", ") || "",
        email: flare.emails?.join(", ") || "",
        location: "",
        description: flare.description,
        url,
        extractedAt: new Date().toISOString(),
        source: "flaresolverr",
      }
    }
    throw new Error("BLOCKED_CF: ad page did not clear Cloudflare challenge (FlareSolverr unavailable)")
  }

  const data = await canonicalExtract(page, siteConfig)

  // Currency formatting pass — canonical omits SAR/AED when only text symbols present
  if (!data.currency) {
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || "").catch(() => "")
    data.currency = detectCurrency(bodyText)
  }
  return data
}

// ── Re-exports (backward-compatible surface) ───────────────────
export { waitForCloudflare, runSearch, saveResults, sendAlert, deepExtraction, scanPageForLinks }
export { ErrorCodes }

// Canonical utility surface
export {
  toCanonical,
  cleanPhone,
  cleanEmail,
  cleanPrice,
  isValidPhone,
  isAdId,
  normalizePhone,
  CANONICAL_KEYS,
  getSiteConfig,
  getEngineSites,
  loadCrawlRecords,
  listCrawlRecords,
  saveCrawlRecords,
  runCrawl,
  toCSV,
  exportToCSV,
  exportToXLSX,
  exportAll,
  loadCanonicalRecords,
} from "./canonical-extractor.mjs"

// Convenience alias for consumers that expect a default-like escape hatch
export { detectCurrency }
export default { extractAdData }