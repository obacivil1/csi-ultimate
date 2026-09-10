import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(__dirname, '..', 'output');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });

await page.goto('https://www.expatriates.com/classifieds/', { waitUntil: 'domcontentloaded', timeout: 15000 });

// Detect form
const fi = await page.evaluate(() => {
  const f = document.querySelector('form[action*="search"]');
  if (!f) return null;
  const q = f.querySelector('input[name="q"]');
  return q ? { action: f.getAttribute('action'), qName: 'q' } : null;
});
console.log('Form:', JSON.stringify(fi));

// Build Arabic search URL
const search = encodeURIComponent('مهندس تخطيط');
const su = 'https://www.expatriates.com/scripts/search/search.epl?q=' + search;
console.log('Search URL:', su);

await page.goto(su, { waitUntil: 'domcontentloaded', timeout: 15000 });
console.log('Title:', await page.title());

// Extract ALL links (no keyword filter)
const links = await page.evaluate((limit) => {
  const items = []; const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    if (items.length >= limit) break;
    if (a.closest('nav, header, footer, .nav, .header, .footer, .menu')) continue;
    const href = a.href.trim();
    const text = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150);
    if (!href || !text || text.length < 4 || href.startsWith('javascript:') || href === '#') continue;
    if (seen.has(href)) continue;
    seen.add(href);
    items.push({ title: text, url: href.slice(0, 200) });
  }
  return items;
}, 30);
console.log('Total links:', links.length);
links.slice(0, 15).forEach((d, i) => console.log((i+1) + '. ' + d.title + ' -> ' + d.url));

// Save for inspection
if (links.length > 0) {
  const name = 'arabic_search_' + Date.now() + '.json';
  fs.writeFileSync(path.join(OUTPUT, name), JSON.stringify(links, null, 2), 'utf-8');
  console.log('\nSaved to:', name);
}

await browser.close();
