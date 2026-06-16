import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()

await page.goto("https://www.google.com/search?q=planning+engineer+job+Saudi&tbs=qdr:w2", { waitUntil: "domcontentloaded", timeout: 30000 })
await new Promise(r => setTimeout(r, 4000))

console.log("Title:", await page.title())
console.log("URL:", page.url())
const body = await page.evaluate(() => document.body?.innerText?.substring(0, 2000))
console.log("Body:", body)

await browser.close()
