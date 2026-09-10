import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PATH = join(__dirname, "..", "..", "state", "jobhunter-advisor.json")

const WINDOW_MS = 5 * 24 * 3600 * 1000

export class Advisor {
  constructor(path = PATH) {
    this.path = path
    this.mem = { sources: {} }
    this.load()
  }

  load() {
    try {
      if (existsSync(this.path)) {
        const data = JSON.parse(readFileSync(this.path, "utf8"))
        if (data?.sources) this.mem = data
      }
    } catch {}
  }

  persist() {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, JSON.stringify(this.mem, null, 2), "utf8")
    } catch {}
  }

  prune(name) {
    const s = this.mem.sources[name]
    if (!s) return
    const cut = Date.now() - WINDOW_MS
    s.hits = (s.hits || []).filter(t => t >= cut)
    s.fails = (s.fails || []).filter(t => t >= cut)
  }

  record(name, success, detail) {
    const s = this.mem.sources[name] || (this.mem.sources[name] = { hits: [], fails: [], last: {} })
    if (success) s.hits.push(Date.now())
    else s.fails.push(Date.now())
    s.last = { at: Date.now(), ok: success, detail }
    this.prune(name)
    this.persist()
  }

  score(name) {
    this.prune(name)
    const s = this.mem.sources[name]
    if (!s) return 0
    return (s.hits || []).length - (s.fails || []).length * 2
  }

  ok(name) { return this.score(name) > 0 }

  summary() {
    const out = {}
    for (const [k, s] of Object.entries(this.mem.sources || {})) {
      out[k] = { hits: (s.hits || []).length, fails: (s.fails || []).length, score: this.score(k) }
    }
    return out
  }
}