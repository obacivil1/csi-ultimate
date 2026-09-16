import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://tenders.etimad.sa';
const DATA_FILE = 'data/etimad_all_tenders.json';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(BASE + '/Tender/AllTendersForVisitor', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

const all = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const existingIds = new Set(all.map(t => t.tenderId));

async function fetchPage(pn) {
  const url = BASE + `/Tender/AllSupplierTendersForVisitorAsync?PageSize=24&PublishDateId=5&pageNumber=${pn}&_=${Date.now()}`;
  const resp = await page.evaluate(async (u) => {
    const r = await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    return await r.text();
  }, url);
  return JSON.parse(resp);
}

// Fetch pages 341 and 342
for (const pn of [341, 342]) {
  await new Promise(r => setTimeout(r, 5000));
  console.log(`Fetching page ${pn}...`);
  const result = await fetchPage(pn);
  if (result?.data) {
    let added = 0;
    for (const t of result.data) {
      if (!existingIds.has(t.tenderId)) {
        all.push(t);
        existingIds.add(t.tenderId);
        added++;
      }
    }
    console.log(`  Added ${added} new, total: ${all.length}`);
  } else {
    console.log(`  FAILED`);
  }
}

fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), 'utf8');
fs.writeFileSync('data/etimad_progress.json', JSON.stringify({ lastPage: 343, done: true }), 'utf8');
console.log(`\nFinal: ${all.length} tenders`);

await browser.close();
