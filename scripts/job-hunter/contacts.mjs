import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { resolveMx } from "node:dns/promises"
import { execSync } from "child_process"
import { JOBSEEKER_DOMAIN_RE, HARD_BAD_EMAIL_RE, MAIL_CTX_RE, EMAIL_RAW_RE } from "./config.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const MX_CACHE_PATH = join(__dirname, "..", "..", "state", "jobhunter_mx_cache.json")

let mxCache = null
function loadMxCache() {
  if (mxCache) return mxCache
  mxCache = {}
  try { if (existsSync(MX_CACHE_PATH)) mxCache = JSON.parse(readFileSync(MX_CACHE_PATH, "utf8")) } catch {}
  return mxCache
}
function saveMxCache() {
  try {
    mkdirSync(dirname(MX_CACHE_PATH), { recursive: true })
    writeFileSync(MX_CACHE_PATH, JSON.stringify(mxCache, null, 2), "utf8")
  } catch {}
}

export function validateEmail(e) {
  if (!e || typeof e !== "string") return false
  const em = e.trim()
  if (em.length < 6 || em.length > 254) return false
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(em)) return false
  if (HARD_BAD_EMAIL_RE.test(em)) return false
  return true
}

export function canonicalizeEmail(raw) {
  if (!raw) return ""
  let e = String(raw).trim()
  const m = e.match(/<([^>]+)>/)
  if (m) e = m[1]
  e = e.replace(/^mailto:\s*/i, "").split("?")[0].trim()
  e = e.replace(/[()\[\]{};:'",]/g, "").replace(/[.]+@/g, "@")
  return e.toLowerCase()
}

function emailScore(email, context) {
  let s = 0
  if (/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) s += 30
  const dom = email.split("@")[1] || ""
  if (/^[a-z0-9\-]+\.[a-z]{2,}$/i.test(dom)) s += 10
  if (HARD_BAD_EMAIL_RE.test(email)) s -= 100
  const start = Math.max(0, (context || "").toLowerCase().indexOf(email.toLowerCase()))
  if (start >= 0) {
    const around = (context || "").toLowerCase().substring(start - 140, start + 140)
    if (MAIL_CTX_RE.test(around)) s += 25
  }
  return s
}

export function extractEmails(context) {
  if (!context) return []
  const found = context.match(EMAIL_RAW_RE) || []
  const out = []
  for (const raw of found) {
    const em = canonicalizeEmail(raw)
    if (validateEmail(em) && emailScore(em, context) >= 30) out.push(em)
  }
  return [...new Set(out)]
}

export function extractPhones(text) {
  if (!text) return []
  const t = String(text)
  const found = []
  for (const m of t.matchAll(/(?:\+?966|0|9)\s*[\d\s-]{8,12}/g)) {
    const num = m[0].replace(/[^\d]/g, "")
    if (num.length >= 9 && num.length <= 13) found.push(num.length === 9 ? "0" + num : num)
  }
  return [...new Set(found)].slice(0, 4)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function mxNode(domain) {
  try {
    const mx = await resolveMx(domain)
    return Array.isArray(mx) && mx.length > 0 ? true : null
  } catch { return null }
}

function mxPowerShell(domain) {
  try {
    const safe = domain.replace(/[^a-zA-Z0-9.\-]/g, "")
    const out = execSync(
      `powershell -NoProfile -Command "Resolve-DnsName -Name ${safe} -Type MX -ErrorAction SilentlyContinue | Where-Object { $_.Type -eq 'MX' } | Select-Object -ExpandProperty NameExchange"`,
      { encoding: "utf8", timeout: 30000, windowsHide: true }
    )
    const lines = out.split(/\r?\n/).map(l => l.trim()).filter(l => l && /\./i.test(l))
    return lines.length > 0 ? true : false
  } catch { return null }
}

export async function hasMX(domain, ttlMs = 7 * 24 * 3600 * 1000) {
  const cache = loadMxCache()
  const hit = cache[domain]
  if (hit && hit.ok === true && Date.now() - hit.at < ttlMs) return true
  let ok = await mxNode(domain)
  if (ok === null) ok = await mxPowerShell(domain)
  if (ok === true) { cache[domain] = { ok, at: Date.now() }; saveMxCache() }
  return ok
}

export async function verifyEmailsParallel(emails, { concurrency = 4, progress = null } = {}) {
  const unique = [...new Set(emails.filter(validateEmail))]
  const verified = {}
  let idx = 0
  async function worker() {
    while (idx < unique.length) {
      const em = unique[idx++]
      const dom = em.split("@")[1] || ""
      const mx = await hasMX(dom)
      verified[em] = mx === true ? "MX" : mx === false ? "NO-MX" : "?"
      progress?.(idx, unique.length, em, verified[em])
      await sleep(30)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker))
  return verified
}

export function jobSeekerFreeEmail(emails) {
  return emails.some(e => JOBSEEKER_DOMAIN_RE.test(e))
}