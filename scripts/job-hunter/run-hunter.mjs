import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { runJobHunt } from "./engine.mjs"
import { Advisor } from "./advisor.mjs"
import { validateEmail, verifyEmailsParallel } from "./contacts.mjs"
import { isWithinWindow, parseDate } from "./dates.mjs"
import { JOB_DEFAULTS } from "./config.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, "..", "..", "data")
const OUT_FILE = join(DATA_DIR, "job_hunter_riyadh_planning_2d.json")

const args = process.argv.slice(2)
function arg(name, dflt) {
  const i = args.indexOf(name)
  return i === -1 ? dflt : args[i + 1]
}

const BUDGET_MS = parseInt(arg("--budget", "420000"), 10)

function prefilterStale(records, days) {
  return (Array.isArray(records) ? records : []).filter(r => {
    let ts = r.ts
    if (ts == null || ts === 0) ts = parseDate(r.date || r.title || "")
    if (ts == null || ts === 0) return false
    return isWithinWindow(ts, days) !== false
  })
}

async function main() {
  const t0 = Date.now()
  let existingRaw = []
  try { if (existsSync(OUT_FILE)) existingRaw = JSON.parse(readFileSync(OUT_FILE, "utf8")) } catch {}
  const existing = Array.isArray(existingRaw) ? existingRaw : (existingRaw.results || [])
  console.log(`[ENGINE] budget=${BUDGET_MS}ms  prevResults=${existing.length}`)

  const fresh = await runJobHunt(existing, { budgetMs: BUDGET_MS })

  const merged = prefilterStale(existing, JOB_DEFAULTS.days)
  const seen = new Set(merged.map(r => r.link).filter(Boolean))
  for (const r of fresh) if (!seen.has(r.link)) merged.push(r)

  const valid = []
  const badEmail = merged.filter(r => !Array.isArray(r.emails) || !r.emails.some(validateEmail))
  for (const r of merged) {
    const em = (r.emails || []).filter(validateEmail)
    if (em.length) { r.emails = em; valid.push(r) }
  }

  const allMx = await verifyEmailsParallel(
    [...new Set(valid.flatMap(r => r.emails))],
    { concurrency: 4, progress: (i, n, em, status) => console.log(`[MX] ${i}/${n} ${em} → ${status}`) },
  )
  for (const r of valid) {
    r.mx = r.emails.map(e => allMx[e] || "?")
    r.verified = r.mx.every(m => m === "MX") ? "MX-OK" : r.mx.some(m => m === "MX") ? "MX-PARTIAL" : "NO-MX"
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(valid, null, 2), "utf8")
  console.log(`[ENGINE] saved ${valid.length} valid results (dropped ${badEmail.length} w/o email) to ${OUT_FILE}`)

  console.log("\n=== RESULTS ===")
  for (const r of valid) {
    console.log(`- ${r.title}  (${r.source}/${r.match})\n    ${r.link}\n    ${r.emails.join("; ")}\n    ${r.date || "n/a"}\n`)
  }

  console.log(`\n[ADVISOR] ${JSON.stringify(new Advisor().summary())}`)

  const allEmails = [...new Set(valid.flatMap(r => r.emails.map(e => e.toLowerCase())))]
  if (allEmails.length) {
    console.log("[EMAILS] " + allEmails.join("; "))
  }
  console.log(`[ENGINE] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  return 0
}

main().then(code => process.exit(code)).catch(e => { console.error("[ENGINE] FAIL", e?.stack || e); process.exit(1) })