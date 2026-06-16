import { createHash } from "crypto"
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, "..", "state", "indeed-cache")
const CACHE_TTL = 10 * 60 * 1000

const log = (tag, msg, data) => {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 19)
  const extra = data ? ` ${JSON.stringify(data)}` : ""
  console.log(`[${ts}] [${tag}] ${msg}${extra}`)
}

function getCacheKey(query) {
  return createHash("md5").update(JSON.stringify(query)).digest("hex")
}

function readCache(key) {
  const path = join(CACHE_DIR, `${key}.json`)
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"))
    if (Date.now() - data.cachedAt < CACHE_TTL) return data.results
  } catch {}
  return null
}

function writeCache(key, results) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify({ results, cachedAt: Date.now() }), "utf-8")
  } catch {}
}

// ── Indeed Publisher API ─────────────────────────────────────
// Register for free at https://publish.indeed.com to get publisher ID
const INDEED_API_BASE = "https://api.indeed.com/ads/apisearch"

async function fetchFromPublisherAPI(query, location, publisherId) {
  if (!publisherId) return null

  const params = new URLSearchParams({
    publisher: publisherId,
    q: query || "",
    l: location || "",
    format: "json",
    v: "2",
    limit: "25",
    start: "0",
    latlong: "0",
    filter: "1",
    sort: "date",
  })

  const url = `${INDEED_API_BASE}?${params}`
  log("[INDEED-API]", `Fetching Publisher API`, { url: url.replace(publisherId, "***") })

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; IndeedBot/1.0)" },
    })
    if (!resp.ok) {
      log("[INDEED-API]", `Publisher API returned ${resp.status}`)
      return null
    }
    const data = await resp.json()
    if (!data?.results?.length) {
      log("[INDEED-API]", "No results from Publisher API")
      return null
    }
    return data.results.map(job => ({
      title: job.jobtitle || job.title || "N/A",
      url: job.url || `https://www.indeed.com/viewjob?jk=${job.jobkey || ""}`,
      description: job.snippet?.substring(0, 500) || job.description?.substring(0, 500) || "",
      company: job.company || "",
      location: job.formattedLocation || job.city || "",
      price: job.salary ? `${job.salary}` : null,
      currency: null,
      phone: null,
      email: null,
      source: "indeed-api",
      jobkey: job.jobkey || "",
      postedAt: job.date ? new Date(job.date).toISOString() : null,
    }))
  } catch (err) {
    log("[INDEED-API]", `Publisher API error: ${err.message}`)
    return null
  }
}

// ── Indeed Embed / Widget API ────────────────────────────────
async function fetchFromEmbedAPI(query, location) {
  const params = new URLSearchParams({
    q: query || "",
    l: location || "",
    format: "json",
    limit: "25",
  })
  const url = `https://www.indeed.com/jobs/api/widget?${params}`
  log("[INDEED-EMBED]", `Fetching embed API`, { url })

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*",
        "Referer": "https://www.indeed.com/",
      },
    })
    if (!resp.ok) {
      log("[INDEED-EMBED]", `HTTP ${resp.status}`)
      return null
    }
    const text = await resp.text()
    if (!text || text.length < 50) return null
    try {
      const data = JSON.parse(text)
      if (data?.joblist?.length) {
        return data.joblist.map(j => ({
          title: j.title || j.jobtitle || "N/A",
          url: j.url || `https://www.indeed.com/viewjob?jk=${j.jk || ""}`,
          description: j.snippet?.substring(0, 500) || "",
          company: j.company || "",
          location: j.formattedLocation || j.location || "",
          price: j.salary ? `${j.salary}` : null,
          currency: null, phone: null, email: null,
          source: "indeed-embed",
          jobkey: j.jk || "",
        }))
      }
    } catch {}
    return null
  } catch (err) {
    log("[INDEED-EMBED]", `Error: ${err.message}`)
    return null
  }
}

// ── Indeed oEmbed API ────────────────────────────────────────
async function fetchFromOEmbed(query, location) {
  const params = new URLSearchParams({
    q: query || "",
    l: location || "",
    format: "json",
    limit: "25",
  })
  const url = `https://www.indeed.com/jobs/api/search?${params}`
  log("[INDEED-OEMBED]", `Fetching oEmbed`, { url })

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://www.indeed.com/",
        "X-Requested-With": "XMLHttpRequest",
      },
    })
    if (!resp.ok) return null
    const text = await resp.text()
    if (!text || text.length < 50) return null
    try {
      const data = JSON.parse(text)
      if (Array.isArray(data)) {
        return data.map(j => ({
          title: j.title || j.jobtitle || "N/A",
          url: j.url || "",
          description: (j.description || j.snippet || "").substring(0, 500),
          company: j.company || "",
          location: j.location || j.city || "",
          price: j.salary?.toString() || null,
          currency: null, phone: null, email: null,
          source: "indeed-oembed",
          jobkey: j.jobkey || j.id || "",
        }))
      }
    } catch {}
    return null
  } catch (err) {
    log("[INDEED-OEMBED]", `Error: ${err.message}`)
    return null
  }
}

// ── Indeed Job Search API (Google Jobs aggregated) ──────────
async function fetchFromGoogleJobs(query, location) {
  const searchQuery = encodeURIComponent(`site:sa.indeed.com ${query} ${location} job`)
  const url = `https://www.google.com/search?q=${searchQuery}&tbm=jobs&hl=en`
  log("[GOOGLE-JOBS]", `Searching Google Jobs`, { url: url.substring(0, 120) })

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
    })
    if (!resp.ok) return null
    const html = await resp.text()
    const jobs = []
    const jobMatches = html.matchAll(/<div[^>]*class="[^"]*job[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi)
    for (const match of jobMatches) {
      const block = match[1]
      const title = block.match(/<h3[^>]*>(.*?)<\/h3>/i)?.[1]?.replace(/<[^>]+>/g, "") || ""
      const company = block.match(/class="[^"]*company[^"]*"[^>]*>(.*?)</i)?.[1]?.replace(/<[^>]+>/g, "") || ""
      const loc = block.match(/class="[^"]*location[^"]*"[^>]*>(.*?)</i)?.[1]?.replace(/<[^>]+>/g, "") || ""
      if (title) {
        jobs.push({
          title: title.trim(),
          url: "",
          description: "",
          company: company.trim(),
          location: loc.trim(),
          price: null, currency: null, phone: null, email: null,
          source: "google-jobs",
        })
      }
    }
    return jobs.length ? jobs : null
  } catch (err) {
    log("[GOOGLE-JOBS]", `Error: ${err.message}`)
    return null
  }
}

// ── Public API ───────────────────────────────────────────────
export async function fetchIndeedJobs(query, location = "Riyadh", publisherId) {
  const cacheKey = getCacheKey({ query, location })
  const cached = readCache(cacheKey)
  if (cached) {
    log("[INDEED-API]", `Returning ${cached.length} cached results`)
    return cached
  }

  // Strategy chain — try each until we get results
  const strategies = [
    { name: "Publisher API", fn: () => fetchFromPublisherAPI(query, location, publisherId) },
    { name: "Embed API", fn: () => fetchFromEmbedAPI(query, location) },
    { name: "oEmbed API", fn: () => fetchFromOEmbed(query, location) },
    { name: "Google Jobs", fn: () => fetchFromGoogleJobs(query, location) },
  ]

  for (const strategy of strategies) {
    const results = await strategy.fn()
    if (results && results.length > 0) {
      log("[INDEED-API]", `Strategy "${strategy.name}" returned ${results.length} results`)
      writeCache(cacheKey, results)
      return results
    }
  }

  log("[INDEED-API]", "All strategies returned empty")
  return []
}

export async function fetchIndeedJobDetails(jobkey) {
  const url = `https://www.indeed.com/viewjob?jk=${jobkey}`
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html",
      },
    })
    if (!resp.ok) return null
    const html = await resp.text()
    const descMatch = html.match(/id="jobDescriptionText"[^>]*>([\s\S]*?)<\/div>/i)
    const desc = descMatch?.[1]?.replace(/<[^>]+>/g, "").trim()?.substring(0, 1000) || ""
    return { description: desc }
  } catch {
    return null
  }
}
