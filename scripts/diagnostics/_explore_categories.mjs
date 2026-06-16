import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

async function exploreCategories() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    viewport: { width: 1920, height: 1080 }
  })
  const page = await ctx.newPage()

  // ─── EXPATRIATES ───
  console.log("=== EXPATRIATES.COM ===")
  await page.goto("https://www.expatriates.com/classifieds/riyadh/", { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, 3000))
  console.log("Title: " + (await page.title()).substring(0, 60))
  const expLinks = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("a[href*='/classifieds/riyadh/']"))
    const seen = new Set()
    return all
      .map(a => ({ href: a.href, text: a.innerText?.trim()?.substring(0, 60) }))
      .filter(a => a.text.length > 2 && !seen.has(a.href) && seen.add(a.href))
  })
  console.log("Riyadh categories:")
  expLinks.forEach((l, i) => console.log("  " + (i+1) + ". " + l.text.substring(0, 50) + " | " + l.href.substring(0, 70)))

  // ─── GUMTREE ───
  console.log("\n=== GUMTREE.COM ===")
  await page.goto("https://www.gumtree.com/", { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, 3000))
  console.log("Title: " + (await page.title()).substring(0, 60))
  const gumLinks = await page.evaluate(() => {
    const seen = new Set()
    return Array.from(document.querySelectorAll("a[href]"))
      .map(a => ({ href: a.href, text: a.innerText?.trim()?.substring(0, 60) }))
      .filter(a => a.href && a.text.length > 2 && a.href.includes("gumtree.com") && !a.href.includes("facebook") && !seen.has(a.href) && seen.add(a.href))
  })
  // Show category-like links
  const gumCats = gumLinks.filter(l => {
    const u = l.href.replace("https://www.gumtree.com", "")
    return u.split("/").filter(Boolean).length === 1 && u.length > 1 && u.length < 30
  })
  console.log("Top-level categories:")
  gumCats.forEach((l, i) => console.log("  " + (i+1) + ". " + l.text.substring(0, 40) + " | " + l.href.substring(0, 60)))

  // ─── OLX ───
  console.log("\n=== OLX.COM.PK ===")
  await page.goto("https://www.olx.com.pk/", { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, 3000))
  console.log("Title: " + (await page.title()).substring(0, 60))
  const olxLinks = await page.evaluate(() => {
    const seen = new Set()
    return Array.from(document.querySelectorAll("a[href]"))
      .map(a => ({ href: a.href, text: a.innerText?.trim()?.substring(0, 60) }))
      .filter(a => a.href && a.text.length > 2 && a.href.includes("olx.com.pk") && !a.href.includes("item/") && !seen.has(a.href) && seen.add(a.href))
  })
  const olxCats = olxLinks.filter(l => {
    const u = l.href.replace("https://www.olx.com.pk", "")
    return u.includes("_c") && u.split("/").filter(Boolean).length <= 2
  }).slice(0, 20)
  console.log("Categories:")
  olxCats.forEach((l, i) => console.log("  " + (i+1) + ". " + l.text.substring(0, 40) + " | " + l.href.substring(0, 70)))

  // ─── OPENSOOQ ───
  console.log("\n=== SA.OPENSOOQ.COM ===")
  await page.goto("https://sa.opensooq.com/en", { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, 3000))
  console.log("Title: " + (await page.title()).substring(0, 60))
  const osLinks = await page.evaluate(() => {
    const seen = new Set()
    return Array.from(document.querySelectorAll("a[href*='/en/']"))
      .map(a => ({ href: a.href, text: a.innerText?.trim()?.substring(0, 60) }))
      .filter(a => a.href && a.text.length > 2 && !seen.has(a.href) && seen.add(a.href))
  })
  const osCats = osLinks.filter(l => {
    const u = l.href.replace("https://sa.opensooq.com", "")
    return u.split("/").filter(Boolean).length === 2 && !u.includes("search")
  }).slice(0, 20)
  console.log("Main categories:")
  osCats.forEach((l, i) => console.log("  " + (i+1) + ". " + l.text.substring(0, 40) + " | " + l.href.substring(0, 70)))

  await browser.close()
}
exploreCategories().catch(e => console.log("ERROR: " + e.message))
