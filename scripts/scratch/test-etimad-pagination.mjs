import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'https://tenders.etimad.sa';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Load main page
await page.goto(BASE + '/Tender/AllTendersForVisitor', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

async function fetchPage(pageNum) {
  const url = BASE + `/Tender/AllSupplierTendersForVisitorAsync?PageSize=24&PublishDateId=5&pageNumber=${pageNum}&_=${Date.now()}`;
  try {
    const resp = await page.evaluate(async (u) => {
      const r = await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      return await r.text();
    }, url);
    return JSON.parse(resp);
  } catch(e) {
    return { error: e.message, raw: null };
  }
}

// Test pagination: pages 1, 2, 3, 4, 5 with delays
for (let p = 1; p <= 5; p++) {
  console.log(`\nFetching page ${p}...`);
  const result = await fetchPage(p);
  
  if (result.error) {
    console.log(`  ERROR: ${result.error}`);
  } else {
    console.log(`  Total: ${result.totalCount}, Current: ${result.currentPage}, Data: ${result.data?.length || 0}`);
    if (result.data && result.data.length > 0) {
      console.log(`  First: ${result.data[0].tenderId} - ${result.data[0].tenderName.substring(0, 40)}`);
      console.log(`  Last: ${result.data[result.data.length - 1].tenderId} - ${result.data[result.data.length - 1].tenderName.substring(0, 40)}`);
    }
  }
  
  if (p < 5) {
    console.log('  Waiting 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));
  }
}

await browser.close();
