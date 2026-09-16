/**
 * scripts/scratch/cc-org-wide.mjs — بحث موسّع عبر المربع الموقّع في Top Ads.
 * مجموعة كلمات "حل مشكلة" (organizer/case/roll/pouch/storage/travel).
 * يلتقط JSON لكل كلمة + يبني CSV موحد بالأداء.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../state/cc-orgwide");
fs.mkdirSync(OUT_DIR, { recursive: true });
const CSV = path.resolve(__dirname, "../../state/cc-orgwide-results.csv");

const QUERIES = [
  // organizers
  "organizer", "travel organizer", "packing organizer", "storage organizer",
  "cable organizer", "desk organizer", "drawer organizer", "kitchen organizer",
  "spice organizer", "fridge organizer", "fridge storage", "pantry organizer",
  // cases / rolls / bags
  "jewelry travel case", "jewelry roll", "cosmetic organizer", "cosmetic case",
  "makeup organizer", "makeup bag", "toiletry organizer", "toiletry bag",
  "hanging toiletry", "vanity organizer", "vanity case", "travel pouch",
  "tech pouch", "cable pouch", "document organizer", "wallet organizer",
  // travel / carry
  "suitcase organizer", "luggage organizer", "travel bag", "car organizer",
  "purse organizer", "bag organizer", "handbag organizer", "backpack organizer",
  "shoe organizer", "pill organizer", "pill case", "watch organizer",
  // storage-misc
  "storage box", "storage bin", "home organization", "closet organizer",
  "laundry organizer", "garment bag", "makeup brush holder",
];

const SEL = "input[placeholder*='Search' i]";
const { page, browser } = await createPage({ headless: true });
let capCount = 0;
const all = [];

page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("top_ads/v2/list") || !u.includes("keyword=")) return;
  try {
    const buf = await res.body();
    const k = decodeURIComponent((u.match(/keyword=([^&]+)/) || [])[1] || "?");
    const fn = `k-${Date.now()}-${capCount++}.json`;
    fs.writeFileSync(path.join(OUT_DIR, fn), buf);
    const j = JSON.parse(buf.toString());
    const mats = j?.data?.materials || [];
    console.log(`  ▶ "${k}" → mats=${mats.length} → ${fn}`);
    for (const m of mats) {
      all.push({
        keyword: k,
        title: (m.ad_title || "").replace(/\s*\n+\s*/g, " ").trim(),
        brand: m.brand_name || "",
        industry: m.industry_key || "",
        objective: (m.objective_key || "").replace("campaign_objective_", ""),
        ctr: m.ctr,
        likes: m.like,
        cost: m.cost,
        is_search: m.is_search,
        vid: m.video_info?.vid || "",
        cover: m.video_info?.cover?.[0] || "",
      });
    }
  } catch {}
});

async function clearField() {
  await page.evaluate((s) => document.querySelector(s).focus(), SEL);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(500);
}

await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);

for (const q of QUERIES) {
  await clearField();
  const ready = await page.evaluate((s) => !!document.querySelector(s), SEL);
  if (!ready) { console.log(" search input lost — reload"); await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US", { waitUntil: "domcontentloaded", timeout: 60000 }); await page.waitForTimeout(6000); }
  await page.focus(SEL);
  await page.type(SEL, q, { delay: 35 });
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(4200);
}

// CSV
const head = ["keyword", "brand", "industry", "objective", "ctr", "likes", "cost", "is_search", "title", "vid", "cover"];
fs.writeFileSync(CSV, "\uFEFF" + head.join(",") + "\n" + all.map(r =>
  [r.keyword, `"${(r.brand||"").replace(/"/g,'""')}"`, r.industry, r.objective, r.ctr, r.likes, r.cost, r.is_search,
   `"${(r.title||"").replace(/"/g,'""')}"`, r.vid, r.cover].join(",")).join("\n"), "utf8");

await browser.close();
console.log(`\nDONE. queries=${QUERIES.length} total materials=${all.length} CSV=${CSV}`);