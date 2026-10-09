/**
 * flare-solver.mjs — FlareSolverr client (Cloudflare challenge solver)
 * ─────────────────────────────────────────────────────────────────
 * FlareSolverr runs as a Docker sidecar (port 8191) and, for any URL,
 * drives a real browser to pass the Cloudflare JS challenge, then returns
 * the cleared page HTML plus the cf_clearance / __cf_bm cookies.
 *
 * Usage:
 *   const html = await fetchWithFlareSolverr("https://.../cls/12345.html")
 *   const ads  = parseFlareHtml(html, url)   // via extractAdContentFromHtml
 *
 * Env:
 *   CSI_FLARE_URL        FlareSolverr base URL (default http://localhost:8191)
 *   CSI_FLARE_TIMEOUT_MS Request timeout (default 60000)
 *   CSI_FLARE_CACHE_SIZE Max cached HTML responses (default 200)
 *   CSI_FLARE_DISABLED   Set "1" to force-disable without erroring
 *
 * Run it:
 *   docker compose up -d flaresolverr
 */
import { extractAdContentFromHtml } from "./crawler-core.mjs"
import { assertPublicUrl } from "./ssrf-guard.mjs"
import { env } from "../config/env.mjs"

const FLARE_URL = env.FLARE.URL
const TIMEOUT_MS = env.FLARE.TIMEOUT_MS
const CACHE_SIZE = env.FLARE.CACHE_SIZE
const DISABLED = env.FLARE.DISABLED

// Simple LRU-ish HTML cache to avoid re-solving the same ad page.
const htmlCache = new Map()

function logInfo(tag, msg, meta) {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 23)
  const m = meta ? ` ${JSON.stringify(meta)}` : ""
  if (env.LOG_LEVEL !== "SILENT") console.log(`[${ts}] [${tag}] ${msg}${m}`)
}

function cachePut(url, html) {
  htmlCache.set(url, html)
  if (htmlCache.size > CACHE_SIZE) {
    const oldest = htmlCache.keys().next().value
    if (oldest !== undefined) htmlCache.delete(oldest)
  }
}

/**
 * fetchWithFlareSolverr — Ask FlareSolverr to fetch + solve a URL.
 * Returns { ok, html, status } or { ok:false, error }.
 */
export async function fetchWithFlareSolverr(url, opts = {}) {
  if (DISABLED) return { ok: false, error: "FlareSolverr disabled via CSI_FLARE_DISABLED" }
  if (!url) return { ok: false, error: "No URL" }
  try { await assertPublicUrl(url) } catch { return { ok: false, error: "Blocked or invalid URL" } }

  const cached = htmlCache.get(url)
  if (cached) return { ok: true, html: cached, status: 200, cached: true }

  const controller = new AbortController()
  // The outer abort must outlast the solver's own maxTimeout, otherwise a slow
  // challenge is cancelled by us before FlareSolverr can finish it.
  const budgetMs = opts.maxTimeout ? opts.maxTimeout + 20000 : TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), budgetMs)

  try {
    const res = await fetch(`${FLARE_URL}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        cmd: "request.get",
        url,
        // Indeed's Turnstile round takes ~80s the first time; callers that know
        // the target is slow can ask for more, everything else stays on 55s.
        maxTimeout: Math.min(
          opts.maxTimeout || TIMEOUT_MS - 5000,
          opts.maxTimeout || 55000,
        ),
        session: opts.session || undefined,
      }),
    })

    if (!res.ok) return { ok: false, error: `FlareSolverr HTTP ${res.status}` }

    const data = await res.json()
    if (data?.solution?.status !== 200) {
      return {
        ok: false,
        status: data?.solution?.status,
        error: data?.solution?.statusText || data?.message || "FlareSolverr incomplete",
      }
    }

    const html = data.solution.response || data.solution.html || ""
    if (!html || /just a moment|verify you are human/i.test(html)) {
      return { ok: false, status: data.solution.status, error: "Challenge not resolved by FlareSolverr" }
    }

    cachePut(url, html)
    logInfo("[FLARE]", "Solved via FlareSolverr", { url: url.substring(0, 60), bytes: html.length })
    return { ok: true, html, status: 200 }
  } catch (e) {
    const err = e.name === "AbortError" ? "timeout" : e.message
    if (env.LOG_LEVEL !== "SILENT" && !/fetch failed/i.test(err)) {
      logInfo("[FLARE]", `Unavailable: ${err}`, { url: FLARE_URL })
    }
    return { ok: false, error: `FlareSolverr unreachable: ${err}` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * extractFromFlareHtml — convenience: run FlareSolverr then parse the ad.
 * Returns fields compatible with extractAdData(): { title, phones, emails,
 * description, url } or null on failure.
 */
export async function extractFromFlareHtml(url, opts = {}) {
  const r = await fetchWithFlareSolverr(url, opts)
  if (!r.ok) return null
  return { ...extractAdContentFromHtml(r.html, url), flare: true }
}

/**
 * isFlareAvailable — lightweight health check (GET /).
 */
export async function isFlareAvailable() {
  if (DISABLED) return false
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), 4000)
    const res = await fetch(`${FLARE_URL}/`, { method: "GET", signal: c.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

export default { fetchWithFlareSolverr, extractFromFlareHtml, isFlareAvailable }
