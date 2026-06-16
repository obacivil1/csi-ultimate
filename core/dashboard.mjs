/**
 * dashboard.mjs — Terminal Visualizer (Live ASCII Dashboard)
 * ─────────────────────────────────────────────────────────
 * Polls checkHealth() + resource controller stats every 2s
 * and renders a clean, live-updating dashboard via console.clear().
 *
 * Usage:
 *   import { startDashboard, updatePipelineStats } from "./dashboard.mjs"
 *   const stop = startDashboard()      // begins 2s loop
 *   updatePipelineStats({ success: 5, failed: 1, blocked: 0, coverage: 82 })
 *   stop()                             // clears interval
 */

import { checkHealth, limiterSummary, breakerSummary } from "./resource-controller.mjs"

// ── Colors ─────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgGray: "\x1b[100m",
  clear: "\x1b[2J\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
}

// ── Pipeline stats accumulator ─────────────────────────────────
const _pipeline = {
  totalAttempts: 0,
  totalSuccess: 0,
  totalFailed: 0,
  totalBlocked: 0,
  totalSkipped: 0,
  totalAds: 0,
  fieldsPresent: 0,
  fieldsTotal: 0,
  jobStart: Date.now(),
  errors: [],
}

export function updatePipelineStats(stats) {
  if (stats.type === "ad") {
    _pipeline.totalAttempts++
    _pipeline.totalSuccess++
    _pipeline.totalAds = stats.index || (_pipeline.totalAds + 1)
  } else if (stats.type === "skip") {
    _pipeline.totalAttempts++
    _pipeline.totalSkipped++
    if (stats.reason === "error") _pipeline.totalFailed++
  } else if (stats.type === "blocked") {
    _pipeline.totalAttempts++
    _pipeline.totalBlocked++
  } else if (stats.type === "batch") {
    if (stats.fieldsPresent !== undefined) _pipeline.fieldsPresent = stats.fieldsPresent
    if (stats.fieldsTotal !== undefined) _pipeline.fieldsTotal = stats.fieldsTotal
  } else if (stats.type === "error") {
    _pipeline.errors.push(stats.message)
    if (_pipeline.errors.length > 50) _pipeline.errors.shift()
  }
}

export function resetPipelineStats() {
  _pipeline.totalAttempts = 0
  _pipeline.totalSuccess = 0
  _pipeline.totalFailed = 0
  _pipeline.totalBlocked = 0
  _pipeline.totalSkipped = 0
  _pipeline.totalAds = 0
  _pipeline.fieldsPresent = 0
  _pipeline.fieldsTotal = 0
  _pipeline.jobStart = Date.now()
  _pipeline.errors = []
}

// ── Bar renderer ───────────────────────────────────────────────
const BAR_WIDTH = 16

function bar(value, max, color) {
  const pct = Math.min(value / max, 1)
  const filled = Math.round(pct * BAR_WIDTH)
  const empty = BAR_WIDTH - filled
  const bg = color || C.green
  return `${bg}${"█".repeat(filled)}${C.dim}${"░".repeat(empty)}${C.reset}`
}

function labelBar(label, value, max, unit, warnAt, critAt) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  let color = C.green
  const numVal = typeof value === "number" ? value : parseFloat(value) || 0
  if (critAt !== undefined && numVal >= critAt) color = C.red
  else if (warnAt !== undefined && numVal >= warnAt) color = C.yellow
  const b = bar(value, max, color)
  const valStr = unit ? `${numVal}${unit}`.padEnd(8) : `${pct}%`.padEnd(8)
  return `  ${(label + ":").padEnd(18)} ${b}  ${C.bold}${valStr}${C.reset}`
}

function pctBar(label, pct) {
  const p = Math.min(Math.max(pct || 0, 0), 100)
  const color = p >= 80 ? C.green : p >= 50 ? C.yellow : C.red
  const b = bar(p, 100, color)
  return `  ${(label + ":").padEnd(18)} ${b}  ${C.bold}${p}%${C.reset}`
}

// ── Dashboard render ───────────────────────────────────────────
function box(content, width = 58) {
  const top = `┌${"─".repeat(width)}┐`
  const bot = `└${"─".repeat(width)}┘`
  const lines = [top]
  for (const line of content) {
    const padded = (line + "").padEnd(width)
    lines.push(`│${padded}│`)
  }
  lines.push(bot)
  return lines.join("\n")
}

function statusBadge(status) {
  if (status === "HEALTHY") return `${C.bgGreen}${C.bold} HEALTHY ${C.reset}`
  if (status === "WARN") return `${C.bgYellow}${C.bold}  WARN  ${C.reset}`
  if (status === "AT_RISK") return `${C.bgRed}${C.bold} AT_RISK ${C.reset}`
  return status
}

function elapsedStr(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ${s % 60}s`
}

// ── Main render function ───────────────────────────────────────
let _lastRender = ""
let _semaphoreRef = null
let _renderCount = 0

export function setSemaphoreRef(sem) { _semaphoreRef = sem }

export async function renderDashboard() {
  _renderCount++
  const health = await checkHealth({ measureEventLoop: true })
  const limiters = limiterSummary()
  const breakers = breakerSummary()

  const now = new Date()
  const timeStr = now.toLocaleTimeString("en-GB", { hour12: false })
  const dateStr = now.toISOString().substring(0, 10)

  const total = _pipeline.totalAttempts || 1
  const successRate = Math.round((_pipeline.totalSuccess / total) * 100)
  const blockRate = Math.round((_pipeline.totalBlocked / total) * 100)
  const coveragePct = _pipeline.fieldsTotal > 0
    ? Math.round((_pipeline.fieldsPresent / _pipeline.fieldsTotal) * 100) : 100

  // Semaphore stats
  const semStats = _semaphoreRef ? _semaphoreRef.stats() : null

  // Lines
  const lines = []

  // ── Header ──
  lines.push(`${C.bold}${C.cyan}  CSI-ULTIMATE  ●  LIVE DASHBOARD${C.reset}    ${dateStr}  ${timeStr}  ${statusBadge(health.status)}`)
  lines.push(`  ${C.dim}Uptime: ${elapsedStr(process.uptime() * 1000)}  │  Job: ${elapsedStr(Date.now() - _pipeline.jobStart)}  │  PID: ${process.pid}${C.reset}`)
  lines.push("")

  // ── Health Section ──
  lines.push(`  ${C.bold}${C.white}SYSTEM HEALTH${C.reset}`)
  lines.push(labelBar("  Heap Memory", health.memory.heapUsedPercent, 100, "%", 60, 80))
  lines.push(labelBar("  CPU Load", health.cpu.loadPercent, 100, "%", 60, 80))
  lines.push(labelBar("  Event Loop Lag", health.eventLoop.lagMs, 200, "ms", 50, 100))
  lines.push(`  ${C.dim}RSS: ${health.memory.heapStats.rssFormatted}  │  Heap: ${health.memory.heapStats.heapUsedFormatted} / ${health.memory.heapStats.heapTotalFormatted}  │  Cores: ${health.cpu.cores}${C.reset}`)
  lines.push("")

  // ── Pipeline Section ──
  lines.push(`  ${C.bold}${C.white}PIPELINE PERFORMANCE${C.reset}`)
  lines.push(pctBar("  Coverage Score", coveragePct))
  lines.push(pctBar("  Success Rate", successRate))
  lines.push(pctBar("  Block Rate", blockRate))
  lines.push(`  ${C.dim}Ads: ${_pipeline.totalSuccess}  │  Skipped: ${_pipeline.totalSkipped}  │  Blocked: ${_pipeline.totalBlocked}  │  Failed: ${_pipeline.totalFailed}${C.reset}`)
  lines.push("")

  // ── Concurrency Section ──
  lines.push(`  ${C.bold}${C.white}TABS & RATE LIMITING${C.reset}`)
  if (semStats) {
    const tabColor = semStats.active >= semStats.max ? C.red : semStats.active >= semStats.max * 0.6 ? C.yellow : C.green
    lines.push(`  ${"Tabs Active:".padEnd(18)} ${tabColor}${semStats.active}${C.reset}/${semStats.max}  │  Waiting: ${semStats.waiting}  │  Util: ${Math.round(semStats.utilization * 100)}%`)
  } else {
    lines.push(`  ${C.dim}Tab pool not attached (call setSemaphoreRef)${C.reset}`)
  }
  if (limiters.length > 0) {
    const limStr = limiters.slice(0, 4).map(l =>
      `${l.hostname.substring(0, 18)}: ${l.available}/${l.capacity}`
    ).join("  │  ")
    lines.push(`  ${C.dim}Limiters: ${limStr}${C.reset}`)
    if (limiters.length > 4) lines.push(`  ${C.dim}  ... and ${limiters.length - 4} more${C.reset}`)
  } else {
    lines.push(`  ${C.dim}No rate limiters active${C.reset}`)
  }
  lines.push("")

  // ── Circuit Breakers ──
  const openBreakers = breakers.filter(b => b.state === "OPEN")
  const warnBreakers = breakers.filter(b => b.state === "HALF_OPEN")
  if (openBreakers.length > 0 || warnBreakers.length > 0) {
    lines.push(`  ${C.bold}${C.white}CIRCUIT BREAKERS${C.reset}`)
    for (const b of openBreakers) {
      const remaining = Math.round(b.remainingCooldown / 1000)
      lines.push(`  ${C.red}● OPEN${C.reset}  ${b.hostname}  (retry in ${remaining}s)`)
    }
    for (const b of warnBreakers) {
      lines.push(`  ${C.yellow}◐ HALF_OPEN${C.reset}  ${b.hostname}  (${b.failures} failures)`)
    }
    lines.push("")
  }

  // ── Recent Errors ──
  if (_pipeline.errors.length > 0) {
    const shown = _pipeline.errors.slice(-3)
    lines.push(`  ${C.bold}${C.white}RECENT ERRORS${C.reset}`)
    for (const err of shown) {
      lines.push(`  ${C.red}✗${C.reset} ${err.substring(0, 55)}`)
    }
    lines.push("")
  }

  // ── Footer ──
  lines.push(`  ${C.dim}Render #${_renderCount}  │  ${limiters.length} limiters  │  ${breakers.length} breakers  │  Press Ctrl+C to exit${C.reset}`)

  const output = lines.join("\n")
  _lastRender = output
  return output
}

// ── Live loop ──────────────────────────────────────────────────
let _intervalId = null

/**
 * Start live dashboard refresh every `intervalMs` (default 2000).
 * Returns a stop function.
 */
export function startDashboard(intervalMs = 2000) {
  if (_intervalId) return () => stopDashboard()

  process.stdout.write(C.hideCursor)

  const tick = async () => {
    try {
      const output = await renderDashboard()
      process.stdout.write(C.clear + output + "\n")
    } catch (err) {
      process.stdout.write(C.clear + `${C.red}Dashboard render error: ${err.message}${C.reset}\n`)
    }
  }

  tick() // immediate first render
  _intervalId = setInterval(tick, intervalMs)
  _intervalId.unref()

  return stopDashboard
}

export function stopDashboard() {
  if (_intervalId) {
    clearInterval(_intervalId)
    _intervalId = null
  }
  process.stdout.write(C.showCursor)
}

// ── Single-shot render to string (for integration) ─────────────
export async function getDashboardSnapshot() {
  return await renderDashboard()
}

// ── Cleanup on exit ────────────────────────────────────────────
process.once("beforeExit", stopDashboard)

export default { startDashboard, stopDashboard, renderDashboard, updatePipelineStats,
  resetPipelineStats, setSemaphoreRef, getDashboardSnapshot }
