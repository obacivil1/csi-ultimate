/**
 * scripts/scratch/run-r2-gulfclassifieds.mjs — تشغيل R2 حي:
 * runMission على gulfclassifieds.org عبر fetch (L1)، doc_type=classified
 */
import { runMission } from "../../core/general-mission.mjs";

const START = "https://gulfclassifieds.org/";

const res = await runMission({
  urls: [START],
  topics: [],
  title: "R2 — استطلاع Gulf Classifieds",
  description: "استطلاع عامة إعلانات gulfclassifieds.org (fetch L1)",
  fetchMode: "fetch",
  depth: 1,
  maxPages: 25,
  outputDir: "./output/reports/R2-gulfclassifieds",
  siteProfile: { doc_type: "classified" },
  run_id: `r2-gc-${new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 15)}`,
  persist: true,
});

console.log("run_id:", res.run_id);
console.log("persisted:", JSON.stringify(res.persisted));
console.log("docs:", res.docs.length);
for (const d of res.docs.slice(0, 10)) {
  console.log(`  ${d.host} | ${(d.title || "").slice(0, 60)} | chars=${d.chars} links=${d.links}`);
}
console.log("summary:", JSON.stringify(res.summary, null, 1).slice(0, 800));