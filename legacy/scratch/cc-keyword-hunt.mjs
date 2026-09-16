/**
 * scripts/scratch/cc-keyword-hunt.mjs — بحث كلمات مفتاحية حقيقي في Top Ads
 * (المت‌browser الموقّع). كل كلمة → التقط JSON → احفظ باسم الكلمة.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../state/cc-keys");
fs.mkdirSync(OUT_DIR, { recursive: true });

const QUERIES = [
  "makeup bag",
  "makeup organizer",
  "travel organizer",
  "jewelry organizer",
  "toiletry bag",
  "storage bag",
  "cosmetic case",
  "vanity case",
  "accessory organizer",
  "car organizer",
  "bathroom organizer",
  "desk organizer",
  "cable organizer",
];

const SEL = "input[placeholder*='Search' i]";
const { page, browser } = await createPage({ headless: true });
let capCount = 0;

page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("top_ads/v2/list") || !u.includes("keyword=")) return;
  try {
    const buf = await res.body();
    const fn = `k-${Date.now()}-${capCount++}.json`;
    fs.writeFileSync(path.join(OUT_DIR, fn), buf);
    const j = JSON.parse(buf.toString());
    const mats = j?.data?.materials || [];
    console.log(`  ▶ "${decodeURIComponent((u.match(/keyword=([^&]+)/)||[])[1]||"")}" → mats=${mats.length} → ${fn}`);
  } catch {}
});

async function clearField() {
  await page.evaluate((s) => document.querySelector(s).focus(), SEL);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(600);
}

await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);

for (const q of QUERIES) {
  console.log(`\n### ${q}`);
  await clearField();
  await page.focus(SEL);
  await page.type(SEL, q, { delay: 45 });
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(5200);
}

await browser.close();
console.log("\nDONE captured:", capCount);