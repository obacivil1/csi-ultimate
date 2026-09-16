/**
 * scripts/scratch/cc-cascader-click.mjs — يفتح cascader الصناعة عبر click الإحداثي، يكتب
 * اسم الصناعة في حقل البحث، يختار النتيجة، يلتقط الطلبات الموقعة ويحفظ JSON (بيانات الإعلانات).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../state/cc-casc");
fs.mkdirSync(OUT_DIR, { recursive: true });

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
    const fn = `t${Date.now()}-${capCount++}.json`;
    fs.writeFileSync(path.join(OUT_DIR, fn), buf);
    console.log(`  ▶ ${buf.length}b → ${fn} | ${(u.split("?")[1]||"").slice(0,120)}`);
  } catch {}
});

await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(8000);

// 1) اختر Objective=Product sales عبر النقر الإحداثي على الزر عند x=848,y=602 ثم خيار "Product sales"
await page.mouse.click(848, 602);
await page.waitForTimeout(1800);
const pickObj = await page.evaluate(() => {
  const opts = Array.from(document.querySelectorAll("[role=option], li, .byted-select-option, [class*=option]"));
  const hit = opts.find(o => (o.innerText||"").trim() === "Product sales" && o.offsetParent !== null);
  if (hit) { hit.click(); return "ok"; }
  const vis = opts.filter(o => o.offsetParent !== null).map(o => (o.innerText||"").trim()).filter(Boolean).slice(0, 12);
  return "miss:" + vis.join("|");
});
console.log("objective pick:", pickObj);
await page.waitForTimeout(3500);

async function setIndustry(name) {
  // موقع cascader معروف (x=604,y=602) — لكن قد يتغير بعد Objective؛ أعد الاستعلام
  const pos = await page.evaluate(() => {
    const t = document.querySelector("span.byted-cascader-multiple-input-trigger");
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!pos) return "no-cascader";
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(1600);
  // اكتب اسم الصناعة في حقل البحث
  const typed = await page.evaluate((name) => {
    const inp = document.querySelector(".byted-cascader input, input.byted-select-value");
    if (!inp) return "no-input";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, name);
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    return "typed";
  }, name);
  await page.waitForTimeout(1400);
  // اختر الخيار الظاهر الذي يطابق الاسم (نص متطابق)
  const chosen = await page.evaluate((wanted) => {
    const opts = Array.from(document.querySelectorAll("[role=option], li, .byted-cascader-menu-item, .byted-cascader-option, [class*=option]"));
    const cand = opts.filter(o => {
      const t = (o.innerText||"").trim();
      return o.offsetParent !== null && (t === wanted || t.startsWith(wanted));
    });
    const hit = cand[0];
    if (hit) { hit.click(); return "ok:" + hit.innerText.slice(0, 40); }
    return "miss-visible:" + opts.filter(o=>o.offsetParent!==null).map(o=>(o.innerText||"").trim()).slice(0, 10).join("|");
  }, name);
  await page.waitForTimeout(3500);
  return chosen;
}

for (const ind of INDUSTRIES) {
  console.log(`\n### ${ind}`);
  const r = await setIndustry(ind);
  console.log("   →", r);
  // بعد اختيار صناعة، أغلق cascader للناتج إن لزم (Esc) وأعد هن حال الصناعة التالية
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
}

// تنظيف: إظهار عدد الملفات الملتقطة لكل صناعة
await browser.close();
console.log("\nDONE. captured files:", capCount);