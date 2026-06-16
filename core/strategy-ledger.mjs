/**
 * strategy-ledger.mjs — Strategy State Persistence & Intelligence
 * ─────────────────────────────────────────────────────────────
 * The 'Source of Truth' for all strategy verification results.
 *
 * Persists to: state/strategy_ledger.json
 *
 * Responsibilities:
 *   - Record every Live-Verification result
 *   - Cache verified strategies per hostname
 *   - Track success/failure rates
 *   - Query: "Is there a verified Live-Strategy for this target?"
 *   - Detect success rate drops below threshold (80%)
 *
 * Tags: [[LEDGER]] [[LEDGER_WARN]] [[LEDGER_CRIT]]
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LEDGER_PATH = path.resolve(__dirname, "..", "state", "strategy_ledger.json")
const SUCCESS_RATE_THRESHOLD = 0.80
const MAX_HISTORY = 50

let ledgerCache = null

function getTimestamp() {
  return new Date().toISOString()
}

function log(tag, msg, meta) {
  const ts = getTimestamp().replace("T", " ").substring(0, 19)
  const extra = meta ? ` ${JSON.stringify(meta)}` : ""
  console.log(`[${ts}] [[${tag}]] ${msg}${extra}`)
}

// ── Read / Write ledger ───────────────────────────────────────

function readLedger() {
  if (ledgerCache) return ledgerCache
  try {
    if (fs.existsSync(LEDGER_PATH)) {
      const raw = fs.readFileSync(LEDGER_PATH, "utf-8")
      ledgerCache = JSON.parse(raw)
      return ledgerCache
    }
  } catch (e) {
    log("LEDGER_WARN", "Failed to read ledger, starting fresh", { error: e.message })
  }
  ledgerCache = {}
  return ledgerCache
}

function writeLedger() {
  try {
    const dir = path.dirname(LEDGER_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledgerCache, null, 2), "utf-8")
  } catch (e) {
    log("LEDGER_CRIT", "Failed to write ledger", { error: e.message })
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * getVerifiedStrategy — Query the ledger for a verified live-strategy.
 *
 * @param {string} hostname - Target hostname (e.g. "sa.indeed.com")
 * @returns {object|null} { strategy, identity, verifiedAt, stats } or null
 */
export function getVerifiedStrategy(hostname) {
  const ledger = readLedger()
  const entry = ledger[hostname]
  if (!entry) {
    log("LEDGER", `No verified strategy for "${hostname}"`)
    return null
  }
  if (!entry.verifiedStrategy) {
    log("LEDGER", `Hostname "${hostname}" exists but no verified strategy`)
    return null
  }
  log("LEDGER", `Found verified strategy for "${hostname}"`, {
    strategy: entry.verifiedStrategy,
    verifiedAt: entry.verifiedAt,
    successRate: entry.stats?.successRate,
  })
  return {
    strategy: entry.verifiedStrategy,
    identity: entry.identity || null,
    verifiedAt: entry.verifiedAt,
    stats: entry.stats,
  }
}

/**
 * recordCheck — Record a Live-Verification result in the ledger.
 *
 * @param {string}   hostname
 * @param {string}   strategyName - "A-Standard", "B-Proxy", "C-HeadedHuman"
 * @param {string}   result - "SUCCESS" | "BLOCKED" | "AUTH_FAIL" | "HARD_BAN" | "ERROR"
 * @param {object}   details - { fields, error, statusCode, fingerprintId, proxy }
 */
export function recordCheck(hostname, strategyName, result, details = {}) {
  const ledger = readLedger()
  if (!ledger[hostname]) {
    ledger[hostname] = {
      verifiedStrategy: null,
      verifiedAt: null,
      identity: null,
      stats: { totalChecks: 0, successful: 0, failed: 0, successRate: 0, lastCheck: null },
      history: [],
    }
  }

  const entry = ledger[hostname]
  entry.stats.totalChecks++
  entry.stats.lastCheck = getTimestamp()

  if (result === "SUCCESS") {
    entry.stats.successful++
    // Update verified strategy
    entry.verifiedStrategy = strategyName
    entry.verifiedAt = getTimestamp()
    // Lock identity if provided
    if (details.fingerprintId || details.proxy) {
      entry.identity = {
        fingerprintId: details.fingerprintId || entry.identity?.fingerprintId,
        proxy: details.proxy || entry.identity?.proxy,
        ua: details.ua || entry.identity?.ua,
      }
    }
    log("LEDGER", `Verified strategy="${strategyName}" for "${hostname}"`, {
      successRate: entry.stats.successRate,
      total: entry.stats.totalChecks,
    })
  } else {
    entry.stats.failed++
    if (result === "HARD_BAN") {
      log("LEDGER_CRIT", `HARD BAN detected for "${hostname}" via "${strategyName}"`, details)
    }
  }

  entry.stats.successRate = entry.stats.totalChecks > 0
    ? entry.stats.successful / entry.stats.totalChecks
    : 0

  // Add to history (ring buffer)
  entry.history.push({
    timestamp: getTimestamp(),
    strategy: strategyName,
    result,
    ...Object.fromEntries(Object.entries(details).filter(([k]) => !["fingerprintId", "proxy", "ua"].includes(k))),
  })
  if (entry.history.length > MAX_HISTORY) {
    entry.history = entry.history.slice(-MAX_HISTORY)
  }

  writeLedger()
  return entry.stats
}

/**
 * getSuccessRate — Get the current success rate for a hostname.
 *
 * @param {string} hostname
 * @returns {number} 0.0 – 1.0
 */
export function getSuccessRate(hostname) {
  const ledger = readLedger()
  const entry = ledger[hostname]
  if (!entry || !entry.stats) return 0
  return entry.stats.successRate || 0
}

/**
 * isBelowThreshold — Check if success rate is below the 80% threshold.
 *
 * @param {string} hostname
 * @returns {boolean} true if below threshold
 */
export function isBelowThreshold(hostname) {
  const rate = getSuccessRate(hostname)
  const below = rate < SUCCESS_RATE_THRESHOLD
  if (below && rate > 0) {
    log("LEDGER_WARN", `Success rate ${(rate * 100).toFixed(1)}% below threshold for "${hostname}"`)
  }
  return below
}

/**
 * getHistory — Get verification history for a hostname.
 *
 * @param {string} hostname
 * @param {number} limit - Max entries to return
 * @returns {array}
 */
export function getHistory(hostname, limit = 20) {
  const ledger = readLedger()
  const entry = ledger[hostname]
  if (!entry) return []
  return entry.history.slice(-limit)
}

/**
 * markHardBan — Record a hard-ban event and STOP further execution.
 *
 * @param {string} hostname
 * @param {string} strategyName
 * @param {object} details
 * @returns {object} { hardBan: true, hostname, message }
 */
export function markHardBan(hostname, strategyName, details = {}) {
  recordCheck(hostname, strategyName, "HARD_BAN", details)
  log("LEDGER_CRIT", `HARD BAN — All operations stopped for "${hostname}"`, {
    strategy: strategyName,
    ...details,
  })
  return { hardBan: true, hostname, message: `Hard ban detected for ${hostname} via ${strategyName}` }
}

/**
 * clearHostname — Reset ledger entry for a hostname (for re-evaluation).
 *
 * @param {string} hostname
 */
export function clearHostname(hostname) {
  const ledger = readLedger()
  delete ledger[hostname]
  writeLedger()
  log("LEDGER", `Cleared ledger entry for "${hostname}"`)
}

/**
 * getLedgerSummary — Get a summary of all entries in the ledger.
 *
 * @returns {object} hostname -> { verifiedStrategy, successRate, totalChecks }
 */
export function getLedgerSummary() {
  const ledger = readLedger()
  const summary = {}
  for (const [hostname, entry] of Object.entries(ledger)) {
    summary[hostname] = {
      verifiedStrategy: entry.verifiedStrategy,
      successRate: entry.stats?.successRate || 0,
      totalChecks: entry.stats?.totalChecks || 0,
      lastCheck: entry.stats?.lastCheck,
    }
  }
  return summary
}

export { SUCCESS_RATE_THRESHOLD }
