/**
 * scripts/scratch/cc-one-industry.mjs — يثبت قيادة cascader لصناعة واحدة
 * (Storage Products) مع فحص متدرج بعد كل خطوة، ويلتقط الـ XHR الموقعة.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../state/cc-one");
fs.mkdirSync(OUT_DIR, { recursive: true });

const { page, browser } = await createPage({ headless: true });

page.on("response", async (res) => {
  if (!res.url().includes("top_ads/v2/list")) return;
  try {
    const b = await res.body();
    fs.writeFileSync(path.join(OUT_DIR, `${Date.now()}.json`), b);
    const j = JSON.parse(b.toString());
    console.log(`  ▶ captured ${b.length}b mats=${j?.data?.materials?.length ?? -1}`);
  } catch (e) { console.log("  ▶ captured(?)", e.message); }
});

await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);

async function step(label, fn) {
  const r = await fn();
  console.log(`  · ${label}:`, typeof r === "string" && r.length > 160 ? r.slice(0, 160) : r);
  await page.waitForTimeout(1500);
  return r;
}

await step("open cascader", () => page.evaluate(() => {
  const t = document.querySelector("span.byted-cascader-multiple-input-trigger");
  if (!t) return "no trigger";
  ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((ev) =>
    t.dispatchEvent(new MouseEvent(ev, { bubbles: true })));
  return "dispatched";
}));

await step("dump visible cas items", () => page.evaluate(() => {
  return Array.from(document.querySelectorAll(".byted-cascader-item-label"))
    .filter(el => el.getClientRects().length > 0)
    .map(el => (el.innerText || "").trim()).slice(0, 25);
}));

await step("type search", () => page.evaluate(() => {
  const el = document.querySelector(".byted-cascader input, input.byted-select-value");
  if (!el) return "no input";
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, "Storage");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return "typed";
}));

await step("dump visible cas items post-search", () => page.evaluate(() => {
  return Array.from(document.querySelectorAll(".byted-cascader-item-label"))
    .filter(el => el.getClientRects().length > 0)
    .map(el => (el.innerText || "").trim()).slice(0, 25);
}));

await step("click Storage Products", () => page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".byted-cascader-item-label"))
    .filter(el => el.getClientRects().length > 0);
  const hit = items.find(el => (el.innerText || "").trim() === "Storage Products");
  if (hit) { hit.click(); return "clicked"; }
  return "miss:" + items.map(i => (i.innerText||"").trim()).slice(0, 12).join("|");
}));

await page.waitForTimeout(5000);
await browser.close();
console.log("\nfinished");