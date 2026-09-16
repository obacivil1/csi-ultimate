import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://tenders.etimad.sa';
const DATA_FILE = 'data/etimad_all_tenders.json';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(BASE + '/Tender/AllTendersForVisitor', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);

const all = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const existingIds = new Set(all.map(t => t.tenderId));

console.log('Existing: ' + all.length + ', expecting 8196, need pages 341-342\n');

async function fetchPage(pn) {
  const url = BASE + '/Tender/AllSupplierTendersForVisitorAsync?PageSize=24&PublishDateId=5&pageNumber=' + pn + '&_=' + Date.now();
  const text = await page.evaluate(async (u) => {
    const r = await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    return await r.text();
  }, url);
  return JSON.parse(text);
}

await new Promise(r => setTimeout(r, 6000));
const p341 = await fetchPage(341);
console.log('Page 341: data=' + (p341.data ? p341.data.length : 'FAIL'));
if (p341.data) {
  let a = 0;
  for (const t of p341.data) { if (!existingIds.has(t.tenderId)) { all.push(t); existingIds.add(t.tenderId); a++; } }
  console.log('  Added: ' + a);
}

await new Promise(r => setTimeout(r, 6000));
const p342 = await fetchPage(342);
console.log('Page 342: data=' + (p342.data ? p342.data.length : 'FAIL'));
if (p342.data) {
  let a = 0;
  for (const t of p342.data) { if (!existingIds.has(t.tenderId)) { all.push(t); existingIds.add(t.tenderId); a++; } }
  console.log('  Added: ' + a);
}

fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), 'utf8');
fs.writeFileSync('data/etimad_progress.json', JSON.stringify({ lastPage: 343, done: true }), 'utf8');
console.log('\nFinal: ' + all.length + ' tenders');

await browser.close();
