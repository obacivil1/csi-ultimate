import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const base = 'https://tenders.etimad.sa';

// First load the main page to establish session
await page.goto(base + '/Tender/AllTendersForVisitor', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

// Try the XHR endpoint with larger page size
async function getTenders(pageNum, pageSize = 50, publishDateId = 5) {
  const url = base + `/Tender/AllSupplierTendersForVisitorAsync?PageSize=${pageSize}&PublishDateId=${publishDateId}&pageNumber=${pageNum}&_=${Date.now()}`;
  const resp = await page.evaluate(async (u) => {
    const r = await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    return await r.text();
  }, url);
  return JSON.parse(resp);
}

// Try first page with pageSize 50
const first = await getTenders(1, 50);
console.log('Total records:', first.recordsTotal || first.total || first.recordsFiltered || 'unknown');
console.log('Data count:', first.data?.length || first.length || 0);

if (first.data && first.data.length > 0) {
  console.log('\nFields in first record:');
  Object.keys(first.data[0]).forEach(k => console.log(' ', k, ':', typeof first.data[0][k], '=', String(first.data[0][k]).substring(0, 80)));
}

console.log('\nFull response keys:', Object.keys(first));

// Try different publishDateId values to get all tenders
console.log('\n\nTrying publishDateId=0 (all tenders)...');
const all = await getTenders(1, 50, 0);
console.log('Total records:', all.recordsTotal || all.total || all.recordsFiltered || 'unknown');
console.log('Data count:', all.data?.length || 0);

// Save a sample
import fs from 'fs';
fs.writeFileSync('data/etimad_sample.json', JSON.stringify(first, null, 2), 'utf8');
console.log('\nSaved sample to data/etimad_sample.json');

await browser.close();
