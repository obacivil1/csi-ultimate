import { chromium } from "playwright-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
chromium.use(StealthPlugin())

async function main() {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const p = await b.newPage()

  // Search for planning engineer jobs in Saudi
  await p.goto("https://www.expatriates.com/scripts/search/search.epl?q=planning+engineer&category_id=50&region_id=0&ads=1", { waitUntil: "domcontentloaded", timeout: 15000 })
  await new Promise(r => setTimeout(r, 2000))

  // Get full text of search results
  const items = await p.evaluate(() => {
    const results = []
    const links = document.querySelectorAll("a[href*='/cls/'][href$='.html']")
    for (const a of links) {
      if (a.href && !a.href.includes("?") && a.href.endsWith(".html")) {
        const parent = a.closest("li, div, tr") || a.parentElement
        const fullText = parent?.innerText || ""
        const title = a.textContent?.trim() || ""
        
        // Try to find contact info in the full text
        const emailMatch = fullText.match(/[\w.+-]+@[\w-]+\.[\w.]+/g)
        const phoneMatch = fullText.match(/[\+0-9\s\-\(\)]{7,15}/g)
        const cleanPhone = phoneMatch ? phoneMatch.filter(p => p.replace(/[\s\-\(\)]/g, '').length >= 7) : []
        
        results.push({
          title: title.substring(0, 60),
          hasEmail: !!emailMatch,
          emails: emailMatch || [],
          hasPhone: cleanPhone.length > 0,
          phones: cleanPhone || [],
          textPreview: fullText.replace(/\s+/g, ' ').trim().substring(0, 200)
        })
        
        if (results.length >= 5) return results
        // Only show first 5
        if (results.length >= 5) return results
      }
    }
    return results
  })

  console.log("=== Search Results Text Analysis ===")
  items.forEach((item, i) => {
    console.log(`\n--- Item ${i+1}: "${item.title}" ---`)
    console.log(`Email in text? ${item.hasEmail}: ${item.emails.join(', ')}`)
    console.log(`Phone in text? ${item.hasPhone}: ${item.phones.join(', ')}`)
    console.log(`Text: ${item.textPreview}`)
  })

  await b.close()
}

main().catch(console.error)
