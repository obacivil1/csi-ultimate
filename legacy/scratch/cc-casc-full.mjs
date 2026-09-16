/**
 * scripts/scratch/cc-casc-full.mjs — قيادة cascader الصناعة بالبحث والاختيار،
 * التقاط XHR الموقعة لكل صناعة، حفظ JSON.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../state/cc-casc");

const INDUSTRIES = [
  "Storage Products", "Cleaning Supplies", "Daily Essentials", "Household Products",
  "Outdoor Equipment", "Sports & Outdoor", "Energy Conservation & Environmental Protection",
  "Furniture", "Other Home Improvement", "Personal Care Appliances", "Pet Household Products",
  "Auto Accessories", "Appliances", "Home Decor",
];

const { page, browser } = await createPage({ headless: true });
let capCount = 0;

page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("top_ads/v2/list")) return;
  try {
    const buf = await res.body();
    const fn = `t-${Date.now()}-${capCount++}.json`;
    fs.writeFileSync(path.join(OUT_DIR, fn), buf);
    const j = JSON.parse(buf.toString());
    const n = j?.data?.materials?.length ?? -1;
    console.log(`  ▶ ${buf.length}b mats=${n} → ${fn}`);
  } catch { console.log("  ▶ (captured, body unreadable)"); }
});

await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(8000);

async function openCascader() {
  const pos = await page.evaluate(() => {
    const t = document.querySelector("span.byted-cascader-multiple-input-trigger");
    if (!t) return null;
    t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    t.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    t.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return "ok";
  });
  await page.waitForTimeout(1800);
  return pos;
}

async function searchAndPick(name) {
  const inp = await page.evaluate((v) => {
    const el = document.querySelector(".byted-cascader input, input.byted-select-value");
    if (!el) return "no-input";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return "typed";
  }, name);
  await page.waitForTimeout(1600);
  const pick = await page.evaluate((wanted) => {
    const items = Array.from(document.querySelectorAll(".byted-cascader-item-label"));
    const hit = items.filter(el => el.getClientRects().length > 0)
      .find(el => (el.innerText || "").trim() === wanted);
    if (hit) { hit.click(); return "ok"; }
    const vis = items.filter(el => el.getClientRects().length > 0).map(el => (el.innerText||"").trim()).slice(0, 12);
    return "miss:" + vis.join("|");
  }, name);
  return pick;
}

for (const ind of INDUSTRIES) {
  console.log(`\n### ${ind}`);
  const o = await openCascader();
  const c = await searchAndPick(ind);
  console.log("   open:", o, "pick:", c);
  await page.waitForTimeout(3500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
}

await browser.close();
console.log("\nDONE captured:", capCount);