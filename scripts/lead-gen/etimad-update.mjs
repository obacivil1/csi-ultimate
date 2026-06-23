import { chromium } from 'playwright';
import fs from 'fs';
import { resolve } from 'path';

const BASE = 'https://tenders.etimad.sa';
const DATA_FILE = resolve('data/etimad_all_tenders.json');

async function main() {
  console.log('Etimad Quick Update — fetching newest pages only\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Loading main page...');
  await page.goto(BASE + '/Tender/AllTendersForVisitor', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log('Session established\n');

  async function fetchPage(pageNum) {
    const url = BASE + `/Tender/AllSupplierTendersForVisitorAsync?PageSize=24&PublishDateId=5&pageNumber=${pageNum}&_=${Date.now()}`;
    try {
      const resp = await page.evaluate(async (u) => {
        const r = await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        return await r.text();
      }, url);
      return JSON.parse(resp);
    } catch { return null; }
  }

  // Load existing data
  let allTenders = [];
  const existingIds = new Set();
  if (fs.existsSync(DATA_FILE)) {
    allTenders = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const t of allTenders) existingIds.add(t.tenderId);
    console.log(`Loaded existing: ${allTenders.length} tenders`);
  }

  // Fetch first 3 pages (newest 72 tenders)
  let newCount = 0;
  for (let p = 1; p <= 3; p++) {
    await new Promise(r => setTimeout(r, 3000));
    const result = await fetchPage(p);
    if (result?.data) {
      for (const t of result.data) {
        if (!existingIds.has(t.tenderId)) {
          allTenders.push(t);
          existingIds.add(t.tenderId);
          newCount++;
        }
      }
      console.log(`  Page ${p}: ${result.data.length} items, ${newCount} new so far`);
    } else {
      console.log(`  Page ${p}: FAILED`);
    }
  }

  if (newCount > 0) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(allTenders, null, 2), 'utf8');
    console.log(`\n✓ Added ${newCount} new tenders — total: ${allTenders.length}`);
  } else {
    console.log('\n✓ No new tenders found — data is up to date');
  }

  await browser.close();
  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
