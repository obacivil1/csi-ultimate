/**
 * _probe.mjs — Connectivity Probe (used by _pen_test.mjs)
 * ──────────────────────────────────────────────────────────
 * Tests whether a given URL is reachable via DNS + HTTP fetch.
 *
 * Usage:  node _probe.mjs <url>
 * Output: { ok: bool, status: int|string, timing: float, error?: string }
 */

const url = process.argv[2] || "https://expatriates.com"
const start = Date.now()

async function main() {
  try {
    // DNS resolution check
    const { hostname } = new URL(url)
    const dnsStart = Date.now()
    const { Resolver } = await import("dns/promises")
    const resolver = new Resolver()
    const addresses = await resolver.resolve4(hostname)
    const dnsTime = (Date.now() - dnsStart) / 1000

    // HTTP connectivity check (lightweight, no browser)
    const httpStart = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      redirect: "manual",
    })
    clearTimeout(timeout)
    const httpTime = (Date.now() - httpStart) / 1000

    const result = {
      ok: response.status < 400 || response.status === 403 || response.status === 503,
      status: response.status,
      dns: dnsTime.toFixed(2),
      timing: (Date.now() - start) / 1000,
      ip: addresses[0],
    }
    console.log(JSON.stringify(result))
    process.exit(result.ok ? 0 : 1)
  } catch (e) {
    const result = {
      ok: false,
      status: e.name === "AbortError" ? "TIMEOUT" : e.cause?.code || e.code || e.message.substring(0, 30),
      error: e.message?.substring(0, 80),
      timing: (Date.now() - start) / 1000,
    }
    console.log(JSON.stringify(result))
    process.exit(1)
  }
}

main()
