/**
 * scripts/scratch/cc-search.mjs — يستخدم صندوق البحث في Top Ads عبر كلمة مفتاحية
 * (مثال المنتج GORISGARMO: "makeup bag" ومتغيّرات حلّ مشكلة)، يلتقط XHR JSON الموقعة
 * ويحفظ القوائم مع العناوين.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../state/cc-search");

const QUERIES = [
  "makeup bag",
  "travel organizer",
  "jewelry organizer",
  "storage",
  "cosmetics bag",
  "toiletry",
  "travel bag",
  "vanity",
];

const { page, browser } = await createPage({ headless: true });
let capCount = 0;

page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("top_ads/v2/list")) return;
  try {
    const buf = await res.body();
    const j = JSON.parse(buf.toString());
    const fn = `s-${Date.now()}-${capCount++}.json`;
    fs.writeFileSync(path.join(OUT_DIR, fn), buf);
    const mats = j?.data?.materials || [];
    console.log(`  ▶ mats=${mats.length} → ${fn}`);
    for (const m of mats) {
      console.log(`    · ${(m.ad_title || "").replace(/\s+/g, " ").slice(0, 110)}`);
    }
  } catch {}
});

await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);

// ابحث عن حقل البحث
const boxInfo = await page.evaluate(() => {
  const inp = document.querySelector("input[placeholder*='Search' i], input[class*=search], input[type=search]");
  if (inp) {
    const r = inp.getBoundingClientRect();
    return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2, ph: inp.getAttribute("placeholder") || "" };
  }
  // ربما search في أعلى: div "Search" text
  const el = Array.from(document.querySelectorAll("span,div,button")).find(e => (e.innerText || "").trim() === "Search" && e.getClientRects().length > 0);
  if (el) { const r = el.getBoundingClientRect(); return { found: true, x: r.x, y: r.y, ph: "span", tag: el.tagName }; }
  return { found: false, note: "no search element" };
});
console.log("search box:", boxInfo);

async function runQuery(q) {
  // أعد إيجاد input في كل مرة (تغيّر DOM بعد كل تنقية)
  const b = await page.evaluate(() => {
    const inp = document.querySelector("input[placeholder*='Search' i], input[class*=search], input[type=search]");
    if (!inp) return null;
    const r = inp.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!b) { console.log("  (no input)"); return; }
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(600);
  await page.keyboard.type(q, { delay: 40 });
  await page.waitForTimeout(700);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(5000);
}

// أول تشغيل: اسأل الجميع
for (const q of QUERIES) {
  console.log(`\n### QUERY: ${q}`);
  await runQuery(q);
  // نظّف الحقل للبحث التالي: امسح ثلاثًا
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(800);
}

await browser.close();
console.log("\nDONE captured:", capCount);