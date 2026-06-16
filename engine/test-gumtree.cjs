const { chromium } = require("playwright-extra")
const stealth = require("puppeteer-extra-plugin-stealth")
chromium.use(stealth())

async function main() {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const p = await b.newPage()
  await p.goto("https://www.gumtree.com/jobs", { waitUntil: "domcontentloaded", timeout: 30000 })
  const n = await p.evaluate(() => document.querySelectorAll('a[href*="/p/"]').length)
  console.log("count:", n)
  if (n > 0) {
    const hrefs = await p.evaluate(() => Array.from(document.querySelectorAll('a[href*="/p/"]')).slice(0, 5).map(a => a.href))
    console.log(JSON.stringify(hrefs))
  }
  await b.close()
}
main().catch(e => { console.error(e.message); process.exit(1) })
