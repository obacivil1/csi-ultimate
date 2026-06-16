import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

async function inspectAdPage(name, url) {
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
  })
  const page = await ctx.newPage()

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 })
  await new Promise(r => setTimeout(r, 2000))

  const title = await page.title()
  console.log("  Title: " + title.substring(0, 70))

  // Find ALL text-containing elements that might have price/phone/location/email
  const dataElements = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll(
      'h1, h2, h3, [class*="price"], [class*="Price"], [class*="location"], [class*="Location"], ' +
      '[class*="phone"], [class*="Phone"], [class*="contact"], [class*="Contact"], ' +
      '[class*="detail"], [class*="Detail"], [class*="info"], [class*="Info"], ' +
      '[class*="meta"], [class*="Meta"], [class*="title"], [class*="Title"], ' +
      'span, div[class], p[class]'
    ))
    const seen = new Set()
    const results = []
    for (const el of candidates) {
      const cls = el.className?.substring(0, 80) || ""
      if (seen.has(cls)) continue
      seen.add(cls)
      const text = el.innerText?.trim()?.substring(0, 120)
      if (text && text.length > 2 && text.length < 120) {
        results.push({ tag: el.tagName, class: cls, text })
      }
    }
    return results.slice(0, 40)
  })

  console.log("\n  Key page elements:")
  dataElements.forEach((d, i) => {
    console.log("  " + (i+1) + ". <" + d.tag + (d.class ? ' class="' + d.class.substring(0, 50) + '"' : "") + ">")
    console.log("      " + d.text.substring(0, 80))
  })

  // Look for phone patterns in text
  const allText = await page.evaluate(() => document.body.innerText)
  const phoneMatch = allText.match(/0[0-9]{9,10}/g)
  if (phoneMatch) {
    console.log("\n  Phone numbers: " + [...new Set(phoneMatch)].join(", "))
  }

  // Look for email
  const emailMatch = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)
  if (emailMatch) {
    console.log("  Emails: " + [...new Set(emailMatch)].join(", "))
  }

  await browser.close()
}

// OLX ad page
await inspectAdPage(
  "OLX Ad (iPhone)",
  "https://www.olx.com.pk/item/iphone-17-pro-max-256-jv-deep-blue-iid-1114003424"
)

// OLX ad with phone
await inspectAdPage(
  "OLX Ad (Google Pixel - has phone)",
  "https://www.olx.com.pk/item/official-pta-approved-google-pixel-6-pro-512gp-iid-1114199603"
)

// OpenSooq ad page
await inspectAdPage(
  "OpenSooq Ad (Toyota Yaris)",
  "https://sa.opensooq.com/en/search/282558548"
)

// OpenSooq ad with more details
await inspectAdPage(
  "OpenSooq Ad (Toyota Hilux)",
  "https://sa.opensooq.com/en/search/282503544"
)

console.log("\n\nDONE")
