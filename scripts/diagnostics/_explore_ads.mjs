import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

async function explore(name, url, adCardSelector) {
  console.log("\n" + "=".repeat(70))
  console.log("  " + name)
  console.log("  URL: " + url)
  console.log("=".repeat(70))

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  })
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
  })
  const page = await ctx.newPage()

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
  await new Promise(r => setTimeout(r, 4000))

  const title = await page.title()
  console.log("  Title: " + title.substring(0, 70))

  // Try scrolling
  await page.evaluate(() => window.scrollTo(0, 500))
  await new Promise(r => setTimeout(r, 2000))
  await page.evaluate(() => window.scrollTo(0, 1000))
  await new Promise(r => setTimeout(r, 2000))

  // Check all ad card elements
  if (adCardSelector) {
    const cards = await page.$$eval(adCardSelector, els =>
      els.slice(0, 15).map(el => {
        const links = Array.from(el.querySelectorAll("a"))
        return {
          tag: el.tagName,
          text: el.innerText?.trim()?.substring(0, 100),
          links: links.map(l => ({ href: l.href, text: l.innerText?.trim()?.substring(0, 50) })),
        }
      })
    )
    console.log("\n  Ad cards (" + adCardSelector + "): " + cards.length)
    cards.forEach((c, i) => {
      console.log("  Card " + (i+1) + ": " + c.text.substring(0, 60))
      c.links.forEach((l, j) => {
        const shortHref = l.href.length > 90 ? l.href.substring(0, 90) + "..." : l.href
        console.log("    Link " + (j+1) + ": " + shortHref + " [" + l.text.substring(0, 30) + "]")
      })
    })
  }

  // Also look for any href with ID patterns
  const idLinks = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("a[href]"))
    const seen = new Set()
    return all
      .filter(a => {
        const h = a.href
        if (!h || seen.has(h)) return false
        seen.add(h)
        return true
      })
      .map(a => ({ href: a.href, text: a.innerText?.trim()?.substring(0, 50) }))
      .filter(a => {
        // Look for IDs, numbers, or deep paths
        const path = a.href.replace(/https?:\/\/[^\/]+/, "")
        return /\d{5,}/.test(path) || path.split("/").filter(Boolean).length >= 4
      })
  })

  console.log("\n  Ad-like links (with IDs or deep paths): " + idLinks.length)
  idLinks.slice(0, 15).forEach((a, i) => {
    const shortHref = a.href.length > 90 ? a.href.substring(0, 90) + "..." : a.href
    console.log("    " + (i+1) + ". " + shortHref + " [" + a.text.substring(0, 40) + "]")
  })

  await browser.close()
}

// OLX - use the ad card class from previous inspection
await explore("OLX_PK", "https://www.olx.com.pk/", "article._84ba2e24")

// OpenSooq Toyota - look at the car listing cards
await explore("OpenSooq_Toyota", "https://sa.opensooq.com/en/cars/cars-for-sale/toyota", null)

console.log("\n\nDONE")
