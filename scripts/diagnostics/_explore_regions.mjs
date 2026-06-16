import { chromium } from "playwright-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
chromium.use(StealthPlugin())

async function main() {
  const b = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
  const p = await b.newPage()

  // Check Qatar Jobs page
  await p.goto("https://www.expatriates.com/classifieds/qatar/jobs/", { waitUntil: "domcontentloaded", timeout: 15000 })
  await new Promise(r => setTimeout(r, 2000))
  const qForm = await p.evaluate(() => {
    return [...document.querySelectorAll("form")].map(f => ({
      action: f.action,
      inputs: [...f.querySelectorAll("input, select")].map(el => ({
        name: el.name || el.getAttribute("name") || "",
        value: el.value || ""
      }))
    }))
  })
  console.log("=== QATAR JOBS ===")
  console.log("URL:", p.url())
  console.log("Title:", await p.title())
  qForm.forEach((f, i) => {
    console.log(`Form ${i}: action=${f.action}`)
    f.inputs.forEach(inp => console.log(`  name="${inp.name}" value="${inp.value}"`))
  })

  // Check Dubai Jobs page
  await p.goto("https://www.expatriates.com/classifieds/dubai/jobs/", { waitUntil: "domcontentloaded", timeout: 15000 })
  await new Promise(r => setTimeout(r, 2000))
  const dForm = await p.evaluate(() => {
    return [...document.querySelectorAll("form")].map(f => ({
      action: f.action,
      inputs: [...f.querySelectorAll("input, select")].map(el => ({
        name: el.name || el.getAttribute("name") || "",
        value: el.value || ""
      }))
    }))
  })
  console.log("\n=== DUBAI JOBS ===")
  console.log("URL:", p.url())
  dForm.forEach((f, i) => {
    console.log(`Form ${i}: action=${f.action}`)
    f.inputs.forEach(inp => console.log(`  name="${inp.name}" value="${inp.value}"`))
  })

  // Try searching with "Riyadh" keyword to see if region filtering works
  // Let's also check what the search page looks like when we add location
  await p.goto("https://www.expatriates.com/scripts/search/search.epl?q=planning+engineer+Riyadh&category_id=50&region_id=0&ads=1", { waitUntil: "domcontentloaded", timeout: 15000 })
  await new Promise(r => setTimeout(r, 2000))
  console.log("\n=== SEARCH with 'Riyadh' keyword ===")
  console.log("URL:", p.url())
  const entries = await p.evaluate(() => {
    const items = document.querySelectorAll("a[href*='/cls/'][href$='.html']")
    const result = []
    for (const a of items) {
      const h = a.href
      if (h && !h.includes("?") && h.endsWith(".html")) {
        const parent = a.closest("li, div, tr") || a.parentElement
        const text = parent?.innerText || ""
        const title = a.textContent?.trim()?.substring(0, 60) || ""
        if (text.toLowerCase().includes("riyadh") || title.toLowerCase().includes("riyadh")) {
          result.push({ title, loc: text.substring(0, 80) })
          if (result.length >= 5) break
        }
      }
    }
    return result
  })
  console.log("Riyadh entries:", entries.length)
  entries.forEach((e, i) => console.log(`  ${i+1}. "${e.title}" | ${e.loc}`))

  // Check the main search page for location filter options
  await p.goto("https://www.expatriates.com/scripts/search/search.epl?category_id=50&region_id=0&ads=1", { waitUntil: "domcontentloaded", timeout: 15000 })
  await new Promise(r => setTimeout(r, 2000))
  console.log("\n=== SEARCH PAGE (no query) ===")
  const pageStructure = await p.evaluate(() => {
    const selects = [...document.querySelectorAll("select")].map(s => ({
      name: s.name,
      options: [...s.querySelectorAll("option")].map(o => ({ value: o.value, text: o.textContent.trim() }))
    }))
    return selects
  })
  pageStructure.forEach(s => {
    console.log(`Select '${s.name}': ${s.options.length} options`)
    s.options.slice(0, 10).forEach(o => console.log(`  ${o.value} = ${o.text}`))
    if (s.options.length > 10) console.log(`  ... and ${s.options.length - 10} more`)
  })

  await b.close()
}

main().catch(console.error)
