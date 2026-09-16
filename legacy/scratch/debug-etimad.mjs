import { chromium } from 'playwright';

const BASE = 'https://tenders.etimad.sa';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(BASE + '/Tender/AllTendersForVisitor', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);

console.log('Testing API with fresh session...\n');

// Test pages with increasing delays
for (const pn of [1, 2]) {
  await new Promise(r => setTimeout(r, 6000));
  const url = BASE + '/Tender/AllSupplierTendersForVisitorAsync?PageSize=24&PublishDateId=5&pageNumber=' + pn + '&_=' + Date.now();
  try {
    const text = await page.evaluate(async (u) => {
      const r = await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      return await r.text();
    }, url);
    console.log('Page', pn, ':', text.substring(0, 200));
  } catch(e) {
    console.log('Page', pn, 'ERROR:', e.message);
  }
}

await browser.close();
