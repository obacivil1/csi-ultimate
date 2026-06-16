import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  viewport: { width: 1280, height: 800 }
})
const page = await context.newPage()

const categoryUrl = "https://www.preloved.co.uk/adverts/list?sectionId=44"
const selector = "a[href*='/adverts/show/']"

// Try 3 times to see if behavior is consistent
for (let attempt = 0; attempt < 3; attempt++) {
  console.log(`\n=== Attempt ${attempt+1} ===`)
  
  // Use a fresh page to avoid cached state
  const p = await context.newPage()
  
  await p.goto(categoryUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
  console.log("URL:", p.url())
  console.log("Title:", await p.title())
  
  // Wait for content to load
  await p.waitForTimeout(3000)
  
  const links = await p.$$eval(selector, els => 
    els.map(el => el.href || el.closest("a")?.href).filter(Boolean)
  )
  const unique = [...new Set(links)]
  console.log(`Links: ${unique.length} unique from ${links.length} total`)
  if (unique.length > 0) {
    console.log("First 3:", JSON.stringify(unique.slice(0, 3)))
  }
  
  // Also check if redirect happened
  if (p.url() !== categoryUrl) {
    console.log("Redirected to:", p.url())
  }
  
  await p.close()
}

await browser.close()
