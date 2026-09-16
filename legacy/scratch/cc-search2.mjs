/**
 * scripts/scratch/cc-search2.mjs — كتابة كلمة بحث في حقل Top Ads بمؤكدات،
 * راقبك كل طلبات creative_radar_api (وليس فقط top_ads/v2/list).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../state/cc-s2");
fs.mkdirSync(OUT_DIR, { recursive: true });

const { page, browser } = await createPage({ headless: true });

page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("creative_radar_api")) return;
  try {
    const buf = await res.body();
    const txt = buf.toString();
    let isJson = false;
    try { JSON.parse(txt); isJson = true; } catch {}
    if (isJson && buf.length > 400) {
      const fn = `k-${Date.now()}.json`;
      fs.writeFileSync(path.join(OUT_DIR, fn), buf);
      console.log(`  ▶ ${buf.length}b ${u.split("api/v1/")[1] || u.slice(0,80)} → ${fn}`);
    }
  } catch {}
});

await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);

const sel = "input[placeholder*='Search' i]";
const exists = await page.evaluate((s) => !!document.querySelector(s), sel);
console.log("input exists:", exists);

await page.focus(sel);
await page.type(sel, "makeup bag", { delay: 60 });
const val = await page.evaluate((s) => document.querySelector(s).value, sel);
console.log("typed value:", JSON.stringify(val));

await page.keyboard.press("Enter");
await page.waitForTimeout(6000);

// راقب هل ظهرت نتيجة أو تغيرت القائمة
const bodySnippet = await page.evaluate(() => (document.body.innerText || "").replace(/\n+/g, " | ").slice(0, 600));
console.log("BODY after enter:", bodySnippet);

await browser.close();