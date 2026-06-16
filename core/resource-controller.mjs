/**
 * resource-controller.mjs — Resource Controller Module
 * ─────────────────────────────────────────────────────
 * Provides concurrency control, rate limiting, health checks,
 * and circuit breaker for production operation.
 *
 * Exports:
 *   Semaphore     – Limit concurrent page/tab slots (default: 3)
 *   TokenBucket   – Per-hostname request rate limiter (default: 30 req/min)
 *   CircuitBreaker – Auto-pause failing sites (5 failures → 5 min cooldown)
 *   checkHealth() – Memory, CPU, event loop, GC metrics
 */

// ── Semaphore ───────────────────────────────────────────────────
export class Semaphore {
  #max
  #active = 0
  #queue = []
  #acquired = 0
  #released = 0

  constructor(max = 3) {
    if (max < 1) throw new Error("Semaphore max must be >= 1")
    this.#max = max
  }

  get active() { return this.#active }
  get waiting() { return this.#queue.length }
  get max() { return this.#max }
  get utilization() { return this.#active / this.#max }

  /**
   * Acquire a slot. Rejects after timeout (default: 120s).
   * @param {number} timeoutMs – wait limit before rejecting
   * @param {string} [label] – optional label for debugging
   * @returns {Promise<() => void>} release function
   */
  acquire(timeoutMs = 120_000, label = "") {
    return new Promise((resolve, reject) => {
      const tryAcquire = () => {
        if (this.#active < this.#max) {
          this.#active++
          this.#acquired++
          let done = false
          const release = () => {
            if (done) return
            done = true
            this.#active--
            this.#released++
            if (this.#queue.length > 0) {
              const next = this.#queue.shift()
              next.timer?.()
              next.resolve(next.release)
            }
          }
          return resolve(release)
        }
        const timer = timeoutMs < Infinity
          ? setTimeout(() => {
              const idx = this.#queue.indexOf(entry)
              if (idx !== -1) this.#queue.splice(idx, 1)
              reject(new Error(`Semaphore timeout (${timeoutMs}ms) [${label}]`))
            }, timeoutMs)
          : null
        const entry = { resolve, reject, timer, label,
          release: () => { if (timer) clearTimeout(timer); tryAcquire() }
        }
        this.#queue.push(entry)
      }
      tryAcquire()
    })
  }

  /** Run an async function inside a guarded slot. */
  async run(fn, timeoutMs, label) {
    const release = await this.acquire(timeoutMs, label)
    try {
      return await fn()
    } finally {
      release()
    }
  }

  /** Reset all pending acquires (reject them) */
  drain(reason = "Semaphore drained") {
    const pending = this.#queue.splice(0)
    for (const entry of pending) {
      entry.timer?.()
      entry.reject(new Error(reason))
    }
  }

  stats() {
    return { active: this.#active, max: this.#max, waiting: this.#queue.length, utilization: this.utilization, totalAcquired: this.#acquired, totalReleased: this.#released }
  }
}


// ── TokenBucket (Rate Limiter) ──────────────────────────────────
export class TokenBucket {
  #tokens
  #capacity
  #refillRate
  #refillInterval
  #lastRefill
  #waiting = 0
  #totalTaken = 0
  #totalRejected = 0

  /**
   * @param {object} opts
   * @param {number} opts.capacity – max tokens (default: 30)
   * @param {number} opts.refillRate – tokens per interval (default: 1)
   * @param {number} opts.refillInterval – interval in ms (default: 2000 → 30/min)
   */
  constructor(opts = {}) {
    this.#capacity = opts.capacity ?? 30
    this.#refillRate = opts.refillRate ?? 1
    this.#refillInterval = opts.refillInterval ?? 2000
    this.#tokens = this.#capacity
    this.#lastRefill = Date.now()
  }

  get tokens() { return this.#tokens }
  get capacity() { return this.#capacity }
  get waiting() { return this.#waiting }

  #refill() {
    const now = Date.now()
    const elapsed = now - this.#lastRefill
    const newTokens = Math.floor(elapsed / this.#refillInterval) * this.#refillRate
    if (newTokens > 0) {
      this.#tokens = Math.min(this.#capacity, this.#tokens + newTokens)
      this.#lastRefill = now
    }
  }

  /**
   * Try to take `count` tokens (default: 1).
   * @returns {boolean} true if tokens were consumed
   */
  tryTake(count = 1) {
    this.#refill()
    if (this.#tokens >= count) {
      this.#tokens -= count
      this.#totalTaken += count
      return true
    }
    this.#totalRejected++
    return false
  }

  /**
   * Wait until tokens are available (up to timeoutMs).
   * @returns {Promise<boolean>} true if tokens consumed before timeout
   */
  async waitAndTake(count = 1, timeoutMs = 30_000) {
    if (this.tryTake(count)) return true
    this.#waiting++
    const start = Date.now()
    return new Promise((resolve) => {
      const poll = () => {
        if (this.tryTake(count)) {
          this.#waiting--
          return resolve(true)
        }
        if (Date.now() - start > timeoutMs) {
          this.#waiting--
          return resolve(false)
        }
        setTimeout(poll, Math.min(this.#refillInterval, 200))
      }
      poll()
    })
  }

  /** Estimated wait time in ms before next token */
  estimatedWait() {
    this.#refill()
    if (this.#tokens > 0) return 0
    return this.#refillInterval
  }

  stats() {
    this.#refill()
    const usage = this.#capacity > 0 ? Math.round((1 - this.#tokens / this.#capacity) * 100) : 0
    return { available: this.#tokens, capacity: this.#capacity, usage, waiting: this.#waiting, totalTaken: this.#totalTaken, totalRejected: this.#totalRejected }
  }
}


// ── Hostname-scoped limiter ─────────────────────────────────────
const _limiters = new Map()

/**
 * Get or create a TokenBucket for a given hostname.
 * Each hostname gets its own rate limit to avoid cross-site interference.
 */
export function getLimiter(hostname) {
  if (!_limiters.has(hostname)) {
    _limiters.set(hostname, new TokenBucket({ capacity: 30, refillRate: 1, refillInterval: 2000 }))
  }
  return _limiters.get(hostname)
}

/** Reset all limiters (e.g. on config change) */
export function resetLimiters() { _limiters.clear() }

/** Array of { hostname, stats } for all active limiters */
export function limiterSummary() {
  const result = []
  for (const [hostname, bucket] of _limiters) {
    result.push({ hostname, ...bucket.stats() })
  }
  return result
}


// ── Circuit Breaker ─────────────────────────────────────────────
const FAILURE_THRESHOLD = 5
const COOLDOWN_MS = 300_000  // 5 min
const HALF_OPEN_TIMEOUT = 60_000

const STATES = { CLOSED: "CLOSED", OPEN: "OPEN", HALF_OPEN: "HALF_OPEN" }

const _breakers = new Map()

export class CircuitBreaker {
  #hostname
  #failures = 0
  #state = STATES.CLOSED
  #lastFailure = 0
  #nextAttempt = 0
  #totalTrips = 0
  #totalSuccess = 0

  constructor(hostname) {
    this.#hostname = hostname
  }

  get state() { return this.#state }
  get failures() { return this.#failures }
  get isOpen() { return this.#state === STATES.OPEN }
  get isClosed() { return this.#state === STATES.CLOSED }

  /**
   * Check if request should be allowed.
   * Throws if circuit is OPEN and cooldown hasn't elapsed.
   */
  async call(fn) {
    const now = Date.now()

    if (this.#state === STATES.OPEN) {
      if (now < this.#nextAttempt) {
        throw new Error(`Circuit OPEN for ${this.#hostname} (retry in ${Math.round((this.#nextAttempt - now) / 1000)}s)`)
      }
      this.#state = STATES.HALF_OPEN
    }

    try {
      const result = await fn()
      this.#onSuccess()
      return result
    } catch (err) {
      this.#onFailure()
      throw err
    }
  }

  #onSuccess() {
    this.#totalSuccess++
    if (this.#state === STATES.HALF_OPEN) {
      this.#state = STATES.CLOSED
      this.#failures = 0
    }
  }

  #onFailure() {
    this.#failures++
    this.#lastFailure = Date.now()
    if (this.#failures >= FAILURE_THRESHOLD) {
      this.#state = STATES.OPEN
      this.#nextAttempt = Date.now() + COOLDOWN_MS
      this.#totalTrips++
    }
  }

  stats() {
    return {
      hostname: this.#hostname,
      state: this.#state,
      failures: this.#failures,
      threshold: FAILURE_THRESHOLD,
      cooldownMs: COOLDOWN_MS,
      nextAttempt: this.#state === STATES.OPEN ? new Date(this.#nextAttempt).toISOString() : null,
      remainingCooldown: this.#state === STATES.OPEN ? Math.max(0, this.#nextAttempt - Date.now()) : 0,
      totalTrips: this.#totalTrips,
      totalSuccessAfterHalfOpen: this.#totalSuccess,
    }
  }
}

/** Get or create CircuitBreaker for hostname */
export function getBreaker(hostname) {
  if (!_breakers.has(hostname)) {
    _breakers.set(hostname, new CircuitBreaker(hostname))
  }
  return _breakers.get(hostname)
}

/** Reset a specific breaker */
export function resetBreaker(hostname) { _breakers.delete(hostname) }
export function resetAllBreakers() { _breakers.clear() }

/** Summary of all breakers */
export function breakerSummary() {
  return Array.from(_breakers.entries()).map(([h, b]) => ({ hostname: h, ...b.stats() }))
}


// ── Health Check ────────────────────────────────────────────────
const EVENT_LOOP_SAMPLE_MS = 50

/**
 * Measure event loop latency by scheduling a setTimeout and measuring delay.
 * @returns {Promise<number>} lag in ms
 */
async function measureEventLoopLag() {
  const start = Date.now()
  return new Promise(resolve => {
    setTimeout(() => resolve(Date.now() - start - EVENT_LOOP_SAMPLE_MS), EVENT_LOOP_SAMPLE_MS)
  })
}

/**
 * Attempt to run GC if available (--expose-gc flag required).
 * @returns {boolean} true if GC was called
 */
function runGc() {
  if (typeof globalThis.gc === "function") {
    globalThis.gc()
    return true
  }
  return false
}

/**
 * checkHealth() — Gather full system health snapshot.
 * @param {object} [opts]
 * @param {boolean} [opts.forceGc=false] – attempt GC before measuring
 * @param {boolean} [opts.measureEventLoop=true] – measure event loop lag
 * @returns {Promise<object>} health metrics
 */
export async function checkHealth(opts = {}) {
  const { forceGc = false, measureEventLoop = true } = opts

  if (forceGc) runGc()

  const mem = process.memoryUsage()
  const memStats = {
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
    rss: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
    external: Math.round(mem.external / 1024 / 1024 * 100) / 100,
    heapUsedPercent: mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 100) : 0,
    heapStats: {
      heapUsedFormatted: formatBytes(mem.heapUsed),
      heapTotalFormatted: formatBytes(mem.heapTotal),
      rssFormatted: formatBytes(mem.rss),
    },
  }

  const os = await import("os")
  const cpus = os.cpus()
  const cpuStats = {
    cores: cpus.length,
    model: cpus[0]?.model || "unknown",
    loadAvg1: os.loadavg()[0],
    loadAvg5: os.loadavg()[1],
    loadAvg15: os.loadavg()[2],
    loadPercent: cpus.length > 0 ? Math.round((os.loadavg()[0] / cpus.length) * 100) : 0,
    uptime: Math.round(os.uptime()),
    freeMemory: Math.round(os.freemem() / 1024 / 1024 * 100) / 100,
    totalMemory: Math.round(os.totalmem() / 1024 / 1024 * 100) / 100,
  }

  let eventLoopLag = -1
  if (measureEventLoop) {
    eventLoopLag = await measureEventLoopLag()
  }

  // Determine overall status
  const warnings = []
  const criticals = []

  if (memStats.heapUsedPercent > 80) criticals.push(`Heap memory at ${memStats.heapUsedPercent}% (critical)`)
  else if (memStats.heapUsedPercent > 60) warnings.push(`Heap memory at ${memStats.heapUsedPercent}% (warning)`)

  if (cpuStats.loadPercent > 80) criticals.push(`CPU load at ${cpuStats.loadPercent}% (critical)`)
  else if (cpuStats.loadPercent > 60) warnings.push(`CPU load at ${cpuStats.loadPercent}% (warning)`)

  if (eventLoopLag > 100) criticals.push(`Event loop lag ${eventLoopLag}ms (critical)`)
  else if (eventLoopLag > 50) warnings.push(`Event loop lag ${eventLoopLag}ms (warning)`)

  const status = criticals.length > 0 ? "AT_RISK" : warnings.length > 0 ? "WARN" : "HEALTHY"

  return {
    status,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    uptime: process.uptime(),
    node: process.version,
    platform: process.platform,
    gcAvailable: typeof globalThis.gc === "function",
    memory: memStats,
    cpu: cpuStats,
    eventLoop: { lagMs: eventLoopLag },
    warnings,
    criticals,
  }
}


// ── Utils ───────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}


export default { Semaphore, TokenBucket, CircuitBreaker, checkHealth, getLimiter, getBreaker,
  resetLimiters, resetAllBreakers, limiterSummary, breakerSummary }
