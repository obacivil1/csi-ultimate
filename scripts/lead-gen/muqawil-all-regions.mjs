/**
 * Muqawil.org API Scraper — All 13 Regions
 * Uses controlled concurrency for speed + reliability
 */
import https from 'https';
import fs from 'fs';
import { resolve } from 'path';

const REGIONS = [
  [1, 'الرياض'], [2, 'مكة المكرمة'], [3, 'المدينة المنورة'],
  [4, 'القصيم'], [5, 'الشرقية'], [6, 'عسير'],
  [7, 'تبوك'], [8, 'حائل'], [9, 'الحدود الشمالية'],
  [10, 'جازان'], [11, 'نجران'], [12, 'الباحة'], [13, 'الجوف']
];

const CONCURRENCY = 4;
const MAX_RETRIES = 3;
const SAVE_INTERVAL = 500;

function fetchJSON(url, retries = 0) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.users === null || j.users === undefined) {
            if (retries < MAX_RETRIES) {
              const wait = 2000 * (retries + 1);
              setTimeout(() => resolve(fetchJSON(url, retries + 1)), wait);
            } else { resolve(null); }
          } else { resolve(j); }
        } catch(e) {
          if (retries < MAX_RETRIES) {
            const wait = 2000 * (retries + 1);
            setTimeout(() => resolve(fetchJSON(url, retries + 1)), wait);
          } else { resolve(null); }
        }
      });
    }).on('error', () => {
      if (retries < MAX_RETRIES) {
        const wait = 2000 * (retries + 1);
        setTimeout(() => resolve(fetchJSON(url, retries + 1)), wait);
      } else { resolve(null); }
    });
  });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scrapeRegion(regionId, regionName) {
  const first = await fetchJSON(`https://muqawil.org/api/contractors?region_id=${regionId}&page=1`);
  if (!first?.users?.total) {
    console.log(`  ${regionName}: 0 records`);
    return [];
  }

  const total = first.users.total;
  const totalPages = Math.ceil(total / 20);
  console.log(`  ${regionName}: ${total} records, ${totalPages} pages`);

  const records = [...(first.users.data || [])];
  for (const r of records) normalize(r, regionName);

  const pageQueue = [];
  for (let p = 2; p <= totalPages; p++) pageQueue.push(p);

  let completed = 1;

  while (pageQueue.length > 0) {
    const batch = pageQueue.splice(0, CONCURRENCY);
    const results = await Promise.all(
      batch.map(p => fetchJSON(`https://muqawil.org/api/contractors?region_id=${regionId}&page=${p}`))
    );

    for (let i = 0; i < batch.length; i++) {
      completed++;
      if (results[i]?.users?.data) {
        for (const r of results[i].users.data) normalize(r, regionName);
        records.push(...results[i].users.data);
      }
    }

    if (completed % 40 === 0 || completed === totalPages) {
      console.log(`  ${regionName}: ${completed}/${totalPages} pages (${records.length}/${total})`);
    }

    if (records.length % SAVE_INTERVAL < CONCURRENCY && regionId === 1) {
      // Progressive save for first region
      const tmpPath = resolve('data/muqawil_all_regions_PARTIAL.json');
      fs.writeFileSync(tmpPath, JSON.stringify({ inProgress: true, records, regionId, regionName, completed }, null, 2), 'utf8');
    }
  }

  console.log(`  ${regionName}: done (${records.length} records)`);
  return records;
}

function normalize(r, regionName) {
  r.region_name = regionName;
  r.source = 'api';
  r.companyName = r.organization_name_ar || r.organization_name || '';
  r.membershipNo = r.member_number || '';
  r.companySize = r.company_size || '';
  r.cityName = r.city?.name || '';
  r.phone = '';
  r.email = '';
}

async function main() {
  console.log('Muqawil.org — All Regions Scraper\n');

  const allRecords = [];

  for (const [regionId, regionName] of REGIONS) {
    const records = await scrapeRegion(regionId, regionName);
    allRecords.push(...records);
  }

  console.log(`\nTotal from API: ${allRecords.length}`);

  // Merge enriched data
  const enrichedPath = resolve('data/muqawil_leads_riyadh_all.json');
  if (fs.existsSync(enrichedPath)) {
    const enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf8'));
    const enrichedMap = new Map();
    for (const r of enriched) {
      if (r.email && r.email.length > 3) {
        enrichedMap.set(String(r.membershipNo || r.id), r);
      }
    }

    let merged = 0;
    for (const r of allRecords) {
      const key = r.membershipNo || r.id;
      if (key && enrichedMap.has(String(key))) {
        const e = enrichedMap.get(String(key));
        r.phone = e.phone || '';
        r.email = e.email || '';
        r.domain = e.domain || '';
        r.address = e.address || '';
        r.contractorType = e.contractorType || '';
        r.source = 'enriched';
        merged++;
      }
    }
    console.log(`Merged enriched: ${merged}`);
  }

  const outputPath = resolve('data/muqawil_all_regions.json');
  fs.writeFileSync(outputPath, JSON.stringify(allRecords, null, 2), 'utf8');
  console.log(`\n✓ Saved: ${outputPath}`);

  const withEmail = allRecords.filter(r => r.email).length;
  const byRegion = {};
  for (const r of allRecords) {
    const region = r.region_name || 'غير محدد';
    byRegion[region] = (byRegion[region] || 0) + 1;
  }

  console.log(`\n── Final Summary ──`);
  console.log(`Total: ${allRecords.length}`);
  console.log(`With email: ${withEmail}`);
  for (const [region, count] of Object.entries(byRegion).sort((a, b) => b[1] - a[1])) {
    const e = allRecords.filter(r => r.region_name === region && r.email).length;
    console.log(`  ${region}: ${count} (${e} with email)`);
  }
  console.log(`\nDone!`);
}

main().catch(console.error);
