import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"

chromium.use(stealth())

async function inspect(url) {
  const targetUrl = url || "https://www.olx.in/items/q-jobs/"
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })
  const page = await browser.newPage()
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 })

  const info = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a[href]"))
    const listingLinks = links.filter(l => l.href.includes("/item/") || l.href.includes("/job/") || l.href.includes("-ID"))
    return {
      totalLinks: links.length,
      listingUrls: listingLinks.slice(0, 15).map(l => l.href),
      listingClasses: listingLinks.slice(0, 3).map(l => l.className),
      pageTitle: document.title,
      bodyPreview: document.body.innerText.substring(0, 200),
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await browser.close()
}

inspect(process.argv[2]).catch(e => { console.error(e.message); process.exit(1) })
