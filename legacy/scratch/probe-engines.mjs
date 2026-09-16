import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 }, locale: "en-US",
})
const page = await ctx.newPage()

const urls = {
  bing: ['https://www.bing.com/search?q=site%3Alinkedin.com%20%22planning%20engineer%22%20Riyadh', 'engines'],
  ddg: ['https://html.duckduckgo.com/html/?q=site%3Alinkedin.com+%22planning+engineer%22+Riyadh', 'engines'],
  google: ['https://www.google.com/search?q=site%3Alinkedin.com+%22planning+engineer%22+Riyadh&tbs=qdr:d', 'engines'],
}
for (const [name, [url, tag]] of Object.entries(urls)) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 })
    await page.waitForTimeout(3000)
    const body = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => "")
    console.log(`\n##### ${name}: `, body.split("\n").filter(l => l.trim()).slice(0, 8).join(" | ").substring(0, 300))
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a"))
        .filter(a => /linkedin\.com/i.test(a.href || ""))
        .map(a => ({ t: (a.innerText || "").replace(/\s+/g, " ").trim().substring(0, 70), h: a.href }))
        .filter(x => x.t)
    ).catch(() => [])
    console.log(`linkedin links: ${links.length}`)
    for (const l of links.slice(0, 5)) console.log("   ", l.t, "=>", l.h.substring(0, 110))
  } catch (e) { console.log(`\n${name} ERR: ${e.message?.substring(0, 80)}`) }
}
await browser.close()