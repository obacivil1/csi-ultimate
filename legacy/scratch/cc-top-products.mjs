/**
 * scripts/scratch/cc-top-products.mjs — يقود Creative Center "Most Popular Products"
 * SPA، يلقط XHR JSON المخصص للمنتجات ويحفظها.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage, navigateWithRetry } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../state");
const URLS = [
  "https://ads.tiktok.com/business/creativecenter/pc/en/product/most-popular-products?period=30&region=US",
  "https://ads.tiktok.com/business/creativecenter/pc/en/product/most-popular-products?period=30",
  "https://ads.tiktok.com/business/creativecenter/pc/en/inspiration/most-popular-products?period=30",
  "https://ads.tiktok.com/business/creativecenter/inspiration/most-popular-products/pc/en?period=30",
  "https://ads.tiktok.com/business/creativecenter/pc/en/product/most-popular/most-popular-products?period=30",
];

const { page, browser } = await createPage({ headless: true });
const hits = [];

page.on("response", async (res) => {
  const u = res.url();
  if (!/popular_trend|creative_radar_api|creativeCenter/.test(u)) return;
  try {
    const buf = await res.body();
    const txt = buf.toString();
    if (/product/i.test(u) || txt.includes("popular_products") || (txt.length > 200 && txt.includes("product"))) {
      const fn = `cc-prod-${Date.now()}-${hits.length}.json`;
      fs.writeFileSync(path.join(OUT, fn), buf);
      hits.push({ u: u.slice(0, 160), len: buf.length, fn });
    }
  } catch {}
});

for (const [i, url] of URLS.entries()) {
  console.log(`\n=== TARGET ${i} →`, url);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (e) { console.log("   goto err:", e.message); }
  await page.waitForTimeout(9000);
  // scroll to trigger queries
  for (let s = 0; s < 6; s++) {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(3000);
  console.log("   final url:", page.url());
}
await browser.close();
console.log("\n=== PRODUCT HITS ===");
for (const h of hits) console.log("  len=" + h.len, h.u, "→", h.fn);