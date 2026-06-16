import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { writeFileSync, mkdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, "verification", "block-diagnostics")
mkdirSync(OUT, { recursive: true })

chromium.use(stealth())

const BLOCKED_SITES = [
  { name: "bayt.com", url: "https://www.bayt.com/en/jobs/" },
  { name: "olx.com.pk", url: "https://www.olx.com.pk/" },
  { name: "expatriates.com", url: "https://www.expatriates.com/" },
  { name: "sa.opensooq.com", url: "https://sa.opensooq.com/en" },
]

const UAs = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]

async function diagnoseSite(name, url) {
  console.log("\n" + "=".repeat(70))
  console.log("  DIAGNOSING: " + name)
  console.log("  URL: " + url)
  console.log("=".repeat(70))

  const results = { site: name, url, tests: [] }

  for (let t = 0; t < UAs.length; t++) {
    const ua = UAs[t]
    console.log("\n  --- Test " + (t + 1) + " with UA: " + ua.substring(0, 50) + "... ---")

    const testResult = { userAgent: ua, status: null, contentType: null, title: null, isBlocked: false, blockType: null, bodySnippet: null, headers: null, error: null, screenshot: null }

    try {
      const browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--disable-web-security",
          "--disable-features=IsolateOrigins,site-per-process",
        ],
      })

      const ctx = await browser.newContext({
        userAgent: ua,
        viewport: { width: 1920, height: 1080 },
        locale: "en-US",
        timezoneId: "America/New_York",
        colorScheme: "light",
      })

      const page = await ctx.newPage()

      // Set extra headers
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      })

      // Check webdriver
      const isWebdriver = await page.evaluate(() => navigator.webdriver)
      console.log("  navigator.webdriver: " + isWebdriver)

      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      testResult.status = resp ? resp.status() : null
      testResult.headers = resp ? resp.headers() : {}
      testResult.contentType = resp ? resp.headers()["content-type"] || resp.headers()["Content-Type"] : null
      console.log("  HTTP Status: " + testResult.status)
      console.log("  Content-Type: " + testResult.contentType)

      await new Promise(r => setTimeout(r, 2000))

      const title = await page.title()
      testResult.title = title
      console.log("  Title: " + title)

      const url2 = page.url()
      console.log("  Final URL: " + url2)

      // Get body snippet
      const body = await page.evaluate(() => document.body?.innerText?.substring(0, 800) || "(no body text)")
      testResult.bodySnippet = body

      // Detect block type
      const bodyLower = body.toLowerCase()
      const html = await page.evaluate(() => document.documentElement?.outerHTML?.substring(0, 3000) || "")
      const htmlLower = html.toLowerCase()

      if (testResult.status === 403) {
        testResult.isBlocked = true
        testResult.blockType = "HTTP 403"
      } else if (bodyLower.includes("cloudflare") || htmlLower.includes("cloudflare")) {
        testResult.isBlocked = true
        testResult.blockType = "Cloudflare"
      } else if (bodyLower.includes("captcha") || htmlLower.includes("captcha")) {
        testResult.isBlocked = true
        testResult.blockType = "CAPTCHA"
      } else if (bodyLower.includes("just a moment") || htmlLower.includes("challenge-platform")) {
        testResult.isBlocked = true
        testResult.blockType = "Cloudflare Challenge"
      } else if (bodyLower.includes("access denied")) {
        testResult.isBlocked = true
        testResult.blockType = "Access Denied"
      } else if (bodyLower.includes("blocked") && bodyLower.includes("ip")) {
        testResult.isBlocked = true
        testResult.blockType = "IP Blocked"
      }

      console.log("  Blocked: " + testResult.isBlocked + (testResult.blockType ? " (" + testResult.blockType + ")" : ""))

      if (testResult.isBlocked) {
        const ssName = name.replace(/\./g, "_") + "_test" + (t + 1) + ".png"
        const ssPath = resolve(OUT, ssName)
        await page.screenshot({ path: ssPath, fullPage: false })
        testResult.screenshot = ssName
        console.log("  Screenshot: " + ssPath)
        console.log("  Body sample: " + body.substring(0, 300))
      }

      await browser.close()
    } catch (e) {
      testResult.error = e.message?.substring(0, 200)
      console.log("  ERROR: " + testResult.error)
    }

    results.tests.push(testResult)
  }

  return results
}

const allResults = []
for (const site of BLOCKED_SITES) {
  const r = await diagnoseSite(site.name, site.url)
  allResults.push(r)
}

// Summary
console.log("\n\n" + "=".repeat(70))
console.log("  BLOCK DIAGNOSTIC SUMMARY")
console.log("=".repeat(70))
for (const r of allResults) {
  console.log("\n" + r.site + ":")
  for (const t of r.tests) {
    console.log("  UA Test: HTTP " + t.status + " | Blocked=" + t.isBlocked + " | Type=" + (t.blockType || "None") + " | Title: " + (t.title || "-").substring(0, 60))
  }
}

// Write full results
writeFileSync(resolve(OUT, "diagnostic_results.json"), JSON.stringify(allResults, null, 2), "utf8")
console.log("\nFull results: " + resolve(OUT, "diagnostic_results.json"))
