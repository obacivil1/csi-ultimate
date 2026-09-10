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