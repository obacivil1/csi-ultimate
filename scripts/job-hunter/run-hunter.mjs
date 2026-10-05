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

const BUDGET_MS = parseInt(arg("--budget", String(JOB_DEFAULTS.globalBudgetMs)), 10)
const CONCURRENCY = parseInt(arg("--concurrency", String(JOB_DEFAULTS.concurrency)), 10)
const SKIP_INDEED = args.includes("--skip-indeed")

function prefilterStale(records, days) {
  const kept = []
  const dropped = []
  for (const r of Array.isArray(records) ? records : []) {
    let ts = r.ts
    if (ts == null || ts === 0) ts = parseDate(r.date || r.title || "")
    if (ts == null || Number.isNaN(ts)) {
      dropped.push({ link: r.link, title: r.title, reason: "unparseable-date" })
      continue
    }
    if (isWithinWindow(ts, days) === false) {
      dropped.push({ link: r.link, title: r.title, reason: `older-than-${days}d` })
      continue
    }
    kept.push({ ...r, ts })
  }
  return { kept, dropped }
}

async function main() {
  const t0 = Date.now()
  let existingRaw = []
  try { if (existsSync(OUT_FILE)) existingRaw = JSON.parse(readFileSync(OUT_FILE, "utf8")) } catch {}
  const existing = Array.isArray(existingRaw) ? existingRaw : (existingRaw.results || [])
  console.log(`[ENGINE] budget=${BUDGET_MS}ms concurrency=${CONCURRENCY} skipIndeed=${SKIP_INDEED}  prevResults=${existing.length}`)

  const fresh = await runJobHunt(existing, { budgetMs: BUDGET_MS, concurrency: CONCURRENCY, skipIndeed: SKIP_INDEED })

  const { kept: merged, dropped: staleDropped } = prefilterStale(existing, JOB_DEFAULTS.days)
  const seen = new Set(merged.map(r => r.link).filter(Boolean))
  for (const r of fresh) if (!seen.has(r.link)) merged.push(r)

  const valid = []
  const droppedNoEmail = []
  for (const r of merged) {
    const em = (r.emails || []).filter(validateEmail)
    if (em.length) { r.emails = em; valid.push(r) }
    else droppedNoEmail.push({ link: r.link, title: r.title, reason: "no-valid-email" })
  }
  const badEmail = droppedNoEmail

  const allMx = await verifyEmailsParallel(
    [...new Set(valid.flatMap(r => r.emails))],
    { concurrency: 4, progress: (i, n, em, status) => console.log(`[MX] ${i}/${n} ${em} → ${status}`) },
  )
  for (const r of valid) {
    r.mx = r.emails.map(e => allMx[e] || "?")
    const unknown = r.mx.some(m => m === "?")
    r.verified = unknown
      ? "MX-UNKNOWN"
      : r.mx.every(m => m === "MX") ? "MX-OK" : "NO-MX"
    r.mxNote = "MX = domain accepts mail; not proof the mailbox exists"
  }

  const reportDrop = (label, rows) => {
    if (!rows.length) return
    const byReason = {}
    for (const d of rows) byReason[d.reason] = (byReason[d.reason] || 0) + 1
    console.log(`[DROP:${label}] ${rows.length} → ${JSON.stringify(byReason)}`)
    for (const d of rows.slice(0, 10)) console.log(`   - [${d.reason}] ${String(d.title || d.link || "").slice(0, 70)}`)
  }

  reportDrop("stale", staleDropped)
  reportDrop("no-email", badEmail)

  valid.sort((a, b) => (b.ts || 0) - (a.ts || 0))

  mkdirSync(DATA_DIR, { recursive: true })
  if (valid.length === 0 && existing.length > 0) {
    console.error(`[ENGINE] لا نتيجة صالحة، ولم يُكتب الملف (حماية من إفراغ ${existing.length} سجل سابق).`)
    process.exit(2)
  }
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