import { chromium } from 'playwright';
import fs from 'fs';
import { resolve } from 'path';

const BASE = 'https://tenders.etimad.sa';
const DELAY_MS = 4000;
const DATA_FILE = resolve('data/etimad_all_tenders.json');
const PROGRESS_FILE = resolve('data/etimad_progress.json');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('Etimad Tenders Scraper — Rate Limited\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Loading main page...');
  await page.goto(BASE + '/Tender/AllTendersForVisitor', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  console.log('Session established\n');

  async function fetchPage(pageNum) {
    const url = BASE + `/Tender/AllSupplierTendersForVisitorAsync?PageSize=24&PublishDateId=5&pageNumber=${pageNum}&_=${Date.now()}`;
    try {
      const resp = await page.evaluate(async (u) => {
        const r = await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        return await r.text();
      }, url);
      return JSON.parse(resp);
    } catch(e) {
      return null;
    }
  }

  // Get first page to know total
  let first = null;
  for (let retry = 0; retry < 3 && !first; retry++) {
    await sleep(2000);
    first = await fetchPage(1);
  }
  if (!first?.data) {
    console.log('Failed to fetch data after retries');
    await browser.close();
    return;
  }

  const totalCount = first.totalCount;
  const pageSize = first.data.length;
  const totalPages = Math.ceil(totalCount / pageSize);
  const allTenders = [];
  const existingIds = new Set();

  // Load existing + progress
  let lastPage = 0;
  if (fs.existsSync(PROGRESS_FILE)) {
    const p = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    lastPage = p.lastPage || 0;
    console.log(`Resuming from page ${lastPage + 1}`);
  }
  if (fs.existsSync(DATA_FILE)) {
    const existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    allTenders.push(...existing);
    for (const t of existing) existingIds.add(t.tenderId);
    console.log(`Loaded existing: ${existing.length}`);
  }

  // Add first page data (skip if already in existing)
  if (lastPage === 0) {
    for (const t of first.data) {
      if (!existingIds.has(t.tenderId)) {
        allTenders.push(t);
        existingIds.add(t.tenderId);
      }
    }
    lastPage = 1;
    console.log(`Page 1: +${first.data.filter(t => existingIds.has(t.tenderId)).length || first.data.length} tenders`);
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastPage }), 'utf8');
  }

  console.log(`Total: ${totalCount} tenders, ${totalPages} pages\n`);

  // Sequential fetch with rate limiting
  for (let p = lastPage + 1; p <= totalPages; p++) {
    await sleep(DELAY_MS);
    const result = await fetchPage(p);

    if (!result?.data) {
      console.log(`  Page ${p}/${totalPages}: FAILED (rate limit), retrying...`);
      await sleep(8000);
      const retryResult = await fetchPage(p);
      if (retryResult?.data) {
        let added = 0;
        for (const t of retryResult.data) {
          if (!existingIds.has(t.tenderId)) { allTenders.push(t); existingIds.add(t.tenderId); added++; }
        }
        console.log(`  Page ${p}/${totalPages}: ✓ ${added} new (retry)`);
      } else {
        console.log(`  Page ${p}/${totalPages}: ✗ skipped`);
      }
    } else {
      let added = 0;
      for (const t of result.data) {
        if (!existingIds.has(t.tenderId)) { allTenders.push(t); existingIds.add(t.tenderId); added++; }
      }
      const progress = `  Page ${p}/${totalPages} (${p/totalPages*100|0}%) — total: ${allTenders.length}/${totalCount} — added: ${added}`;
      process.stdout.write(progress + '\n');
    }

    // Save every 10 pages
    if (p % 10 === 0 || p === totalPages) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(allTenders, null, 2), 'utf8');
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastPage: p }), 'utf8');
    }
  }

  // Final save
  fs.writeFileSync(DATA_FILE, JSON.stringify(allTenders, null, 2), 'utf8');
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ lastPage: totalPages, done: true }), 'utf8');

  console.log(`\n✓ Saved ${allTenders.length} unique tenders`);

  // Stats
  const types = {}, agencies = {}, statuses = {};
  for (const t of allTenders) {
    types[t.tenderTypeName || 'غير محدد'] = (types[t.tenderTypeName || 'غير محدد'] || 0) + 1;
    agencies[t.agencyName || 'غير محدد'] = (agencies[t.agencyName || 'غير محدد'] || 0) + 1;
    statuses[t.tenderStatusId || 0] = (statuses[t.tenderStatusId || 0] || 0) + 1;
  }

  console.log('\n── Status ──');
  Object.entries(statuses).sort((a,b) => b[1] - a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
  console.log('\n── Top Types ──');
  Object.entries(types).sort((a,b) => b[1] - a[1]).slice(0, 10).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
  console.log('\n── Top Agencies ──');
  Object.entries(agencies).sort((a,b) => b[1] - a[1]).slice(0, 10).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
