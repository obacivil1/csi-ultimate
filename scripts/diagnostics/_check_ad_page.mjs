import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  viewport: { width: 1920, height: 1080 },
})
const page = await ctx.newPage()

await page.goto("https://www.expatriates.com/cls/63475155.html", { waitUntil: "domcontentloaded", timeout: 20000 })
await new Promise(r => setTimeout(r, 2000))
console.log("Title:", await page.title())

const info = await page.evaluate(() => {
  const body = document.body?.innerText || ""
  const dateMatch = body.match(/\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/gi)
  const phoneEl = document.querySelector("a[href^='tel:']")
  const emailEl = document.querySelector("a[href^='mailto:']")
  const title = document.querySelector("h1")?.innerText?.trim() || ""
  const desc = document.querySelector("[class*='description' i], [class*='body' i], .content")?.innerText?.trim() || ""
  return {
    title, phone: phoneEl?.href?.replace("tel:", "") || "",
    email: emailEl?.href?.replace("mailto:", "") || "",
    dates: dateMatch, descLength: desc.length, bodyLength: body.length,
    bodyPreview: body.substring(0, 2000),
  }
})
console.log(JSON.stringify(info, null, 2))

await browser.close()
