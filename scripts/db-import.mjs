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

// حالات etimad معروفة (حسب ما يجمع السكربت الإنتاجي — ID الحالي هو المرجع)
const STATUS_LABELS = {
  4: "نشطة / Active",
  8: "منتهية / Ended",
  5: "تم الترسية / Awarded",
  6: "تم الترسية / Awarded",
  7: "تم الترسية / Awarded",
  15: "مؤرشفة / Archived",
  10: "ملغية / Cancelled",
  11: "ملغية / Cancelled",
  12: "ملغية / Cancelled",
  18: "ملغية / Cancelled",
};

function toTender(r) {
  const id = cleanId(r.tenderId ?? r.referenceNumber ?? r.tenderName);
  // الاسم قد يكون خالياً في التدفق — النوع هو المرجع الأوثق
  const status = r.tenderStatusName || STATUS_LABELS[r.tenderStatusId] || r.status || "";
  // الرابط المباشر للتفاصيل (زائر) يُبنى من المعرّف عند غياب رابط UGRP
  const detailUrl = r.ugrpRfxUrl || r.url
    || (r.tenderIdString ? `https://tenders.etimad.sa/Tender/DetailsForVisitor?STenderId=${encodeURIComponent(r.tenderIdString)}` : "");
  return {
    id,
    title: r.tenderName || r.title || "",
    entity: r.agencyName || r.entity || "",
    value: Number(r.financialFees) || r.value || null,
    currency: "SAR",
    status,
    deadline: r.lastOfferPresentationDate || r.deadline || "",
    activity: r.tenderActivityName || r.activity || "",
    url: detailUrl,
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
    url: r.domain ? `https://${r.domain}` : (r.url ?? ""),
    source: "muqawil",
    scraped_at: NOW,
  };
}

function toAward(r) {
  return {
    id: cleanId(r.tenderId ?? r.awardId ?? r.id),
    title: r.tenderName || r.title || r.awardName || "",
    winner: r.winner || r.winnerContractor || "",
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