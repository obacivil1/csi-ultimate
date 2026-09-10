/**
 * scripts/general-mission.mjs — رحلة استقصاء عام من الطرفية
 *
 * مثال:
 *   node scripts/general-mission.mjs --urls "https://example.com,https://example.org" --topics "news,tech"
 *   node scripts/general-mission.mjs --urls "https://example.com" --depth 1 --maxPages 5 --fetchMode browser
 *   node scripts/general-mission.mjs --urls "https://example.com" --title "بحث سريع" --out output/reports/demo
 */
import path from "path";
import fs from "fs";
import { runMission } from "../core/general-mission.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    args[key] = val === undefined || val.startsWith("--") ? "true" : val;
  }
  return args;
}

function printSummary(result) {
  console.log(`\n=== رحلة استقصاء عام: ${result.report.meta.title} ===`);
  console.log(`المصادر: ${result.report.sources.length} · الوثائق: ${result.docs.length}`);
  console.log("المضيفون:", result.summary.hosts.map((h) => `${h.host} (${h.pages})`).join(", "));
  console.log("المواضيع:", result.summary.topicDistribution.map((t) => `${t.topic} ${t.pct}%`).join(", ") || "لا تصنيف");
  console.log("الملفات:");
  for (const [k, p] of Object.entries(result.files)) console.log(`  ${k}: ${p}`);
}

const args = parseArgs(process.argv.slice(2));
const targets = String(args.urls || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!targets.length) {
  console.error("استخدام: node scripts/general-mission.mjs --urls \"https://a.test,https://b.test\" [--topics news,tech] [--depth 0] [--maxPages 20] [--title ...] [--fetchMode fetch|browser]");
  process.exit(1);
}

const outputDir = path.resolve(args.out || "./output/reports/general");

runMission({
  urls: targets,
  topics: String(args.topics || "").split(",").map((s) => s.trim()).filter(Boolean),
  title: args.title ? String(args.title) : "رحلة استقصاء عام",
  depth: parseInt(args.depth) || 0,
  maxPages: parseInt(args.maxPages) || 20,
  fetchMode: args.fetchMode === "browser" ? "browser" : "fetch",
  outputDir,
})
  .then((result) => { printSummary(result); process.exit(0); })
  .catch((e) => { console.error("فشلت الرحلة:", e.message); process.exit(1); });