/**
 * scripts/scratch/cc-ui-drive.mjs — يقود واجهة Top Ads لتغيير فلتر الصناعة فعلياً عبر DOM،
 * يلتقط XHR الفعلي الذي تُطلقه الصفحة لكل صناعة ويجمع المواد.
 * الاستراتيجية: كل تغيير فلتر = إعادة تحميل بيانات → نلتقط ويحفظ.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../state/cc-ui");
fs.mkdirSync(OUT_DIR, { recursive: true });

// الصناعات المستهدفة (حل مشكلة، وليست فاشن/جواهر/ساعات)
const GOALS = [
  "Storage Products", "Cleaning Supplies", "Daily Essentials", "Household Products",
  "Outdoor Equipment", "Sports & Outdoor", "Energy Conservation & Environmental Protection",
  "Furniture", "Other Home Improvement", "Personal Care Appliances", "Pet Household Products",
  "Auto Accessories", "Appliances",
];

const { page, browser } = await createPage({ headless: true });
const seen = new Map(); // url -> filename

page.on("response", async (res) => {
  const u = res.url();
  if (!u.includes("top_ads/v2/list")) return;
  try {
    const buf = await res.body();
    if (!seen.has(u)) {
      const fn = `${Date.now()}.json`;
      fs.writeFileSync(path.join(OUT_DIR, fn), buf);
      seen.set(u, fn);
      console.log("  captured:", u.split("?")[1].slice(0, 120), "→", fn, `(${buf.length}b)`);
    }
  } catch {}
});

await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(8000);

// patrol: افتح فلاتر الصناعة واختر كل هدف عبر النص
async function clickFilter() {
  // فتح dropdown/popup للصناعة
  const res = await page.evaluate(async (goals) => {
    const btns = Array.from(document.querySelectorAll("button, [role=button], div[aria-haspopup]"));
    const cand = btns.filter(b => /Industr|Category/i.test((b.getAttribute("aria-label") || "") + " " + (b.innerText || "")));
    const pick = cand[0] || btns.find(b => (b.innerText || "").trim() === "All" || (b.getAttribute("aria-label")||"").includes("Industr"));
    if (pick) { pick.click(); return "clicked:" + (pick.innerText||"").slice(0, 40); }
    return "nofilter";
  }, GOALS);
  console.log(" . filter click:", res);
  await page.waitForTimeout(2500);
}

await clickFilter();
// اطبع بنية DOM المحتملة للمساعدة في الكشف
const info = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll("[role=option], [role=menuitem], [data-testid]"));
  return els.map(e => (e.getAttribute("data-testid") || e.getAttribute("role") || "?") + " :: " + (e.innerText || "").slice(0, 60)).slice(0, 60);
});
console.log("options sample:\n" + info.join("\n"));

await browser.close();
console.log("\ncaptured files:", seen.size);