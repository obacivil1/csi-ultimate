/**
 * scripts/scratch/cc-probe-products.mjs — يقود واجهة Creative Center SPA
 * لصفحة "Most Popular Products"، يلتقط XHR لسحب قائمة المنتجات الرائجة لعام/فترة.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage, navigateWithRetry } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../state");
const PROD_TAB_URLS = [
  "https://www.tiktok.com/business/creativecenter/trend/most-popular-products/pc/en?period=30",
  "https://ads.tiktok.com/creative/creativeCenter/trends/product?period=30&region=US",
  "https://ads.tiktok.com/creative/creativeCenter/trends/products?period=30&region=US",
  "https://ads.tiktok.com/creative/creativeCenter/trends/producttrend?period=30&region=US",
];

const { page, browser } = await createPage({ headless: true });
const logs = [];
const bodies = [];

page.on("response", async (res) => {
  const u = res.url();
  if (!/creativeCenter|creative_radar_api/.test(u)) return;
  if (res.request().resourceType() !== "xhr" && res.request().resourceType() !== "fetch") return;
  let len = 0, isJson = false;
  try {
    const buf = await res.body();
    len = buf.length;
    try { JSON.parse(buf.toString()); isJson = true; } catch {}
    if (isJson && len > 500) {
      const fn = `ccp-${Date.now()}-${logs.length}.json`;
      fs.writeFileSync(path.join(OUT, fn), buf);
      bodies.push(fn);
    }
  } catch {}
  logs.push({ u: u.slice(0, 160), len, isJson, status: res.status() });
});

for (const [i, url] of PROD_TAB_URLS.entries()) {
  console.log(`\n=== TARGET ${i} →`, url);
  try {
    await navigateWithRetry(page, url, 1);
  } catch (e) { console.log("   nav err:", e.message); }
  await page.waitForTimeout(7000);
  console.log("   final url:", page.url());
  const text = await page.evaluate(() => (document.body && document.body.innerText || "").slice(0, 400)).catch(() => "");
  console.log("   body start:", JSON.stringify(text.slice(0, 250)));
}

console.log("\n=== XHR hits ===");
for (const l of logs) console.log(`  ${l.status} json=${l.isJson} len=${l.len} ${l.u}`);
console.log("\nsaved json files:", bodies);

await browser.close();