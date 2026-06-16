import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { writeFileSync } from "fs"

chromium.use(stealth())

const ARGS = process.argv.slice(2)
const JOB = ARGS.find(a => a.startsWith("--job="))?.split("=")[1] || "engineer"
const CITY = ARGS.find(a => a.startsWith("--city="))?.split("=")[1] || "riyadh"
const PAGES = parseInt(ARGS.find(a => a.startsWith("--pages="))?.split("=")[1] || "10")

const BATCH_SIZE = 5  // how many detail pages before fresh context
let ctxNum = 0

function newContext(browser) {
  ctxNum++
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  return browser.newContext({ userAgent: ua + `_ctx${ctxNum}`, viewport: { width: 1920, height: 1080 } })
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
let ctx = await newContext(browser)
let page = await ctx.newPage()

const results = []
const seen = new Set()
let batchCount = 0

async function isCloudflared() {
  const title = await page.title()
  return title.includes("Just a moment") || title.includes("Security")
}

async function refreshContext() {
  await ctx.close().catch(() => {})
  ctx = await newContext(browser)
  page = await ctx.newPage()
  batchCount = 0
  console.log(`  [fresh context #${ctxNum}]`)
}

async function extractOne(url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 })
    await new Promise(r => setTimeout(r, 2000))
    if (await isCloudflared()) {
      console.log("  ☁️ Cloudflare — refreshing context...")
      await refreshContext()
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 })
      await new Promise(r => setTimeout(r, 3000))
      if (await isCloudflared()) {
        console.log("  ☁️ Still blocked, skipping")
        return null
      }
    }
    return await page.evaluate(() => {
      const body = document.body?.innerText || ""
      const emails = (body.match(/[\w.-]+@[\w.-]+\.\w+/g) || []).filter(e =>
        !e.includes("expatriates.com") && !e.includes("example") && !e.includes(".png") && !e.includes(".jpg")
      )
      const phoneEl = document.querySelector("a[href^='tel:']")
      const dm = body.match(/Posted:\s*(.+)/)
      return {
        title: document.querySelector("h1")?.innerText?.trim() || "",
        email: emails[0] || "",
        phone: phoneEl?.href?.replace("tel:", "") || "",
        region: (body.match(/Region:\s*(.+)/) || [])[1]?.trim() || "",
        date: dm ? dm[1].trim() : "",
      }
    })
  } catch (e) {
    console.log(`  x ${e.message?.substring(0, 60)}`)
    return null
  }
}

// ── Search list pages ──
const baseUrl = `https://www.expatriates.com/classifieds/${CITY}/job-seekers/`
const KEYWORDS = new RegExp(
  JOB.replace(/\s+/g, "|") +
  "|مهندس|engineer|planning|planner|site|civil|mechanical|electrical|structural|qa.?qc|hse|safety|construction|architect|surveyor|supervisor|foreman|technician|inspector|manager|designer",
  "i"
)
const EXCLUDED = /driver|cook|cleaner|sales|cashier|waiter|receptionist|secretary|nurse|teacher|guard|helper|butcher|baker|accountant/i

for (let pg = 0; pg < PAGES; pg++) {
  const url = pg === 0 ? baseUrl : baseUrl.replace(/\/?$/, `/index${pg * 100}.html`)
  console.log(`\nPage ${pg + 1}...`)
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    await new Promise(r => setTimeout(r, 2000))
  } catch { break }

  const ads = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href*='/cls/']"))
      .map(a => ({ href: a.href, text: a.innerText?.trim() }))
      .filter(a => !a.href.includes("search.epl") && a.text?.length > 5)
  )
  if (!ads.length) break

  const match = ads.filter(a => KEYWORDS.test(a.text) && !EXCLUDED.test(a.text))
  console.log(`  Ads: ${ads.length}, Match: ${match.length}`)

  for (const ad of match) {
    if (seen.has(ad.href)) continue
    seen.add(ad.href)
    batchCount++

    if (batchCount > BATCH_SIZE) {
      await refreshContext()
    }

    const data = await extractOne(ad.href)
    if (data && (data.email || data.phone)) {
      results.push({ ...data, url: ad.href, source: "Expatriates" })
      console.log(`  ✓ ${data.title?.substring(0, 35)} | ${data.email || data.phone}`)
    } else if (data) {
      // silently skip
    }
  }

  const next = await page.evaluate(() => {
    const n = Array.from(document.querySelectorAll("a")).find(a => /next/i.test(a.innerText))
    return n?.href || null
  })
  if (!next) break
}

await browser.close()

// Dedup
const deduped = []
const keySet = new Set()
for (const r of results) {
  const key = r.email || r.phone
  if (key && !keySet.has(key)) { keySet.add(key); deduped.push(r) }
}

const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)
const path = `data/leads_${JOB}_${CITY}_${ts}.json`
writeFileSync(path, JSON.stringify({ total: deduped.length, results: deduped }, null, 2))
console.log(`\n✔ ${deduped.length} leads → ${path}`)

if (deduped.length) {
  console.log("\n── Emails ──")
  deduped.forEach(r => { if (r.email) console.log(r.email) })
}
