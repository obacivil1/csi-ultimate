import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

async function inspectPage(name, url, waitMs, scroll) {
  console.log("\n" + "=".repeat(70))
  console.log("  " + name)
  console.log("  URL: " + url)
  console.log("=".repeat(70))

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-web-security"],
  })
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
  })
  const page = await ctx.newPage()

  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 })
  await new Promise(r => setTimeout(r, waitMs || 3000))

  if (scroll) {
    for (let i = 0; i < scroll; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await new Promise(r => setTimeout(r, 1500))
    }
    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0))
    await new Promise(r => setTimeout(r, 1000))
  }

  const title = await page.title()
  const isBlocked = title.toLowerCase().includes("just a moment") || title.toLowerCase().includes("captcha")
  console.log("  Title: " + title.substring(0, 70))
  console.log("  Blocked: " + isBlocked)

  if (isBlocked) {
    console.log("  [BLOCKED]")
    await browser.close()
    return
  }

  // Inspect all link patterns
  const linkData = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("a[href]"))
    const links = all.map(a => ({
      href: a.href,
      text: a.innerText?.trim()?.substring(0, 60),
      class: (a.className || "").substring(0, 60),
      id: a.id,
      parentClass: a.parentElement?.className?.substring(0, 40) || "",
    }))
    // Deduplicate by href
    const seen = new Set()
    return links.filter(l => {
      if (seen.has(l.href)) return false
      seen.add(l.href)
      return true
    })
  })

  console.log("  Unique links: " + linkData.length)

  // Show all distinct path patterns
  const patterns = {}
  for (const l of linkData) {
    try {
      const u = new URL(l.href)
      if (u.hostname.includes(url.split("/")[2])) {
        const path = u.pathname
        const parts = path.split("/").filter(Boolean)
        const key = parts.slice(0, Math.min(parts.length, 4)).join("/")
        patterns[key] = (patterns[key] || 0) + 1
      }
    } catch (e) {}
  }
  console.log("\n  Top 20 URL patterns:")
  Object.entries(patterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([p, c]) => console.log("    " + p + " (" + c + ")"))

  // For each ad-like URL pattern, show first few examples
  const longPaths = linkData.filter(l => {
    try {
      const u = new URL(l.href)
      return u.pathname.split("/").filter(Boolean).length >= 4
    } catch (e) { return false }
  })
  if (longPaths.length > 0) {
    console.log("\n  Deepest paths (potential ads):")
    longPaths.slice(0, 10).forEach(l => {
      try {
        const u = new URL(l.href)
        console.log("    " + u.pathname.substring(0, 70) + " [" + l.text.substring(0, 40) + "]")
      } catch (e) {}
    })
  }

  // Show HTML structure for the page
  const structure = await page.evaluate(() => {
    // Find elements that look like ad cards
    const potentialCards = document.querySelectorAll(
      '[class*="card"], [class*="listing"], [class*="item"], [class*="ad"], [class*="post"], [data-testid*="ad"], article, [class*="result"]'
    )
    const result = []
    for (const el of potentialCards) {
      const tag = el.tagName.toLowerCase()
      const cls = el.className?.substring(0, 80) || ""
      const links = el.querySelectorAll("a")
      const firstLink = links[0]?.href || ""
      const hasPrice = !!el.querySelector('[class*="price"], [class*="Price"]')
      const hasImg = !!el.querySelector("img")
      result.push({ tag, class: cls, links: links.length, hasPrice, hasImg, link: firstLink.substring(0, 80) })
    }
    return result.slice(0, 20)
  })
  console.log("\n  Potential ad card elements:")
  structure.forEach(s => {
    console.log("    <" + s.tag + (s.class ? ' class="' + s.class.substring(0, 60) + '"' : "") + "> links:" + s.links + " price:" + s.hasPrice + " img:" + s.hasImg)
  })

  await page.screenshot({ path: `E:\\N8N\\scraper\\scraper2\\csi-ultimate\\verification\\site-test\\${name.replace(/[^a-z0-9]/gi, "_")}.png`, fullPage: false }).catch(() => {})
  await browser.close()
}

// OLX - wait longer and scroll
await inspectPage("OLX_PK", "https://www.olx.com.pk/", 5000, 3)

// OpenSooq Toyota listing - find individual ad cards
await inspectPage("OpenSooq_Toyota", "https://sa.opensooq.com/en/cars/cars-for-sale/toyota", 3000, 0)

console.log("\n\nDONE")
