import fs from 'fs';
import { resolve } from 'path';

const SAUDI_GULF_FILE = resolve('data/saudi_gulf_projects.json');
const OLD_PROJECTS_FILE = resolve('data/saudi_projects.json');
const OUTPUT = resolve('data/projects_database.json');

function isSaudiArticle(p) {
  const t = (p.title || '') + ' ' + (p.location || '') + ' ' + (p.owner || '') + ' ' + (p.contractor || '') + ' ' + (p.consultant || '');
  return /Saudi\s+Arabia|الرياض|جدة|مكة|المدينة|الدمام|تبوك|NEOM|نيوم|Roshn|Aramco|ACWA|PIF|Public\s+Investment\s+Fund|Red\s+Sea|Diriyah|Qiddiya|King\s+Salman|King\s+Abdullah|Ministry\s+of|Royal\s+Commission|Riyadh|Jeddah|Dammam|Makkah|Madinah|Tabuk|Abha|Hail|Najran|Jazan|Taif|Yanbu|Jubail|Buraidah|Al-Ahsa|Eastern\s+Province|Makkah|Madinah|Qassim|Asir|Northern\s+Borders|Al-Jawf|Al-Bahah|Najran|Jazan|Hail|Tabuk/i.test(t);
}

function cleanCompanyName(name) {
  if (!name) return null;
  let cleaned = name.replace(/^(?:by|to|for|from|with|of|as|the|a|an)\s+/i, '').trim();
  cleaned = cleaned.replace(/\s+for\s+the\s+development.*/i, '').trim();
  cleaned = cleaned.replace(/\s+will\s+be\s+responsible.*/i, '').trim();
  cleaned = cleaned.replace(/\s+in\s+the\s+development.*/i, '').trim();
  cleaned = cleaned.replace(/\s+under\s+the\s+contract.*/i, '').trim();
  if (cleaned.length < 3 || cleaned.length > 60) return null;
  if (/^\s/.test(cleaned) || /\s$/.test(cleaned)) cleaned = cleaned.trim();
  if (!cleaned || cleaned.length < 3) return null;
  return cleaned;
}

function normalizeValue(val) {
  if (!val) return null;
  const v = val.trim();
  // Convert to standardized format
  const m = v.match(/([\d,.]+\s*)\s*(billion|million|bn|mn|B|M|trillion)?/i);
  if (m) return v;
  return v;
}

function deduplicate(projects) {
  const seen = new Map();
  return projects.filter(p => {
    const key = (p.title || '').toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
}

// Load and merge sources
console.log('=== Building Projects Database ===\n');

// Source 1: SaudiGulfProjects (main)
const saudiGulf = JSON.parse(fs.readFileSync(SAUDI_GULF_FILE, 'utf8'));
console.log(`SaudiGulfProjects: ${saudiGulf.length} total`);

const saudiOnly = saudiGulf.filter(isSaudiArticle);
console.log(`Saudi articles: ${saudiOnly.length}`);

// Source 2: Old curated projects
let oldProjects = [];
if (fs.existsSync(OLD_PROJECTS_FILE)) {
  try {
    oldProjects = JSON.parse(fs.readFileSync(OLD_PROJECTS_FILE, 'utf8'));
    console.log(`Old curated projects: ${oldProjects.length}`);
  } catch (e) {}
}

// Transform SaudiGulf projects into unified format
const unified = [];

for (const p of saudiOnly) {
  const owner = cleanCompanyName(p.owner);
  const contractor = cleanCompanyName(p.contractor);
  const consultant = cleanCompanyName(p.consultant);

  // Skip articles with no useful data
  if (!owner && !contractor && !consultant && !p.value) continue;

  unified.push({
    title: p.title || '',
    owner: owner || null,
    contractor: contractor || null,
    consultant: consultant || null,
    value: normalizeValue(p.value),
    location: p.location || null,
    region: p.region || null,
    sector: p.sector || 'General',
    status: p.status || 'قيد الدراسة',
    source: p.source || null,
    publishedAt: p.publishedAt || null,
    scrapedAt: p.scrapedAt || null,
    sourceType: 'news',
    confidence: [
      owner ? 1 : 0,
      contractor ? 1 : 0,
      consultant ? 1 : 0,
      p.value ? 1 : 0,
      p.location ? 1 : 0
    ].reduce((a, b) => a + b, 0)
  });
}

// Add old curated projects (higher confidence)
for (const p of oldProjects) {
  // Check if already exists
  const exists = unified.some(u => u.title?.toLowerCase() === (p.title || '').toLowerCase());
  if (exists) {
    // Merge - update with old data if it has more info
    const idx = unified.findIndex(u => u.title?.toLowerCase() === (p.title || '').toLowerCase());
    if (idx >= 0) {
      if (p.contractor && !unified[idx].contractor) unified[idx].contractor = p.contractor;
      if (p.value && !unified[idx].value) unified[idx].value = p.value;
      if (p.location && !unified[idx].location) unified[idx].location = p.location;
      if (p.sector && !unified[idx].sector) unified[idx].sector = p.sector;
      unified[idx].confidence += 2;
    }
  } else {
    unified.push({
      title: p.title || '',
      owner: p.owner || null,
      contractor: p.contractor || null,
      consultant: p.consultant || null,
      value: normalizeValue(p.value),
      location: p.location || null,
      region: p.region || null,
      sector: p.sector || 'General',
      status: p.status || 'قيد الدراسة',
      source: p.source || null,
      publishedAt: null,
      scrapedAt: new Date().toISOString(),
      sourceType: 'curated',
      confidence: 5
    });
  }
}

// Deduplicate by title
const final = deduplicate(unified);

// Sort by confidence (highest first)
final.sort((a, b) => b.confidence - a.confidence);

fs.writeFileSync(OUTPUT, JSON.stringify(final, null, 2), 'utf8');

console.log(`\n=== Database Summary ===`);
console.log(`Total unified projects: ${final.length}`);
console.log(`With Owner:      ${final.filter(p => p.owner).length}`);
console.log(`With Contractor: ${final.filter(p => p.contractor).length}`);
console.log(`With Consultant: ${final.filter(p => p.consultant).length}`);
console.log(`With Value:      ${final.filter(p => p.value).length}`);
console.log(`With Location:   ${final.filter(p => p.location).length}`);

const highConf = final.filter(p => p.confidence >= 2);
console.log(`\nHigh confidence (2+ fields): ${highConf.length}`);

// Show top projects
console.log(`\n--- Top Projects by Confidence ---`);
final.slice(0, 15).forEach((p, i) => {
  console.log(`${i + 1}. [${p.confidence}] ${p.title.slice(0, 60)}`);
  if (p.owner)      console.log(`   Owner: ${p.owner.slice(0, 55)}`);
  if (p.contractor) console.log(`   Contractor: ${p.contractor.slice(0, 55)}`);
  if (p.consultant) console.log(`   Consultant: ${p.consultant.slice(0, 55)}`);
  if (p.value)      console.log(`   Value: ${p.value}`);
  if (p.location)   console.log(`   Location: ${p.location}`);
});
