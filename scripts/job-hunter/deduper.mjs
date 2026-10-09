import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PATH = join(__dirname, "..", "..", "state", "jobhunter-dedupe.json")

export class Deduper {
  constructor(path = PATH) {
    this.path = path
    this.urls = new Set()
    this.load()
  }

  load() {
    try {
      if (existsSync(this.path)) {
        const data = JSON.parse(readFileSync(this.path, "utf8"))
        if (data?.urls) this.urls = new Set(data.urls)
      }
    } catch {}
  }

  save() {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, JSON.stringify({ urls: [...this.urls], savedAt: new Date().toISOString() }, null, 2), "utf8")
    } catch {}
  }

  has(url) { return this.urls.has(url) }
  mark(url) {
    if (!url) return false
    if (this.urls.has(url)) return false
    this.urls.add(url)
    this.save()
    return true
  }
}

const normKeyPart = s =>
  String(s || "").toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, " ").trim()

/**
 * Merge the same opening syndicated to several boards (a WSP "Senior Planner"
 * shows up on both Bayt and Indeed), which would otherwise be listed twice.
 * Only rows with a non-empty company are candidates, and only when the two
 * records come from *different* sources — one board's own reposts stay as they
 * are. The survivor prefers a mailbox, then the most recent date; the loser's
 * link is kept on `alsoOn`.
 */
export function mergeTwins(rows) {
  const index = new Map()
  const out = []
  for (const r of rows) {
    const company = normKeyPart(r.company)
    if (!company) { out.push(r); continue }
    const key = `${normKeyPart(r.title)}|${company}`
    const at = index.get(key)
    if (at === undefined) { index.set(key, out.length); out.push(r); continue }
    const prev = out[at]
    if (prev.source === r.source) { out.push(r); continue }
    const rank = x => (x.emails?.length ? 0 : 1)
    const keep = rank(prev) !== rank(r)
      ? (rank(prev) < rank(r) ? prev : r)
      : ((prev.ts || 0) <= (r.ts || 0) ? prev : r)
    const drop = keep === prev ? r : prev
    keep.alsoOn = [...new Set([...(keep.alsoOn || []), ...(drop.alsoOn || []), drop.link])]
      .filter(l => l && l !== keep.link)
    out[at] = keep
  }
  return out
}