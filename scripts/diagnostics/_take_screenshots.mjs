import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
chromium.use(stealth())

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

const dir = "E:\\N8N\\scraper\\scraper2\\csi-ultimate\\verification\\screenshots"
import { mkdirSync } from "fs"
mkdirSync(dir, { recursive: true })

// Crawl Manager
console.log("1. Crawl Manager...")
await page.goto("http://localhost:3030/", { waitUntil: "networkidle", timeout: 15000 })
await page.waitForTimeout(1000)
await page.screenshot({ path: dir + "\\crawl-manager.png", fullPage: true })
console.log("   -> crawl-manager.png")

// Dashboard
console.log("2. Dashboard...")
await page.goto("http://localhost:3030/dashboard.html", { waitUntil: "networkidle", timeout: 15000 })
await page.waitForTimeout(1000)
await page.screenshot({ path: dir + "\\dashboard.png", fullPage: true })
console.log("   -> dashboard.png")

// Validation Center
console.log("3. Validation Center...")
await page.goto("http://localhost:3031/", { waitUntil: "networkidle", timeout: 15000 })
await page.waitForTimeout(1000)
await page.screenshot({ path: dir + "\\validation-center.png", fullPage: true })
console.log("   -> validation-center.png")

// Audit page
console.log("4. Audit page...")
await page.goto("http://localhost:3031/audit.html", { waitUntil: "networkidle", timeout: 15000 })
await page.waitForTimeout(1000)
await page.screenshot({ path: dir + "\\audit.png", fullPage: true })
console.log("   -> audit.png")

// Certification page
console.log("5. Certification page...")
await page.goto("http://localhost:3031/certification.html", { waitUntil: "networkidle", timeout: 15000 })
await page.waitForTimeout(1000)
await page.screenshot({ path: dir + "\\certification.png", fullPage: true })
console.log("   -> certification.png")

await browser.close()
console.log("\nAll screenshots captured.")
