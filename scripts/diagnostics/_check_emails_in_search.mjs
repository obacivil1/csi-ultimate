import { chromium } from "playwright-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
chromium.use(StealthPlugin())

async function main() {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const ctx = await b.newContext()
  const p = await ctx.newPage()

  // Search for planning engineer jobs
  await p.goto("https://www.expatriates.com/scripts/search/search.epl?q=planning+engineer&category_id=50&region_id=0&ads=1", { waitUntil: "domcontentloaded", timeout: 15000 })
  await new Promise(r => setTimeout(r, 2000))

  // Try to "More" links to expand text
  const moreLinks = await p.evaluate(() => {
    const links = [...document.querySelectorAll("a")]
    return links.filter(a => a.textContent?.trim() === "More").map(a => a.href)
  })
  console.log("More links found:", moreLinks.length)
  console.log("First More href:", moreLinks[0])

  // Instead, let's check if the page source has ANY email addresses in the HTML
  const html = await p.content()
  const emails = html.match(/[\w.+-]+@[\w-]+\.[\w.]+/g)
  const uniqueEmails = [...new Set(emails || [])].filter(e => !e.includes('@expatriates') && !e.includes('.png') && !e.includes('.jpg') && !e.includes('.css'))
  console.log("\nEmails in page source:", uniqueEmails.length)
  uniqueEmails.slice(0, 10).forEach(e => console.log(" ", e))

  // Check for base64 encoded phones
  const phones = html.match(/var encoded = '([A-Za-z0-9+/=]+)'/g)
  console.log("\nEncoded phones found:", phones?.length || 0)

  // Now let's check if there are email addresses anywhere in the page text
  const fullText = await p.evaluate(() => document.body.innerText)
  const textEmails = fullText.match(/[\w.+-]+@[\w-]+\.[\w.]+/g)
  const uniqueTextEmails = [...new Set(textEmails || [])].filter(e => !e.includes('@expatriates'))
  console.log("\nEmails in page text:", uniqueTextEmails.length)
  uniqueTextEmails.slice(0, 10).forEach(e => console.log(" ", e))

  await b.close()
}

main().catch(console.error)
