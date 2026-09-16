/**
 * scripts/scratch/cc-drive-cascader.mjs — يتحقق من طريقة توجيه فلتر الصناعة через Cascader.
 * يفتح Top Ads → يختار Objective=Product sales → يفتح cascader الصناعة ويكتب اسم صناعة →
 * يختار → يلتقط and يراقب الـ URL كاملاً.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../state/cc-casc");
fs.mkdirSync(OUT_DIR, { recursive: true });

const { page, browser } = await createPage({ headless: true });
const captured = [];

page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("top_ads/v2/list")) return;
  try {
    const buf = await res.body();
    captured.push({ url: u, len: buf.length });
    fs.writeFileSync(path.join(OUT_DIR, `${Date.now()}-${captured.length}.json`), buf);
    console.log("  ▶ FULL:", u);
    console.log(`    len=${buf.length}b`);
  } catch {}
});

await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(8000);

// Objective → Product sales (كما نجح سابقاً)
const objSel = `document.querySelector('span.byted-popper-trigger[class*="byted-select-input-trigger"]')?.click()`;
await page.evaluate((sel) => { const el = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; if (el) { el.click(); return "ok"; } return "missing"; }, '//span[contains(@class,"byted-select-input-trigger")][.//text()="Objective" or .//text()="Product sales"]');
await page.waitForTimeout(1600);
// اختر Product sales من اللائحة
const choosen = await page.evaluate(() => {
  const opts = Array.from(document.querySelectorAll("[role=option], [role=menuitem], li"));
  const hit = opts.find(o => (o.innerText || "").trim() === "Product sales");
  if (hit) { hit.click(); return "ok"; }
  const labels = opts.map(o => (o.innerText||"").trim()).filter(Boolean).slice(0, 15);
  return "miss:" + labels.join("|");
});
console.log("objective:", choosen);
await page.waitForTimeout(3000);

// افتح cascader الصناعة
const opened = await page.evaluate(() => {
  const trig = document.querySelector("span.byted-cascader-multiple-input-trigger");
  if (!trig) return "no-trigger";
  trig.click();
  return "ok";
});
console.log("cascader open:", opened);
await page.waitForTimeout(1500);

// اكتب في حقل البحث
const typed = await page.evaluate(() => {
  const inp = document.querySelector("input.byted-select-value, .byted-cascader input, .byted-select-input-inner input");
  if (!inp) return "no-input";
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  nativeInputValueSetter.call(inp, "Storage");
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  return "typed";
});
console.log("search typed:", typed);
await page.waitForTimeout(1800);

// خيارات مطبوعة بعد البحث
const optsNow = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("[role=option], li, .byted-cascader-menu-item, .byted-select-option, [class*=option]"))
    .map(o => (o.innerText || "").trim()).filter(t => t && t.length < 70).slice(0, 40);
});
console.log("options now:", JSON.stringify(optsNow, null, 1));
await page.waitForTimeout(2500);
await browser.close();
console.log("\nCAPTURED:", captured.length);