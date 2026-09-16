/**
 * scripts/scratch/cc-hero-hunt.mjs — Hero product hunt عبر Top Ads API (creative_radar_api).
 * يفتح المتصفح ليكسب cookie، ثم يجري استدعاءات مبرمجية عبر context.request.get
 * لكل (industrial × objective) ويجمع العناوين/الأداء، يحفظ CSV.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../state/cc-hunt.csv");

const API = "https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list";
const BASE = { period: 30, page: 1, limit: 50, order_by: "for_you", country_code: "US" };

// أهداف "حل مشكلة" (باستبعاد فاشن/جواهر/ساعات/نظارات): صناعات مجرّبة
const TARGETS = [
  { name: "storage",         industry: 18100000000, objectives: [15, 3, 1] },   // Storage Products
  { name: "cleaning",        industry: 18110000000, objectives: [15, 3, 1] },   // Cleaning Supplies
  { name: "daily-essentials",industry: 18101000000, objectives: [15, 3, 1] },   // Daily Essentials
  { name: "household-other", industry: 18999000000, objectives: [15, 3, 1] },   // Other Household Products
  { name: "household",       industry: 18000000000, objectives: [15, 3, 1] },   // Household Products (root)
  { name: "outdoor-equip",   industry: 28100000000, objectives: [15, 3, 1] },   // Outdoor Equipment
  { name: "sports-outdoor",  industry: 28000000000, objectives: [15, 3, 1] },   // Sports & Outdoor
  { name: "energy-save",     industry: 24109000000, objectives: [15, 3, 1] },   // Energy Conservation
  { name: "furniture",       industry: 21101000000, objectives: [15, 3, 1] },   // Furniture
  { name: "home-improve",    industry: 21999000000, objectives: [15, 3, 1] },   // Other Home Improvement
  { name: "prs-care-appl",   industry: 16100000000, objectives: [15, 3, 1] },   // Personal Care Appliances
  { name: "pet-household",   industry: 19102000000, objectives: [15, 3, 1] },   // Pet Household Products
  { name: "auto-acc",        industry: 11101000000, objectives: [15, 3, 1] },   // Auto Accessories
  { name: "appliances",      industry: 16000000000, objectives: [15, 3, 1] },   // Appliances
  { name: "baby-misc",       industry: 12000000000, objectives: [15, 3, 1] },   // Baby kids maternity
];

const { page, browser } = await createPage({ headless: true });
await page.goto("https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

const rows = [];
let errs = 0;

for (const t of TARGETS) {
  for (const obj of t.objectives) {
    const q = new URLSearchParams({ ...BASE, industry: t.industry, objective: obj });
    const url = `${API}?${q}`;
    try {
      const res = await (page.context().request).get(url, {
        headers: { "referer": "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?region=US" },
      });
      const j = await res.json();
      if (j.code !== 0 || !j.data) { console.log(`  [skip] ${t.name}/obj=${obj} code=${j.code} msg=${j.msg}`); errs++; continue; }
      const mats = j.data.materials || [];
      console.log(`  [OK] ${t.name}/obj=${obj} → ${mats.length}`);
      for (const m of mats) {
        rows.push({
          industry: t.name,
          ad_id: m.id,
          title: (m.ad_title || "").replace(/\s*\n+\s*/g, " ").trim(),
          brand: m.brand_name || "",
          likes: m.like,
          ctr: m.ctr,
          objective: m.objective_key || "",
          videoUrl: m.video_info?.video_url?.[0] || "",
        });
      }
      // بين الصفحات قدر ضئيل
      await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      console.log(`  [ERR] ${t.name}/obj=${obj} ${e.message}`);
      errs++;
    }
  }
}

fs.writeFileSync(OUT, "\uFEFF" + ["industry", "ad_id", "title", "brand", "likes", "ctr", "objective", "videoUrl"].join(",") + "\n" +
  rows.map(r => [r.industry, r.ad_id, `"${(r.title||"").replace(/"/g, '""')}"`, `"${(r.brand||"").replace(/"/g, '""')}"`, r.likes, r.ctr, r.objective, r.videoUrl].join(",")).join("\n"), "utf8");

console.log(`\nDONE. rows=${rows.length} errs=${errs} saved=${OUT}`);
await browser.close();