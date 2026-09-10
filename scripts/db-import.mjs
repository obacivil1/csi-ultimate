/**
 * scripts/db-import.mjs — One-shot JSON → SQLite migration.
 * ─────────────────────────────────────────────────────────
 * Reads the production JSON datasets and loads them into
 * data/csi.db via core/db.mjs. Idempotent (UPSERT by PK).
 *
 *   node scripts/db-import.mjs
 */
import fs from "node:fs";
import path from "node:path";
import open from "../core/db.mjs";

const DATA = path.resolve("data");
const NOW = new Date().toISOString();

function load(name) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));
    return Array.isArray(raw) ? raw : raw.records || Object.values(raw);
  } catch {
    return [];
  }
}

function cleanId(v) {
  return v === null || v === undefined ? `x-${Math.random().toString(36).slice(2, 10)}` : String(v);
}

function toTender(r) {
  const id = cleanId(r.tenderId ?? r.referenceNumber ?? r.tenderName);
  return {
    id,
    title: r.tenderName || r.title || "",
    entity: r.agencyName || r.entity || "",
    value: Number(r.financialFees) || r.value || null,
    currency: "SAR",
    status: r.tenderStatusName || r.status || "",
    deadline: r.lastOfferPresentationDate || r.deadline || "",
    activity: r.tenderActivityName || r.activity || "",
    url: r.ugrpRfxUrl || r.url || "",
    source: "etimad",
    scraped_at: NOW,
  };
}

function toContractor(r) {
  return {
    id: cleanId(r.id ?? r.sp_id ?? r.membershipNo ?? r.organization_name),
    name: r.organization_name_ar || r.organizationName || r.companyName || r.name || "",
    city: r.city ?? r.cityName ?? "",
    region: r.region_name ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    url: r.domain ?? r.url ?? "",
    source: "muqawil",
    scraped_at: NOW,
  };
}

function toAward(r) {
  return {
    id: cleanId(r.tenderId ?? r.awardId ?? r.id),
    title: r.tenderName || r.title || r.awardName || "",
    winner: r.winner || r.bestOfferSubmissionValue?.length ? (r.winnerContractor || "") : "",
    value: r.awardedValue || r.value || null,
    currency: "SAR",
    entity: r.agencyName || r.entity || "",
    bidders: Array.isArray(r.bidders) ? JSON.stringify(r.bidders) : (r.bidders || ""),
    date: r.awardDate || r.date || "",
    url: r.url || "",
    source: "etimad",
    scraped_at: NOW,
  };
}

function toProject(r) {
  return {
    id: cleanId(r.id ?? r.projectId ?? r.url),
    title: r.title || r.projectName || "",
    sector: r.sector || "",
    description: r.description || "",
    date: r.publishDate || r.date || "",
    url: r.url || r.link || "",
    source: "saudigulfprojects",
    scraped_at: NOW,
  };
}

const PLAN = [
  { file: "etimad_all_tenders.json", name: "tenders", map: toTender },
  { file: "muqawil_all_regions.json", name: "contractors", map: toContractor },
  { file: "etimad_sample_awards.json", name: "awards", map: toAward },
  { file: "projects_database.json", name: "projects", map: toProject },
];

const db = open();
for (const { file, name, map } of PLAN) {
  const rows = load(file).map(map);
  const n = await db.importMany(name, rows);
  console.log(`[db] ${name}: imported ${rows.length} rows`);
}
console.log("[db] totals:", JSON.stringify(db.stats()));
db.close();