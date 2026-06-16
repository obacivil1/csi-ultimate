import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"

chromium.use(stealth())

const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)

async function testSite(name, listingUrl, adSelector, siteConfig) {
  console.log("\n" + "=".repeat(70))
  console.log("  " + name)
  console.log("  URL: " + listingUrl)
  console.log("=".repeat(70))

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-web-security"],
  })
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
  })
  const page = await ctx.newPage()
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  })

  const resp = await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
  const httpStatus = resp ? resp.status() : null

  // Handle Cloudflare challenge - wait and check again
  await new Promise(r => setTimeout(r), 5000)

  let title = await page.title()
  let isBlocked = title.toLowerCase().includes("just a moment") || title.toLowerCase().includes("captcha")

  if (isBlocked) {
    // Try waiting longer
    console.log("  Cloudflare detected. Waiting 10s for challenge...")
    await new Promise(r => setTimeout(r), 10000)
    title = await page.title()
    isBlocked = title.toLowerCase().includes("just a moment") || title.toLowerCase().includes("captcha")
  }

  console.log("  HTTP: " + httpStatus)
  console.log("  Title: " + title.substring(0, 80))
  console.log("  Blocked: " + isBlocked)

  if (isBlocked) {
    const ssPath = resolve(__dirname, "verification", "site-test", name.replace(/\./g, "_") + "_blocked.png")
    await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {})
    console.log("  Screenshot: " + ssPath)
    await browser.close()
    return { blocked: true, httpStatus, title }
  }

  // Find links
  await new Promise(r => setTimeout(r, 2000))
  const rawLinks = await page.$$eval(adSelector, els =>
    els.map(el => ({ href: el.href, text: el.innerText?.trim()?.substring(0, 80) }))
      .filter(a => a.href && a.text.length > 5)
  ).catch(() => [])

  console.log("  Ad links found: " + rawLinks.length)
  if (rawLinks.length === 0) {
    console.log("  [NO ADS - wrong selector or dynamic content]")
    await browser.close()
    return { blocked: false, linksFound: 0 }
  }

  rawLinks.slice(0, 5).forEach((a, i) => {
    console.log("    " + (i+1) + ". " + a.text.substring(0, 50) + " | " + a.href.substring(0, 80))
  })

  // Extract from first 3 ads
  for (let i = 0; i < Math.min(3, rawLinks.length); i++) {
    const adUrl = rawLinks[i].href
    console.log("\n  [AD " + (i+1) + "] " + adUrl.substring(0, 80))
    try {
      await page.goto(adUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
      await new Promise(r => setTimeout(r, 2000))
      const adTitle = await page.title()
      console.log("  Title: " + adTitle.substring(0, 60))

      const data = await CE.extractAdData(page, siteConfig, { url: adUrl })
      console.log("    ID:       " + (data.id || "N/A"))
      console.log("    Title:    " + (data.title || "N/A").substring(0, 40))
      console.log("    Price:    " + (data.price || "N/A") + " " + (data.currency || ""))
      console.log("    Phone:    " + (data.phone || "N/A"))
      console.log("    Email:    " + (data.email || "N/A"))
      console.log("    Location: " + (data.location || "N/A"))
    } catch (e) {
      console.log("  ERROR: " + (e.message || "").substring(0, 100))
    }
  }

  await browser.close()
  return { blocked: false, linksFound: rawLinks.length }
}

// ─── OLX.COM.PK ───
await testSite(
  "olx.com.pk",
  "https://www.olx.com.pk/",
  "a[href*='/item/'][href*='-iid-']",
  {
    hostname: "olx.com.pk",
    selectors: {
      title: ["h1", "[class*='title']"],
      phone: ["a[href^='tel:']"],
      email: ["a[href^='mailto:']"],
      location: ["[class*='location']", "[class*='_95eae']"],
      price: ["[class*='price']"],
    },
    extraction: { phoneRegion: "PK", countryCodes: [92], currencies: ["PKR"] },
  }
)

// ─── SA.OPENSOOQ.COM — go to actual ad link level ───
await testSite(
  "sa.opensooq.com (cars/toyota)",
  "https://sa.opensooq.com/en/cars/cars-for-sale/toyota",
  "a[href*='/en/']:not([href*='/en/cars/cars-for-sale/']):not([href='/en/'])",
  {
    hostname: "sa.opensooq.com",
    selectors: {
      title: ["h1", ".post-title", "[class*='title']"],
      phone: ["a[href^='tel:']", "[class*='phone']"],
      email: ["a[href^='mailto:']"],
      location: ["[class*='location']", ".post-address"],
      price: ["[class*='price']", ".post-price"],
    },
    extraction: { phoneRegion: "SA", countryCodes: [966], currencies: ["SAR"], adIdPattern: "[/-](\\d+)" },
  }
)

console.log("\n\nDONE")
