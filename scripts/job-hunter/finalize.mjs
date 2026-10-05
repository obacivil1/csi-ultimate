/**
 * finalize.mjs — MX re-verification + integrity checks on real hunt output.
 *
 * SAFETY: this script NEVER invents results. It only reads the existing hunt
 * file, re-verifies the emails that are already there, and writes back what
 * survived. No hardcoded/hardcoded-ads baseline.
 *
 * Usage: node scripts/job-hunter/finalize.mjs [--file <path>] [--days N]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join, dirname, resolve } from "path"
import { fileURLToPath } from "url"
import { parseDate, isWithinWindow } from "./dates.mjs"
import { validateEmail, verifyEmailsParallel } from "./contacts.mjs"
import { JOB_DEFAULTS } from "./config.mjs"
import { PLANNING_RE, NON_ROLE_RE, OFF_DOMAIN_RE, isServiceOffer, isJobSeeker, regionGate, normalizeLoc } from "../../core/job-scan.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
function arg(name, dflt) {
  const i = args.indexOf(name)
  return i === -1 ? dflt : args[i + 1]
}

const FILE = resolve(arg("--file", join(__dirname, "..", "..", "data", "job_hunter_riyadh_planning_2d.json")))
const DAYS = Number(arg("--days", JOB_DEFAULTS.days))

if (!existsSync(FILE)) {
  console.error(`[FINALIZE] لا يوجد ملف نتائج: ${FILE}`)
  console.error("[FINALIZE] شغّل run-hunter.mjs أولًا — هذا السكربت لا ينشئ بيانات.")
  process.exit(1)
}

const raw = JSON.parse(readFileSync(FILE, "utf8"))
const records = Array.isArray(raw) ? raw : (raw.results || [])

const dropped = []
const kept = []
for (const r of records) {
  const title = String(r.title || "")
  const blob = title + " " + String(r.body || "")
  const reason =
    !r.link ? "no-link"
    : isServiceOffer(title) ? "service-offer"
    : isJobSeeker(title) ? "job-seeker"
    : NON_ROLE_RE.test(blob) ? "non-role"
    : OFF_DOMAIN_RE.test(blob) ? "off-domain"
    : !PLANNING_RE.test(blob) ? "not-planning"
    : !regionGate(String(r.loc || "") + " " + blob).ok ? "off-region"
    : null
  if (reason) { dropped.push({ link: r.link, title, reason }); continue }
  const ts = r.ts ?? parseDate(r.date || "")
  if (ts == null || Number.isNaN(ts)) { dropped.push({ link: r.link, title, reason: "unparseable-date" }); continue }
  if (isWithinWindow(ts, DAYS) === false) { dropped.push({ link: r.link, title, reason: `older-than-${DAYS}d` }); continue }
  kept.push({ ...r, loc: normalizeLoc(r.loc) || r.loc, ts })
}

const allEmails = [...new Set(kept.flatMap(r => (r.emails || []).filter(validateEmail)))]
const verified = await verifyEmailsParallel(allEmails, { concurrency: 4 })

for (const r of kept) {
  const em = (r.emails || []).filter(validateEmail)
  r.emails = em
  r.mx = em.map(e => verified[e] || "?")
  r.verified = r.mx.every(m => m === "MX") ? "MX-OK" : r.mx.some(m => m === "MX") ? "MX-PARTIAL" : "NO-MX"
  r.ts = r.ts ?? parseDate(r.date || "")
}

kept.sort((a, b) => (b.ts || 0) - (a.ts || 0))

if (kept.length === 0) {
  console.error("[FINALIZE] لم يتبقَّ أي سجل صالح — لم يُكتب الملف (حماية من إفراغ النتائج).")
  process.exit(2)
}

mkdirSync(dirname(FILE), { recursive: true })
writeFileSync(FILE, JSON.stringify(kept, null, 2), "utf8")

console.log(`[FINALIZE] ${FILE}`)
console.log(`[FINALIZE] محفوظ: ${kept.length} | محذوف: ${dropped.length} (نافذة ${DAYS} يوم)`)
const byReason = {}
for (const d of dropped) byReason[d.reason] = (byReason[d.reason] || 0) + 1
console.log("[FINALIZE] أسباب الحذف: " + JSON.stringify(byReason))
for (const d of dropped.slice(0, 15)) console.log(`  - [${d.reason}] ${d.title}`)
console.log("[FINALIZE] MX = النطاق يقبل بريد فقط، وليس تأكيدًا لوجود البريد.")