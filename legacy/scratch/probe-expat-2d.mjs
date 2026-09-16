import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 }, locale: "en-US",
})
const page = await ctx.newPage()

for (const url of [
  "https://www.expatriates.com/classifieds/riyadh/jobs/",
  "https://www.expatriates.com/classifieds/riyadh/temp-jobs/",
]) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 })
    await page.waitForTimeout(2500)
    const cls = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a"))
        .filter(a => (a.href || "").includes("/cls/") && a.innerText.trim().length > 3)
        .map(a => ({ text: (a.innerText || "").replace(/\s+/g, " ").trim(), href: a.href }))
    ).catch(() => [])
    console.log(`\n##### ${url}  -> ${cls.length} ads`)
    for (const a of cls.slice(0, 12)) console.log("  ", a.href.split("/cls/")[1], "|", a.text.substring(0, 90))
  } catch (e) {
    console.log(url, "ERR", e.message?.substring(0, 80))
  }
}
await browser.close()