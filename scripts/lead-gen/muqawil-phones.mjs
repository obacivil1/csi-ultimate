/**
 * Muqawil.org Phone Scraper — Extract phones from detail pages
 */
import { chromium } from 'playwright';
import fs from 'fs';
import { resolve } from 'path';

const CONCURRENCY = 6;
const DATA_FILE = resolve('data/muqawil_all_regions.json');
const PROGRESS_FILE = resolve('data/phoneprogress.json');

async function scrapeOne(page, id) {
  try {
    const url = `https://muqawil.org/ar/contractors/${id}/143`;
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (resp?.status() !== 200) return { id, phone: '', email: '' };
    await page.waitForTimeout(2000);
    
    const html = await page.content();
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    
    let phone = '', email = '';
    const pi = text.indexOf('جوال ');
    if (pi > -1) {
      const after = text.substring(pi, pi + 100);
      const m = after.match(/(\d[\d\s\-]{6,15})/);
      if (m) phone = m[1].trim();
    }
    const em = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (em) email = em[0].toLowerCase();
    return { id, phone, email };
  } catch(e) {
    return { id, phone: '', email: '' };
  }
}

async function main() {
  const all = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  
  // Only IDs with 8+ digits starting with 200 or 201 (known to work)
  const needPhone = all.filter(r => {
    if (r.phone) return false;
    const s = String(r.id || '');
    return s.length >= 8 && (s.startsWith('200') || s.startsWith('201'));
  });
  
  console.log(`Targeting ${needPhone.length} contractors\n`);

  // Load progress
  let processed = new Set();
  if (fs.existsSync(PROGRESS_FILE)) {
    const p = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    processed = new Set(p.processed || []);
    console.log(`Already processed: ${processed.size}`);
  }

  const todo = needPhone.filter(r => !processed.has(String(r.id)));
  console.log(`Remaining: ${todo.length}\n`);

  if (todo.length === 0) { console.log('All done!'); return; }

  const browser = await chromium.launch({ headless: true });
  const pages = await Promise.all(Array.from({length: CONCURRENCY}, () => browser.newPage()));

  let phoneCount = 0, emailCount = 0, total = 0;

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((r, idx) => scrapeOne(pages[idx], r.id)));

    for (const r of results) {
      processed.add(String(r.id));
      total++;
      const record = all.find(x => String(x.id) === String(r.id));
      if (record) {
        if (r.phone) { record.phone = r.phone; phoneCount++; }
        if (r.email && !record.email) { record.email = r.email; emailCount++; }
      }
    }

    if (total % 30 < CONCURRENCY) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), 'utf8');
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({processed: [...processed]}), 'utf8');
      const pct = (total / todo.length * 100).toFixed(1);
      process.stdout.write(`\r  ${total}/${todo.length} (${pct}%) — phones: ${phoneCount}, emails: ${emailCount}  `);
    }
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), 'utf8');
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({processed: [...processed], done: true}), 'utf8');

  await Promise.all(pages.map(p => p.close()));
  await browser.close();

  const finalPhone = all.filter(r => r.phone).length;
  const finalEmail = all.filter(r => r.email).length;
  console.log(`\n\nDone! Phones: ${finalPhone}, Emails: ${finalEmail}`);
}

main().catch(console.error);
