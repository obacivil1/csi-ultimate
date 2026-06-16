import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

// Quick check: ID extraction for OLX and location fix for OpenSooq
async function diagnose(name, url) {
  console.log("\n" + "=".repeat(70))
  console.log("  " + name)
  console.log("=".repeat(70))

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  })
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1920, height: 1080 } })
  const page = await ctx.newPage()

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 })
  await new Promise(r => setTimeout(r, 2000))

  // Test ID extraction from URL
  const urlIdMatch = url.match(/-iid-(\d+)$/)
  console.log("  URL ID from -iid-: " + (urlIdMatch ? urlIdMatch[1] : "NO MATCH"))

  // Test ID extraction from page title
  const title = await page.title()
  const titleIdMatch = title.match(/- (\d+)$/)
  console.log("  Page title: " + title.substring(0, 60))
  console.log("  Title ID: " + (titleIdMatch ? titleIdMatch[1] : "NO MATCH"))

  // Find ALL elements with class _8206696c (location)
  const locationElements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("span._8206696c"))
      .map(el => ({
        text: el.innerText?.trim()?.substring(0, 60),
        fullClass: el.className,
        parentClass: el.parentElement?.className?.substring(0, 60),
      }))
  })
  console.log("\n  span._8206696c elements:")
  locationElements.forEach((el, i) => {
    console.log("    " + (i+1) + '. "' + el.text + '" class="' + el.fullClass + '" parent="' + el.parentClass + '"')
  })

  // Find price element
  const priceElements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("span._24469da7"))
      .map(el => ({
        text: el.innerText?.trim()?.substring(0, 60),
        fullClass: el.className,
        parentClass: el.parentElement?.className?.substring(0, 60),
      }))
  })
  console.log("\n  span._24469da7 elements:")
  priceElements.forEach((el, i) => {
    console.log("    " + (i+1) + '. "' + el.text + '"')
  })

  await browser.close()
}

// Test with the iPhone ad (which had good location data)
await diagnose("OLX - iPhone Pro Max", "https://www.olx.com.pk/item/iphone-17-pro-max-256-jv-deep-blue-iid-1114003424")

// Test with the car ad
await diagnose("OLX - Honda Civic", "https://www.olx.com.pk/item/honda-civic-vti-oriel-ug-prosmatec-18-2011-iid-1115308651")

// Test Pixel ad (had good price and phone)
await diagnose("OLX - Pixel", "https://www.olx.com.pk/item/official-pta-approved-google-pixel-6-pro-512gp-iid-1114199603")

console.log("\n\nDONE")
