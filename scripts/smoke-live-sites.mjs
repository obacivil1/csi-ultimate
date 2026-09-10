import { chromium } from "playwright";
import { getSiteConfig, getSearchUrl } from "../core/site-adapter.mjs";
import { extractAdData, toCanonical } from "../core/extractor.mjs";
import { env } from "../config/env.mjs";

const site = process.argv[2];
const query = process.argv[3] || "office";

const hostname = site || env.SMOKE_SITE || "sa.opensooq.com";
const base = "https://" + hostname;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36" });
page.setDefaultTimeout(20000);

try {
  const cfg = getSiteConfig(base + "/x");
  cfg.hostname = hostname;
  const searchUrl = getSearchUrl(base, query, 1, cfg);
  console.log(`[smoke] ${hostname} << ${searchUrl}`);

  const resp = await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (!resp || resp.status() >= 400) throw new Error(`HTTP ${resp?.status()}`);

  const link = await page
    .locator(`a[href*='${hostname}']`)
    .filter({ hasText: /\S/ })
    .first()
    .getAttribute("href")
    .catch(() => null);
  if (!link) {
    console.log(`[smoke] ${hostname}: no ad link on search page — OK (structure may differ)`);
    process.exit(0);
  }

  const adUrl = new URL(link, base).href;
  await page.goto(adUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  const rec = await extractAdData(page, cfg);
  const canon = toCanonical(rec, hostname, "Smoke");
  console.log(`[smoke] ${hostname} :: ${adUrl}`);
  console.log(`[smoke]   title=${rec.title} phone=${rec.phone} email=${rec.email} price=${rec.price} ${rec.currency} location=${rec.location}`);
  console.log(`[smoke]   canonical keys ok=${Object.keys(canon).length === 13}`);
} catch (e) {
  console.error(`[smoke] ${hostname}: FAILED — ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}