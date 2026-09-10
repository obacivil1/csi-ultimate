import { chromium } from "playwright-extra"
import stealth from "puppeteer-extra-plugin-stealth"
import { getRandomFingerprint, buildContextOptions, buildStealthScript, initSessionFingerprint } from "../../core/fingerprint-engine.mjs"

chromium.use(stealth())
const b = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"], defaultViewport: null })
initSessionFingerprint()
const fp = getRandomFingerprint()
const ctx = await b.newContext({ ...buildContextOptions(fp), userAgent: fp.profile.ua, locale: "en-US" })
await ctx.addInitScript(buildStealthScript(fp.profile, true))
const page = await ctx.newPage()
const u = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=planning%20engineer&location=Riyadh&f_TPR=r604800"
const r = await page.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 })
await new Promise(rs => setTimeout(rs, 2500))
const len = await page.evaluate(() => (document.body?.innerText || "").length).catch(() => 0)
console.log("status=", r?.status(), "len=", len, "title=", (await page.title().catch(() => "")))
const cards = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a.base-card__full-link, a[href*='/jobs/view/']"))
    .map(a => ({ href: a.href }))
).catch(() => [])
console.log("cards:", cards.length, JSON.stringify(cards.slice(0, 5), null, 1))
const sample = await page.evaluate(() => (document.body?.innerText || "").slice(0, 600)).catch(() => "")
console.log("BODY SNIPPET:\n" + sample)
await b.close()
process.exit(0)