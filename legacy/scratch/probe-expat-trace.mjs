import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const PLANNING_RE = /planning|تخطيط|schedul|planner|controls|مهندس تخطيط|شيتول|التخطيط/i
const CUTOFF = Date.now() - 2 * 24 * 60 * 60 * 1000
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }
function parseDate(text) {
  if (!text) return null
  const clean = text.replace(/\s+/g, " ").trim()
  if (/\btoday\b/i.test(clean)) return Date.now()
  if (/\byesterday\b/i.test(clean)) return Date.now() - 86400000
  let r = clean.match(/(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/i)
  if (!r) r = clean.match(/([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/i)
  if (r) { const ms = r[1].substring(0,3).toLowerCase(); if (MONTHS[ms] !== undefined) return new Date(+r[3], MONTHS[ms], +r[2]).getTime() }
  r = clean.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/)
  if (r) { const ms = r[2].substring(0,3).toLowerCase(); if (MONTHS[ms] !== undefined) return new Date(+r[3], MONTHS[ms], +r[1]).getTime() }
  return null
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 }, locale: "en-US",
})
const page = await ctx.newPage()

const collected = []
for (const category of ["jobs", "temp-jobs"]) {
  for (let pg = 0; pg < 6; pg++) {
    const url = pg === 0
      ? `https://www.expatriates.com/classifieds/riyadh/${category}/`
      : `https://www.expatriates.com/classifieds/riyadh/${category}/index${pg * 100}.html`
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 })
      await page.waitForTimeout(2000)
      const cls = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a"))
          .filter(a => (a.href || "").includes("/cls/") && a.innerText.trim().length > 3)
          .map(a => ({ text: (a.innerText || "").replace(/\s+/g, " ").trim(), href: a.href }))
      ).catch(() => [])
      if (cls.length === 0) { console.log(`pg${pg + 1} EMPTY (${category})`); continue }
      const planning = cls.filter(a => PLANNING_RE.test(a.text))
      console.log(`pg${pg + 1} (${category}): ${cls.length} ads, ${planning.length} planning`)
      collected.push(...planning)
    } catch (e) { console.log(`pg${pg + 1} ERR (${category}): ${e.message?.substring(0, 40)}`) }
  }
}

const unique = []
const seen = new Set()
for (const a of collected) if (!seen.has(a.href)) { seen.add(a.href); unique.push(a) }
console.log(`\nPLANNING ADS: ${unique.length}`)

for (const ad of unique) {
  try {
    await page.goto(ad.href, { waitUntil: "domcontentloaded", timeout: 40000 })
    await page.waitForTimeout(2000)
    const data = await page.evaluate(() => {
      const body = document.body?.innerText || ""
      const dm = body.match(/Posted:\s*(.+)/)
      const mailto = Array.from(document.querySelectorAll("a[href^='mailto:']")).map(a => (a.href.replace(/^mailto:\s*/i, "").split("?")[0]).trim()) || []
      const tel = Array.from(document.querySelectorAll("a[href^='tel:']")).map(a => a.href.replace("tel:", "")) || []
      const regM = body.match(/Region:\s*(.+)/)
      const catM = body.match(/Category:\s*(.+)/)
      return { title: document.querySelector("h1")?.innerText?.trim() || "", date: dm ? dm[1].trim() : "", region: regM?.[1]?.trim() || "", category: catM?.[1]?.trim() || "", mailto, tel, body: body.substring(0, 1200) }
    })
    const ts = parseDate(data.date)
    const inWin = ts !== null && ts >= CUTOFF
    console.log(`\n--- ${ad.href}`)
    console.log(`  title: ${data.title}`)
    console.log(`  date: "${data.date}" ts=${ts} review=${inWin}`)
    console.log(`  region: "${data.region}" riyadh=${/riyadh|الرياض/i.test(data.region)}`)
    console.log(`  category: "${data.category}"`)
    console.log(`  emails: ${data.mailto.join("; ") || "(none in mailto)"}`)
    console.log(`  phones: ${data.tel.join(", ") || "(none)"}`)
  } catch (e) { console.log(`ERR ${ad.href}: ${e.message?.substring(0, 50)}`) }
}
await browser.close()