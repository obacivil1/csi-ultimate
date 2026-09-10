import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(__dirname, '..', 'output');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });

// Try Al Jazeera Arabic
const url = 'https://www.aljazeera.net/';
console.log('1. Loading:', url);
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  console.log('   Title:', await page.title());
} catch (e) {
  console.log('   Error loading:', e.message);
  // Try English
  await page.goto('https://www.aljazeera.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  console.log('   English Title:', await page.title());
}

await page.waitForTimeout(2000);

// Extract article links
const articles = await page.evaluate(() => {
  const items = []; const seen = new Set();
  
  // Try common article selectors
  const selectors = [
    'article a[href]', 'h1 a[href]', 'h2 a[href]', 'h3 a[href]', 'h4 a[href]',
    '[class*="title"] a[href]', '[class*="headline"] a[href]',
    '[class*="article"] a[href]', '[class*="story"] a[href]',
    'a[href*="/news/"]', 'a[href*="/article/"]', 'a[href*="/story/"]',
    'a[href*="/video/"]',
  ];
  
  for (const sel of selectors) {
    for (const a of document.querySelectorAll(sel)) {
      if (items.length >= 30) break;
      const href = a.href.trim();
      const text = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150);
      if (!href || !text || text.length < 10) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      if (href.startsWith('javascript:') || href === '#') continue;
      if (a.closest('nav, header, footer, .nav, .menu, .footer')) continue;
      
      // Get parent for description
      const parent = a.closest('article, li, div[class*="card"], div[class*="item"], div[class*="story"]');
      let desc = '', date = '';
      if (parent) {
        const all = parent.textContent.replace(/\s+/g, ' ').trim();
        desc = all.replace(text, '').slice(0, 200);
        const d = parent.querySelector('time, [datetime], [class*="date"], [class*="time"]');
        if (d) date = d.textContent?.trim()?.slice(0, 40) || d.getAttribute('datetime') || '';
      }
      
      items.push({ title: text, url: href.slice(0, 300), description: desc, date, source: window.location.hostname });
    }
    if (items.length >= 30) break;
  }
  
  return items;
});

console.log(`\n2. Found ${articles.length} articles`);
articles.slice(0, 20).forEach((a, i) => {
  console.log(`\n${i+1}. ${a.title}`);
  console.log(`   ${a.url}`);
  if (a.date) console.log(`   📅 ${a.date}`);
  if (a.description) console.log(`   ${a.description.slice(0, 100)}`);
});

// Save
if (articles.length > 0) {
  const name = `aljazeera_${Date.now()}.json`;
  fs.writeFileSync(path.join(OUTPUT, name), JSON.stringify(articles, null, 2), 'utf-8');
  console.log(`\n3. Saved to ${name}`);
}

await browser.close();
