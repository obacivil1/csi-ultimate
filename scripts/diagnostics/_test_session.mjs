import { chromium } from "playwright-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
chromium.use(StealthPlugin())

async function main() {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const ctx = await b.newContext()
  const p = await ctx.newPage()

  // Step 1: Visit search.epl (works, not blocked)
  await p.goto("https://www.expatriates.com/scripts/search/search.epl?q=planning+engineer&category_id=50&region_id=0&ads=1", { waitUntil: "domcontentloaded", timeout: 15000 })
  await new Promise(r => setTimeout(r, 2000))
  console.log("1. Search page:", await p.title())

  // Step 2: Now try to navigate to a detail page in the SAME session
  await p.goto("https://www.expatriates.com/cls/63509536.html", { waitUntil: "domcontentloaded", timeout: 15000 })
  await new Promise(r => setTimeout(r, 3000))
  const t1 = await p.title()
  const h1 = await p.content()
  console.log("2. Detail page:", t1)
  console.log("   Length:", h1.length)
  console.log("   Blocked?", t1.includes("Just a moment"))

  // Step 3: Try ?print=1 in the same session
  await p.goto("https://www.expatriates.com/cls/63509536.html?print=1", { waitUntil: "domcontentloaded", timeout: 15000 })
  await new Promise(r => setTimeout(r, 3000))
  const t2 = await p.title()
  const h2 = await p.content()
  console.log("3. Print page:", t2)
  console.log("   Length:", h2.length)
  console.log("   Blocked?", t2.includes("Just a moment"))
  console.log("   Has cfemail:", h2.includes("data-cfemail"))
  console.log("   Has phone:", h2.includes("var encoded"))

  await b.close()
}

main().catch(console.error)
