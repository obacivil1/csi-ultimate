/**
 * scripts/scratch/cc-ui-drive.mjs — يقود واجهة Top Ads: يفتح الفيترات ويختار
 * "Objective" و "Industry" للصناعات المستهدفة (حل مشكلة). يلتقط XHR لكل طلب
 * ويحفظ materi... ويعاد تصدير CSV.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../state/cc-ui");
fs.mkdirSync(OUT_DIR, { recursive: true });

// الصناعات المستهدفة (حل مشكلة)
const INDUSTRIES = [
  "Storage Products",
  "Cleaning Supplies",
  "Daily Essentials",
  "Household Products",
  "Outdoor Equipment",
  "Sports & Outdoor",
  "Energy Conservation & Environmental Protection",
  "Furniture",
  "Other Home Improvement",
  "Personal Care Appliances",
  "Pet Household Products",
  "Auto Accessories",
  "Appliances",
  "Beauty & Personal Care",
];

const { page, browser } = await createPage({ headless: true });
let capturedCount = 0;

page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("top_ads/v2/list")) return;
  try {
    const buf = await res.body();
    const fn = `ccx-${Date.now()}-${capturedCount++}.json`;
    fs.writeFileSync(path.join(OUT_DIR, fn), buf);
    console.log("  ▶ captured:", u.split("?")[1].slice(0, 150), "→", fn, `(${buf.length}b)`);
  } catch {}
});

await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);

async function openMenu(label) {
  const r = await page.evaluate((lbl) => {
    const all = Array.from(document.querySelectorAll("div, button, span, [role=button]"));
    const target = all.filter(el => {
      const t = (el.innerText || "").trim();
      return t === lbl && el.children.length === 0;
    }).sort((a, b) => a.closest("div")?.children.length - b.closest("div")?.children.length);
    const best = target.find(el => el.closest("div") && el.closest("div").querySelector("input, svg, [role=combobox]"));
    const el = best || target[0];
    if (el) { el.click(); el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); return "ok:" + el.tagName; }
    return "missing";
  }, label);
  await page.waitForTimeout(1800);
  return r;
}

async function chooseOption(text) {
  const r = await page.evaluate((txt) => {
    const opts = Array.from(document.querySelectorAll("[role=option], [role=menuitem], li, div[class*=option]"));
    const hit = opts.find(o => (o.innerText || "").trim() === txt);
    if (hit) { hit.click(); return "ok"; }
    return "miss:" + opts.map(o => (o.innerText||"").trim().slice(0, 30)).slice(0, 25).join(" | ");
  }, text);
  return r;
}

// 1) افتح قائمة Objective → اختر "Product sales"
console.log("open Objective:", await openMenu("Objective"));
await page.waitForTimeout(700);
console.log("choose Product sales:", await chooseOption("Product sales"));
await page.waitForTimeout(3500);

// 2) لكل صناعة: افتح قائمة Industry → اختر
for (const ind of INDUSTRIES) {
  console.log(`\n### Industry → ${ind}`);
  const o = await openMenu("All Industries");
  await page.waitForTimeout(1500);
  const c = await chooseOption(ind);
  console.log("   open:", o, "choose:", c);
  await page.waitForTimeout(3500);
  // إن لم يجد us the industry, try إعادة الفتح عبر زر آخر
  if (c.startsWith("miss")) {
    const o2 = await openMenu("Industry");
    await page.waitForTimeout(1200);
    const c2 = await chooseOption(ind);
    console.log("   retry:", o2, c2);
    await page.waitForTimeout(3200);
  }
}

await page.waitForTimeout(2000);
await browser.close();
console.log("\nTOTAL captured:", capturedCount);