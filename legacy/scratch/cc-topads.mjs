/**
 * scripts/scratch/cc-topads.mjs — Creative Center Top Ads: يفتح الصفحة بـ"period=30&region=US"،
 * يمرّر ليحمّل المزيد، يلقط XHR/JSON ويحفظه كاملاً.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../state");
const URL = "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US";

const { page, browser } = await createPage({ headless: true });
const hits = [];

page.on("response", async (res) => {
  const u = res.url();
  if (!/creative_radar_api/.test(u) && !/creativeCenter/.test(u)) return;
  try {
    const buf = await res.body();
    const txt = buf.toString();
    let isJson = false;
    try { JSON.parse(txt); isJson = true; } catch {}
    if (isJson && buf.length > 300) {
      const fn = `cc-ads-${Date.now()}-${hits.length}.json`;
      fs.writeFileSync(path.join(OUT, fn), buf);
      hits.push({ u: u.slice(0, 180), len: buf.length, fn, top: txt.slice(0, 80) });
    }
  } catch {}
});

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
} catch (e) { console.log("goto:", e.message); }
await page.waitForTimeout(8000);
console.log("final url:", page.url());
const bodyTxt = await page.evaluate(() => (document.body?.innerText || "").slice(0, 1500)).catch(() => "");
console.log("BODY:", bodyTxt.replace(/\n+/g, " | ").slice(0, 1000));

for (let s = 0; s < 8; s++) {
  try {
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(800);
  } catch {}
}
await page.waitForTimeout(5000);
await browser.close();
console.log("\n=== HITS ===");
for (const h of hits) console.log(`  ${h.len} ${h.u}\n     → ${h.fn} | ${h.top.slice(0, 70)}`);