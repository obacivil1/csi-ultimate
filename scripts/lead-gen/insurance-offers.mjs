// Insurance offers runner - reuses the job-hunter anti-bot engine (Session/stealth).
// Goal: collect corporate / group employee insurance (ta2meen afraad alsharikat)
// offers from Saudi classifieds; extract title, price (SAR), type, offer link;
// dedupe; persist JSON + markdown list.
//
//   node scripts/lead-gen/insurance-offers.mjs --budget 360000
//
import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

import { mkdirSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { Session } from "../job-hunter/nav.mjs"
import { extractPhones, extractEmails } from "../job-hunter/contacts.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, "..", "..", "data")
const OUT_JSON = join(DATA_DIR, "insurance_offers_corporate.json")
const OUT_MD = join(DATA_DIR, "insurance_offers_corporate.md")

const ai = process.argv.indexOf("--budget")
const BUDGET_MS = ai === -1 ? 360000 : parseInt(process.argv[ai + 1], 10)

const T = {
  tamin: "\u062A\u0623\u0645\u064A\u0646",
  tamin2: "\u062A\u0627\u0645\u064A\u0646",
  afrad: "\u0623\u0641\u0631\u0627\u062F",
  gamaei: "\u062C\u0645\u0627\u0639\u064A",
  sharikat: "\u0634\u0631\u0643\u0627\u062A",
  sharika: "\u0634\u0631\u0643\u0629",
  moassasa: "\u0645\u0624\u0633\u0633\u0629",
  majmoua: "\u0645\u062C\u0645\u0648\u0639\u0629",
  mozaf: "\u0645\u0648\u0638\u0641",
  monafin: "\u0645\u0648\u0638\u0641\u064A\u0646",
  ommal: "\u0639\u0645\u0627\u0644",
  amel: "\u0639\u0627\u0645\u0644",
  tebi: "\u0637\u0628\u064A",
  sehi: "\u0635\u062D\u064A",
  tab: "\u0637\u0628",
  elaj: "\u0639\u0644\u0627\u062C",
  aref: "\u0627\u0644\u0645\u0633\u062A\u0634\u0641\u0649",
  mustashfa2: "\u0645\u0633\u062A\u0634\u0641\u0649",
  haya: "\u062D\u064A\u0627\u0629",
  wafa: "\u0648\u0641\u0627\u0629",
  markaba: "\u0645\u0631\u0643\u0628\u0629",
  markabat: "\u0645\u0631\u0643\u0628\u0627\u062A",
  sayara: "\u0633\u064A\u0627\u0631\u0629",
  sayarat: "\u0633\u064A\u0627\u0631\u0627\u062A",
  mator: "\u0645\u0648\u062A\u0648\u0631",
  riyal: "\u0631\u064A\u0627\u0644",
  lhs: "\u0631.\u0633",
  med: "\u0645\u064A\u062F\u064A\u0643\u0627\u0644",
  wowakil: "\u0645\u0648\u0643\u0644",
  jareer: "\u062E\u0628\u0631\u062A",
}

const INS_RE = new RegExp(`${T.tamin}|${T.tamin2}|insurance|${T.med}`, "i")
const CORP_RE = new RegExp(`${T.afrad}|${T.gamaei}|${T.sharikat}|${T.sharika}|${T.moassasa}|${T.majmoua}|${T.mozaf}|${T.monafin}|${T.ommal}|${T.amel}|staff|employees|corporate|group|individual`, "i")
const MED_RE = new RegExp(`${T.tebi}|${T.sehi}|${T.tab}|${T.elaj}|${T.med}|medical|health|treatment|${T.mustashfa2}|clinic`, "i")
const LIFE_RE = new RegExp(`${T.haya}|${T.wafa}|life|death`, "i")
const VEH_RE = new RegExp(`${T.markaba}|${T.markabat}|${T.sayara}|${T.sayarat}|${T.mator}|vehicle|auto|car|motor|${T.jareer}`, "i")
const AVOID_RE = new RegExp(`وظيفة|وظائف|توظيف|job|career|تدريب|دورات|courses|training|استقدام|cv|مطلوب`, "i")
const PRICE_RE = new RegExp(
  `(\\d[\\d.,]*)\\s*(${T.riyal}|r\\.?\\s?s|sar|sr|${T.lhs})\\b|(${T.riyal}|sar|sr)\\s*:?\\s*(\\d[\\d.,]*)`,
  "i"
)

function normDigits(s) {
  return String(s)
    .replace(/[\u0660-\u0669]/g, (d) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(d)))
    .replace(/[\u06F0-\u06F9]/g, (d) => String("\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9".indexOf(d)))
}

function extractPrice(text) {
  const norm = normDigits(text)
  const m = PRICE_RE.exec(norm)
  if (m) return `${(m[1] || m[4]).replace(/,/g, "")} ${m[2] || m[3] || "SAR"}`
  const m2 = norm.match(/price\s*:?\s*([\d,.]+)/i)
  return m2 ? `${m2[1].replace(/,/g, "")} (listed)` : ""
}

function classify(text) {
  if (MED_RE.test(text)) return "\u0637\u0628\u064A / Medical"
  if (LIFE_RE.test(text)) return "\u062D\u064A\u0627\u0629 / Life"
  if (CORP_RE.test(text)) return "\u0623\u0641\u0631\u0627\u062F \u0627\u0644\u0634\u0631\u0643\u0627\u062A / Corporate"
  if (VEH_RE.test(text)) return "\u0645\u0631\u0643\u0628\u0627\u062A / Auto"
  return "General"
}

function insLike(text) {
  return INS_RE.test(text) && !AVOID_RE.test(text)
}

function relevant(text) {
  if (!INS_RE.test(text)) return false
  if (AVOID_RE.test(text)) return false
  if (!CORP_RE.test(text) && !MED_RE.test(text) && !extractPrice(text)) return false
  return true
}

async function main() {
  const t0 = Date.now()
  const deadline = Date.now() + BUDGET_MS
  const left = () => deadline - Date.now()
  const out = []
  const seen = new Set()
  const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a)

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    defaultViewport: null,
  })
  const session = new Session(browser)
  await session.freshContext(false)
  log(`budget=${BUDGET_MS}ms start`)

  const add = (rec) => {
    const key = rec.link || rec.title
    if (!key || seen.has(key)) return false
    seen.add(key)
    out.push(rec)
    return true
  }

  async function visitAd(url, src, titleHint) {
    if (left() < 8000) return
    const host = new URL(url).hostname
    const r = await session.go(url, { host, tries: 3 })
    if (!r.ok) return
    const data = await r.page.evaluate(() => {
      const b = document.body ? (document.body.innerText || "") : ""
      return {
        title: (document.querySelector("h1")?.innerText || document.title || "").trim(),
        body: b.substring(0, 6000),
        mailto: Array.from(document.querySelectorAll("a[href^='mailto:']")).map((a) => a.href.replace(/^mailto\s*:\s*/i, "").split("?")[0]),
      }
    }).catch(() => ({ title: "", body: "", mailto: [] }))
    const text = `${data.title} ${data.body}`
    const price = extractPrice(text)
    if (!relevant(text)) return
    const rec = {
      type: classify(text),
      price,
      title: data.title || titleHint,
      link: url,
      source: src,
      phones: extractPhones(text),
      email: [...new Set(data.mailto.concat(extractEmails(data.body)))].filter((e) => !/@expatriates\.(com|net)/i.test(e)),
      ts: Date.now(),
    }
    if (add(rec)) log(`[+] ${src} | ${rec.type} | ${price || "-"} | ${rec.title.slice(0, 60)}`)
  }

  // ---- 1) expatriates.com server-rendered classified categories ----
  const EXPAT = [
    ["riyadh", "medical"], ["riyadh", "business"], ["riyadh", "services"],
    ["jeddah", "medical"], ["dammam", "medical"],
  ]
  for (const [region, cat] of EXPAT) {
    if (left() < 30000) break
    for (let pg = 0; pg < 2; pg++) {
      if (left() < 12000) break
      const url = pg === 0
        ? `https://www.expatriates.com/classifieds/${region}/${cat}/`
        : `https://www.expatriates.com/classifieds/${region}/${cat}/index${pg * 100}.html`
      const r = await session.go(url, { host: "www.expatriates.com", tries: 2 })
      if (!r.ok) { log(`expat/${region}/${cat} pg${pg + 1}: failed`); continue }
      const ads = await r.page.evaluate(() =>
        Array.from(document.querySelectorAll("a"))
          .filter((a) => (a.href || "").includes("/cls/") && a.innerText.trim().length > 3)
          .map((a) => ({ href: a.href, text: a.innerText.replace(/\s+/g, " ").trim() }))
      ).catch(() => [])
      if (!ads.length) { log(`expat/${region}/${cat} pg${pg + 1}: 0 ads -> stop`); break }
      const cand = ads.filter((a) => insLike(a.text))
      log(`expat/${region}/${cat} pg${pg + 1}: ${ads.length} ads, ${cand.length} insurance like`)
      for (const a of cand) {
        if (left() < 6000) break
        if (seen.has(a.href)) continue
        await visitAd(a.href, "expatriates", a.text)
      }
    }
  }

  // ---- 2) haraj.com.sa insurance tag (server-rendered item links) ----
  for (const tag of [T.tamin, `${T.tamin}%20${T.tebi}`, `${T.tamin}%20${T.gamaei}`]) {
    if (left() < 30000) break
    const url = `https://haraj.com.sa/tags/${encodeURIComponent(decodeURIComponent(tag))}`
    const r = await session.go(url, { host: "haraj.com.sa", tries: 2 })
    if (!r.ok) { log(`haraj tag ${tag}: failed`); continue }
    const items = await r.page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({ href: a.href, text: (a.innerText || "").replace(/\s+/g, " ").trim() }))
        .filter((x) => /haraj\.com\.sa\/\d{6,}\//.test(x.href) && x.text.length > 2)
    ).catch(() => [])
    const uniq = [...new Map(items.map((x) => [x.href, x])).values()]
    log(`haraj tag "${tag}": ${uniq.length} items`)
    for (const it of uniq) {
      if (left() < 6000) break
      if (seen.has(it.href)) continue
      if (!insLike(it.text)) continue
      await visitAd(it.href, "haraj", it.text)
    }
  }

  // ---- 3) OpenSooq search - price-rich card blocks (best effort) ----
  const OSO_TERMS = [
    `${T.tamin} ${T.tebi} ${T.monafin}`, // تأمين طبي موظفين
    `${T.tamin} ${T.tebi} ${T.gamaei}`, // تأمين طبي جماعي
    `${T.tamin} ${T.tebi} ${T.sharikat}`, // تأمين طبي شركات
    `${T.tamin} ${T.tebi} ${T.ommal}`, // تأمين طبي عمال
    `${T.tamin} ${T.tebi} ${T.afrad}`, // تأمين طبي أفراد
  ]
  for (const term of OSO_TERMS) {
    if (left() < 45000) break
    const url = `https://sa.opensooq.com/ar/find?search=true&term=${encodeURIComponent(term)}`
    const r = await session.go(url, { host: "sa.opensooq.com", tries: 2 })
    if (!r.ok) { log(`opensooq find ${term}: failed`); continue }
    // poll until cards render
    let ok = false
    for (let w = 0; w < 10 && !ok; w++) {
      await new Promise((res) => setTimeout(res, 1500))
      ok = await r.page.evaluate(() => {
        const t = document.body ? document.body.innerText : ""
        return /دردش/.test(t) && /ريال/.test(t)
      }).catch(() => false)
    }
    if (!ok) { log(`opensooq find "${term}": no rendered cards`); continue }
    await r.page.evaluate(async () => { for (let i = 0; i < 8; i++) { window.scrollBy(0, 1100); await new Promise((res) => setTimeout(res, 500)) } }).catch(() => {})
    await new Promise((res) => setTimeout(res, 1200))
    const blocks = await r.page.evaluate(() => {
      let t = (document.body ? document.body.innerText : "").replace(/\r/g, "")
      t = t.replace(/^[^\n]*?بحث:[^\n]*$/gm, "").replace(/^[^\n]*?تأمين[^\n]*?\(\d+\)[^\n]*$/gm, "")
      const raw = t.split("\u062F\u0631\u062F\u0634") // دردش
      const out = []
      for (const block of raw) {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
        const prices = lines.map((l, i) => (/^\d[\d.,]*\s*(ريال|SR|SAR|ر\.س)\s*$/i.test(l) ? i : -1)).filter((i) => i !== -1)
        if (!prices.length) continue
        const priceI = prices.length === 1 ? prices[0] : prices.find((i) => lines.slice(i + 1, i + 3).join(" ").match(/تأمين|تامين|insurance|ميديكال/i)) ?? prices[0]
        let title = ""
        for (let j = priceI + 1; j < lines.length; j++) {
          const l = lines[j]
          if (/^(مستخدم|نشاط|أمس|اليوم|الرياض|جدة|الدمام|المدينة|مكة|تبوك|خميس|الجبيل|القريب|الخبر)|^$/.test(l) || l.length < 5) continue
          title = l
          break
        }
        if (!title) continue
        if (!/تأمين|تامين|insurance|ميديكال/i.test(title)) continue
        const phone = (lines[priceI + 4] || "").match(/^(\+?\d[\d\s]{7,}\d{2})/) || (lines.find((l) => /^(\+?\d[\d\s]{7,})/.test(l))) || ""
        out.push({ title, price: lines[priceI], area: lines[priceI + 2] || "", cat: lines[priceI + 3] || "", phone: phone ? phone[1] || phone[0] : "" })
      }
      return out
    }).catch(() => [])
    const uniq = [...new Map(blocks.map((b) => [`${b.title}|${b.price}`, b])).values()]
    log(`opensooq find "${term}": ${uniq.length} priced cards`)
    for (const b of uniq) {
      const price = extractPrice(b.price) || b.price
      const rec = {
        type: classify(b.title + " " + b.cat),
        price,
        title: b.title,
        link: url,
        source: "opensooq-search",
        phones: b.phone ? [b.phone] : extractPhones(b.title + " " + b.area),
        ts: Date.now(),
      }
      if (add(rec)) log(`[+] opensooq | ${rec.type} | ${price || "-"} | ${rec.title.slice(0, 60)}`)
    }
  }

  await browser.close().catch(() => {})
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8")

  const md = [
    "# Ta2meen Afraad Alsharikat - insurance offers (corporate / group employees)",
    "",
    `> Generated ${new Date(t0).toISOString()} - budget ${BUDGET_MS}ms - ${out.length} offers`,
    "",
    "| # | Type | Price (SAR) | Title | Link |",
    "|---|------|------------|-------|------|",
    ...out.map((r, i) => `| ${i + 1} | ${r.type} | ${r.price || "-"} | ${r.title.replace(/\|/g, "/").replace(/[\r\n]+/g, " ").slice(0, 90)} | ${r.link} |`),
    "",
  ].join("\n")
  writeFileSync(OUT_MD, md, "utf8")

  console.log("\n=== INSURANCE OFFERS ===")
  for (const [i, r] of out.entries()) {
    console.log(`${i + 1}. [${r.type}] ${r.price || "price-n/a"} - ${r.title}\n   ${r.link}\n`)
  }
  console.log(`[ENGINE] saved ${out.length} offers -> ${OUT_JSON}\n[ENGINE] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

main().catch((e) => { console.error("[ENGINE] FAIL", e?.stack || e); process.exit(1) })