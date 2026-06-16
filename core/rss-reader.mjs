/**
 * rss-reader.mjs — RSS feed parser for job boards
 * Used when direct scraping is blocked (Indeed primary feed)
 */
import fs from "fs"
import path from "path"

const FEED_CACHE_DIR = path.resolve(import.meta.dirname, "..", "state", "feed-cache")
if (!fs.existsSync(FEED_CACHE_DIR)) fs.mkdirSync(FEED_CACHE_DIR, { recursive: true })

const RSS_CONFIG = {
  "sa.indeed.com": {
    feedUrl: (keyword, location) =>
      `https://sa.indeed.com/rss?q=${encodeURIComponent(keyword || "")}&l=${encodeURIComponent(location || "Riyadh")}`,
    parseItem: (item) => ({
      title: item.title?.["$t"] || item.title || "",
      url: item.link?.["$t"] || item.link || "",
      description: item.description?.["$t"] || item.description || "",
      source: "indeed-rss",
    }),
  },
}

export async function parseRssFeed(siteHostname, keyword = "", location = "Riyadh") {
  const config = RSS_CONFIG[siteHostname]
  if (!config) return []

  const feedUrl = config.feedUrl(keyword, location)
  const cacheKey = `${siteHostname.replace(/[^a-z0-9]/g,"_")}_${keyword}_${location}`.substring(0, 60)
  const cachePath = path.join(FEED_CACHE_DIR, `${cacheKey}.json`)

  // Cache for 5 minutes
  if (fs.existsSync(cachePath)) {
    const age = Date.now() - fs.statSync(cachePath).mtimeMs
    if (age < 300000) {
      return JSON.parse(fs.readFileSync(cachePath, "utf-8"))
    }
  }

  try {
    const resp = await fetch(feedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) {
      console.log(`[RSS] HTTP ${resp.status} for ${feedUrl}`)
      return []
    }

    const xml = await resp.text()
    const items = parseXmlItems(xml)
    const results = items.map(item => {
      const title = extractField(item, ["title"])
      const link = extractField(item, ["link"])
      const desc = extractField(item, ["description"])
      return { title, url: link, description: desc, source: "rss" }
    })

    fs.writeFileSync(cachePath, JSON.stringify(results, null, 2), "utf-8")
    console.log(`[RSS] ${results.length} items from ${feedUrl}`)
    return results
  } catch (e) {
    console.log(`[RSS] Feed fetch failed: ${e.message?.substring(0, 60)}`)
    return []
  }
}

function extractField(item, keys) {
  for (const k of keys) {
    const v = item[k]
    if (v && typeof v === "object" && v["$t"]) return v["$t"]
    if (typeof v === "string") return v
  }
  return ""
}

function parseXmlItems(xml) {
  const items = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi
  let m
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1]
    const item = {}
    const fieldRegex = /<(\w+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi
    let f
    while ((f = fieldRegex.exec(block)) !== null) {
      const [, tag, content] = f
      item[tag] = content.trim()
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    }
    if (item.title || item.link) items.push(item)
  }
  return items
}
