/**
 * sustainable-agent.mjs — Autonomous Sustainable Crawling Agent
 * ─────────────────────────────────────────────────────────────
 * Wraps the existing pipeline with:
 *   1) IntelligentRetryLoop — A→B→C→D→E escalation + exponential backoff
 *   2) VerificationMatrix   — Post-extraction quality scoring
 *   3) SelfHealingSystem    — Auto-rotate targets, restart context
 *   4) SilentMode           — Save immediately, no UI disruption
 *
 * Tags: [[SUSTAINABLE]] [[VERIFY]] [[HEAL]] [[RETRY]] [[SAVE]]
 *       [[ROTATE]] [[RESTART]] [[EXHAUSTED]]
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

import { createStrategyBrowser, closeStrategyBrowser, executeWithStrategy, Jitter } from "./strategy-engine.mjs"
import { recordCheck, getVerifiedStrategy, getSuccessRate, markHardBan, getLedgerSummary } from "./strategy-ledger.mjs"
import { extractAdData, deepExtraction } from "./bridge.mjs"
import { discoverLinks } from "./discovery-engine.mjs"
import { runInteractionPipeline } from "./interaction-engine.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, "..", "data")
const STATE_DIR = path.resolve(__dirname, "..", "state")
const SITES_PATH = path.resolve(__dirname, "..", "state", "sites.json")

// ── Logging ─────────────────────────────────────────────────────
function ts() { return new Date().toISOString().replace("T", " ").substring(0, 19) }
function log(tag, msg, meta) {
  const extra = meta ? ` ${JSON.stringify(meta)}` : ""
  console.log(`[${ts()}] [[${tag}]] ${msg}${extra}`)
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT 1 — Verification Matrix
// ═══════════════════════════════════════════════════════════════
// Scores extracted data on content quality.
//   phone=40, email=30, title=15, description=10, price=5
//   PASS >= 50, FAIL < 50
const V_SCORE = { phone: 40, email: 30, title: 15, description: 10, price: 5 }

function verifyExtraction(data, hostname) {
  if (!data) return { valid: false, score: 0, reason: "no data" }

  function _looksLikePhone(num) {
    const digits = num.replace(/\D/g, "")
    if (digits.length < 9 || digits.length > 15) return false
    if (/^(\d)\1{7,}$/.test(digits)) return false
    if (/^\+/.test(num)) return true
    if (/^05\d{8,}$/.test(digits)) return true
    if (/^0[0-9]\d{7,}$/.test(digits)) return true
    if (/^9665\d{8,}$/.test(digits)) return true
    return false
  }

  let score = 0
  const found = []

  if (data.phone) {
    if (_looksLikePhone(data.phone)) {
      score += V_SCORE.phone
      found.push("phone")
    }
  }
  if (data.email) {
    if (/@/.test(data.email) && !/noreply|no-reply|example\.com/i.test(data.email)) {
      score += V_SCORE.email
      found.push("email")
    }
  }
  if (data.title) {
    const isHostname = data.title === hostname || data.title.startsWith("www.")
    if (!isHostname && data.title.length > 3) {
      score += V_SCORE.title
      found.push("title")
    }
  }
  if (data.description && data.description.length > 50) {
    score += V_SCORE.description
    found.push("description")
  }
  if (data.price) {
    score += V_SCORE.price
    found.push("price")
  }

  const valid = score >= 50
  log("VERIFY", `score=${score} valid=${valid} found=[${found.join(",")}] hostname=${hostname}`)
  return { valid, score, found, missing: Object.keys(V_SCORE).filter(k => !found.includes(k)) }
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT 2 — Intelligent Retry Loop
// ═══════════════════════════════════════════════════════════════
// Wraps a strategy function with exponential backoff.
// After exhaustion, escalates to the next strategy.
//   delay(n) = 2^n seconds + jitter(0-3s)

function backoffMs(attempt) {
  return Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 3000)
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT 3 — Self-Healing System
// ═══════════════════════════════════════════════════════════════

const HEAL_THRESHOLD = 10  // consecutive failures before restart

// ═══════════════════════════════════════════════════════════════
// AGENT CLASS
// ═══════════════════════════════════════════════════════════════

export class SustainableAgent {
  constructor(opts = {}) {
    this.browser = null
    this.consecutiveFailures = 0
    this.totalExtracted = 0
    this.totalAttempts = 0
    this.results = []
    this.failedHostnames = []
    this.startTime = Date.now()
    this.running = false
    this.maxRetriesPerStrategy = opts.maxRetriesPerStrategy || 3
    this.qualityThreshold = opts.qualityThreshold || 50
  }

  /**
   * Load sites from sites.json
   */
  loadSites() {
    if (!fs.existsSync(SITES_PATH)) {
      log("SUSTAINABLE", "sites.json not found", { path: SITES_PATH })
      return []
    }
    return JSON.parse(fs.readFileSync(SITES_PATH, "utf-8"))
  }

  /**
   * Main entry – run sustainable crawl against given targets.
   * targets: array of { hostname, categoryName } or category objects.
   * If empty, reads all hostnames + first category from sites.json.
   */
  async run(targets = []) {
    this.running = true
    this.startTime = Date.now()

    // Resolve targets
    if (targets.length === 0) {
      const sites = this.loadSites()
      // Skip Indeed (blocked) and include known-working sites
      const blockedHostnames = ["sa.indeed.com", "sa.linkedin.com", "jadarat.sa", "taqat.sa"]
      const workingSites = sites.filter(s => !blockedHostnames.includes(s.hostname))
      for (const site of workingSites) {
        const cats = site.categories || []
        for (const cat of cats) {
          targets.push({ hostname: site.hostname, category: cat, siteConfig: site })
        }
      }
      // Limit to reasonable batch
      targets = targets.slice(0, 20)
    }

    log("SUSTAINABLE", `Starting Sustainable Agent`, {
      targets: targets.length,
      qualityThreshold: this.qualityThreshold,
      maxRetries: this.maxRetriesPerStrategy,
    })

    // Launch browser once (reused across targets, healed on failure)
    this.browser = await createStrategyBrowser()

    // ── Main Target Loop ──────────────────────────────────────
    let targetIndex = 0
    const rotationCount = { current: 0, max: 3 }

    while (this.running && targetIndex < targets.length) {
      const target = targets[targetIndex]
      const hostname = target.hostname
      // Resolve category from target or sites config
      let activeCategory = target.category
      if (!activeCategory) {
        const cfg = target.siteConfig || this._findSiteConfig(hostname)
        activeCategory = cfg?.categories?.[0] || { name: "default", url: "", selector: "a[href]" }
        target.category = activeCategory
      }
      const categoryName = activeCategory.name || "default"

      // Skip if this hostname was already failed
      if (this.failedHostnames.includes(hostname)) {
        log("SUSTAINABLE", `Skipping failed hostname`, { hostname })
        targetIndex++
        continue
      }

      log("SUSTAINABLE", `Processing target`, { hostname, category: categoryName, index: targetIndex + 1 })

      // Check ledged for verified strategy
      const ledgerEntry = getVerifiedStrategy(hostname)
      const preferredStrategy = ledgerEntry?.strategy || null

      // ── Process this target ────────────────────────────────
      let targetSuccess = false

      try {
        // Phase 1: Discover links
        const links = await this._discoverLinks(target, preferredStrategy)
        if (links.length === 0) {
          log("SUSTAINABLE", `No links found for target`, { hostname, category: categoryName })
          this.failedHostnames.push(hostname)
          targetIndex++
          this.consecutiveFailures++
          await this._healIfNeeded()
          continue
        }

        // Phase 2: Extract from each link
        for (const link of links) {
          if (!this.running) break
          this.totalAttempts++

          const data = await this._extractWithEscalation(target, link.url, preferredStrategy)

          if (data) {
            const quality = verifyExtraction(data, hostname)
            if (quality.valid) {
              this.totalExtracted++
              this.consecutiveFailures = 0
              targetSuccess = true
              await this._saveResult(data, hostname, link.url)
            } else if (quality.score >= 20) {
              // Partial data still worth saving
              this.totalExtracted++
              this.consecutiveFailures = 0
              log("SUSTAINABLE", `Partial quality, saving anyway`, { score: quality.score, hostname })
              await this._saveResult(data, hostname, link.url)
            } else {
              this.consecutiveFailures++
              log("SUSTAINABLE", `Low quality extraction`, { score: quality.score, hostname })
              await this._healIfNeeded()
            }
          } else {
            this.consecutiveFailures++
            log("SUSTAINABLE", `Extraction returned null`, { url: link.url?.substring(0, 50) })
            await this._healIfNeeded()
          }
        }
      } catch (e) {
        log("SUSTAINABLE", `Target failed with exception`, { hostname, error: e.message?.substring(0, 80) })
        this.consecutiveFailures++
        this.failedHostnames.push(hostname)
        await this._healIfNeeded()
      }

      if (!targetSuccess) {
        this.failedHostnames.push(hostname)
        log("SUSTAINABLE", `Target marked as failed`, { hostname })
      }

      targetIndex++

      // Jitter between targets
      await Jitter.delay(5000, 15000)
    }

    // ── Done ──────────────────────────────────────────────────
    await closeStrategyBrowser(this.browser)
    this.running = false

    const elapsed = Math.round((Date.now() - this.startTime) / 1000)
    log("SUSTAINABLE", `Agent complete`, {
      extracted: this.totalExtracted,
      attempts: this.totalAttempts,
      elapsed: `${elapsed}s`,
      savedFiles: this.results.length,
    })

    return {
      results: this.results,
      totalExtracted: this.totalExtracted,
      totalAttempts: this.totalAttempts,
      elapsed,
      failedHostnames: this.failedHostnames,
    }
  }

  /**
   * Stop the agent gracefully.
   */
  stop() {
    this.running = false
    log("SUSTAINABLE", "Stop signal received")
  }

  // ── Internal: Discover Links ──────────────────────────────────

  async _discoverLinks(target, preferredStrategy) {
    const { hostname, category, siteConfig } = target
    const cfg = siteConfig || this._findSiteConfig(hostname)

    if (!cfg) {
      log("SUSTAINABLE", `No site config for ${hostname}`)
      return []
    }

    // If no category provided, use the first category from sites config
    const activeCategory = category || cfg.categories?.[0]
    if (!activeCategory) {
      log("SUSTAINABLE", `No category available for ${hostname}`)
      return []
    }

    try {
      // Use a clean page for discovery (stealth headers can trigger anti-bot on some sites)
      const page = await this.browser.newPage()
      await page.setDefaultTimeout(30000)

      try {
        const links = []
        // Navigate to the category page
        try {
          await page.goto(activeCategory.url, { waitUntil: "networkidle", timeout: 45000 })
        } catch (e) {
          log("SUSTAINABLE", `Category page failed`, { url: activeCategory.url?.substring(0, 50), error: e.message?.substring(0, 60) })
          return []
        }
        // Wait for content to render
        await Jitter.delay(3000, 6000)

        // Use scanPageForLinks or selector
        const selector = activeCategory.selector || cfg.selectors?.listing || "a[href]"
        let linksFromPage = await page.$$eval(selector, els =>
          els.map(el => el.href || el.closest("a")?.href).filter(Boolean)
        ).catch(() => [])

        if (linksFromPage.length === 0) {
          const { scanPageForLinks } = await import("./bridge.mjs")
          linksFromPage = await scanPageForLinks(page, cfg.extraScanPatterns || [])
        }

        // Deduplicate and limit
        const seen = new Set()
        for (const url of linksFromPage) {
          if (seen.has(url)) continue
          seen.add(url)
          links.push({ url, index: links.length + 1 })
          if (links.length >= 25) break
        }

        log("SUSTAINABLE", `Discovered ${links.length} links`, { hostname, category: activeCategory.name })
        return links
      } finally {
        await page.close().catch(() => {})
      }
    } catch (e) {
      log("SUSTAINABLE", `Discovery error`, { hostname, error: e.message?.substring(0, 60) })
      return []
    }
  }

  /**
   * Find site config from sites.json by hostname.
   */
  _findSiteConfig(hostname) {
    const sites = this.loadSites()
    return sites.find(s => s.hostname === hostname) || null
  }

  // ── Internal: Extract with Escalation ─────────────────────────

  async _extractWithEscalation(target, url, preferredStrategy) {
    const { hostname, siteConfig } = target
    const cfg = siteConfig || this._findSiteConfig(hostname)
    if (!cfg) return null

    try {
      // Use the existing strategy engine with enhancement
      const data = await executeWithStrategy(this.browser, url, cfg, url.split("/").pop() || "ad", {
        extractAdData,
        deepExtraction,
      }, {
        hostname,
        preferredStrategy,
      })

      if (data) {
        recordCheck(hostname, preferredStrategy || "A-Standard", "SUCCESS", {
          fields: Object.keys(data).filter(k => data[k]).length,
        })
      }

      return data
    } catch (e) {
      log("SUSTAINABLE", `All strategies exhausted for URL`, {
        url: url?.substring(0, 50),
        error: e.message?.substring(0, 80),
      })
      return null
    }
  }

  // ── Internal: Heal on Failure ─────────────────────────────────

  async _healIfNeeded() {
    if (this.consecutiveFailures >= HEAL_THRESHOLD) {
      log("HEAL", `Threshold reached (${this.consecutiveFailures} failures), restarting browser`)
      try {
        await closeStrategyBrowser(this.browser)
      } catch {}
      await Jitter.delay(10000, 20000)
      this.browser = await createStrategyBrowser()
      this.consecutiveFailures = 0
      log("HEAL", "Browser restarted successfully")
    }
  }

  // ── Internal: Save Result ─────────────────────────────────────

  async _saveResult(data, hostname, url) {
    const record = {
      ...data,
      url,
      hostname,
      extractedAt: new Date().toISOString(),
    }

    this.results.push(record)

    // Silent save — write immediately, no console.clear/UI
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)
    const safeHostname = hostname.replace(/[^a-z0-9]/g, "_")
    const filePath = path.join(DATA_DIR, `${safeHostname}_${timestamp}.json`)

    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
      // Append to batch file (overwrite each time for the latest snapshot)
      const batchPath = path.join(DATA_DIR, `${safeHostname}_sustainable.json`)
      let batch = []
      if (fs.existsSync(batchPath)) {
        try { batch = JSON.parse(fs.readFileSync(batchPath, "utf-8")) } catch { batch = [] }
      }
      batch.push(record)
      fs.writeFileSync(batchPath, JSON.stringify(batch, null, 2), "utf-8")
      log("SAVE", `Saved result #${this.results.length}`, { hostname, file: path.basename(batchPath) })
    } catch (e) {
      log("SUSTAINABLE", `Save failed`, { error: e.message })
    }
  }
}

// ── CLI Entry ───────────────────────────────────────────────────

export async function runSustainableCli(targets) {
  const agent = new SustainableAgent()
  const result = await agent.run(targets)
  return result
}
