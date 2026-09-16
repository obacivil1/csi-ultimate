import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://tenders.etimad.sa';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(BASE + '/Tender/AllTendersForVisitor', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);

async function fetchRaw(pn) {
  await new Promise(r => setTimeout(r, 5000));
  const url = BASE + '/Tender/AllSupplierTendersForVisitorAsync?PageSize=24&PublishDateId=5&pageNumber=' + pn + '&_=' + Date.now();
  const text = await page.evaluate(async (u) => {
    const r = await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    return await r.text();
  }, url);
  console.log('Page ' + pn + ' (' + text.length + ' chars): ' + text.substring(0, 300));
}

// Test a few pages
await fetchRaw(340);
await fetchRaw(341);
await fetchRaw(342);
await fetchRaw(1);

await browser.close();
