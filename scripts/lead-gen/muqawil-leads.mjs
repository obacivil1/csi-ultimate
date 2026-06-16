import { readFileSync, writeFileSync, existsSync } from "fs"
import { resolve } from "path"

const DATA_FILE = resolve("data/muqawil_leads_riyadh_all.json")

if (!existsSync(DATA_FILE)) {
  console.error("الملف غير موجود. شغّل السكريبر أولاً.")
  process.exit(1)
}

const all = JSON.parse(readFileSync(DATA_FILE, "utf8"))

// ── CLI filters ──
const ARGS = process.argv.slice(2)
const FILTER_CITY = ARGS.find(a => a.startsWith("--city="))?.split("=")[1] || ""
const FILTER_SIZE = ARGS.find(a => a.startsWith("--size="))?.split("=")[1] || ""
const FILTER_HAS_EMAIL = ARGS.includes("--has-email") || ARGS.includes("-e")
const FILTER_HAS_PHONE = ARGS.includes("--has-phone") || ARGS.includes("-p")
const LIMIT = parseInt(ARGS.find(a => a.startsWith("--limit="))?.split("=")[1] || "0")
const FORMAT = ARGS.find(a => a.startsWith("--format="))?.split("=")[1] || "table"
const SORT = ARGS.find(a => a.startsWith("--sort="))?.split("=")[1] || "name"

// ── Filter ──
let results = [...all]

if (FILTER_CITY) {
  results = results.filter(r => r.city?.includes(FILTER_CITY))
}
if (FILTER_SIZE) {
  const sizeMap = { small: "منشأة صغيرة", medium: "منشأة متوسطة", large: "منشأة كبيرة", micro: "منشأة متناهية الصغر" }
  const sizeFilter = sizeMap[FILTER_SIZE] || FILTER_SIZE
  results = results.filter(r => r.companySize === sizeFilter)
}
if (FILTER_HAS_EMAIL) {
  results = results.filter(r => r.email && r.email.length > 3)
}
if (FILTER_HAS_PHONE) {
  results = results.filter(r => r.phone && r.phone.length > 3)
}

// ── Sort ──
if (SORT === "name") results.sort((a, b) => (a.companyName || "").localeCompare(b.companyName || ""))
if (SORT === "city") results.sort((a, b) => (a.city || "").localeCompare(b.city || ""))

// ── Limit ──
if (LIMIT > 0) results = results.slice(0, LIMIT)

// ── Output ──
if (FORMAT === "csv" || FORMAT === "csv-only") {
  const header = "companyName\tphone\temail\tcity\tcompanySize\tcontractorType"
  const rows = results.map(r =>
    `${r.companyName || ""}\t${r.phone || ""}\t${r.email || ""}\t${r.city || ""}\t${r.companySize || ""}\t${r.contractorType || ""}`
  )
  console.log(header)
  rows.forEach(r => console.log(r))
}

if (FORMAT === "json") {
  console.log(JSON.stringify(results, null, 2))
}

if (FORMAT === "table" || FORMAT === "csv") {
  console.log(`\nإجمالي النتائج: ${results.length} من أصل ${all.length}`)

  // Stats
  const cities = {}; all.forEach(r => { const c = r.city || "غير محدد"; cities[c] = (cities[c]||0)+1 })
  const cityCount = Object.keys(cities).length
  const withEmail = results.filter(r => r.email).length
  const withPhone = results.filter(r => r.phone).length

  console.log(`\n── إحصائيات ──`)
  console.log(`  مدن: ${cityCount}`)
  console.log(`  بإيميل: ${withEmail}`)
  console.log(`  بهاتف: ${withPhone}`)

  // Preview
  const show = results.slice(0, 30)
  if (show.length > 0) {
    console.log(`\n── عينة (أول ${show.length}) ──`)
    show.forEach((r, i) => {
      console.log(`${i + 1}. ${r.companyName || "—"}`)
      if (r.email) console.log(`   إيميل: ${r.email}`)
      if (r.phone) console.log(`   هاتف: ${r.phone}`)
      if (r.city) console.log(`   مدينة: ${r.city}`)
      console.log()
    })
  }

  // Save to file
  const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)
  const outDir = "data"
  const csvPath = resolve(outDir, `muqawil_export_${FILTER_CITY || "all"}_${ts}.csv`)
  const header = "companyName\tphone\temail\tcity\tcompanySize\tcontractorType"
  const rows = results.map(r =>
    `${r.companyName || ""}\t${r.phone || ""}\t${r.email || ""}\t${r.city || ""}\t${r.companySize || ""}\t${r.contractorType || ""}`
  )
  writeFileSync(csvPath, header + "\n" + rows.join("\n"), "utf8")
  console.log(`\n✔ ملف CSV: ${csvPath}`)

  if (results.length > show.length) {
    console.log(`\n📌 باقي ${results.length - show.length} سجل — شوف ملف CSV`)
  }
}

// Help
if (ARGS.includes("--help") || ARGS.includes("-h")) {
  console.log(`
الاستخدام:
  node muqawil-leads.mjs [خيارات]

الخيارات:
  --city=الرياض     فلتر حسب المدينة
  --size=small      small|medium|large|micro
  --has-email, -e   فقط اللي عندهم إيميل
  --has-phone, -p   فقط اللي عندهم هاتف
  --limit=50        حد أقصى للنتائج
  --format=table    table|csv|json
  --sort=name       name|city
  --help, -h        التعليمات

أمثلة:
  node muqawil-leads.mjs --city=الرياض --has-email
  node muqawil-leads.mjs --city=جدة --format=csv > leads.csv
  node muqawil-leads.mjs --has-email -e --limit=20 --format=json
`)
}
