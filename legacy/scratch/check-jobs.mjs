import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
import * as fs from 'fs';

const jobs = [];
const seen = new Set();

async function checkExpat() {
  console.log('=== Expatriates.com (Playwright) ===');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  try {
    await page.goto('https://www.expatriates.com/scripts/search-results2.class.php?query=Planning+Engineer&type=all&category=&country=Saudi+Arabia&region=&search=Search', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    const results = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="cls/"]');
      const out = [];
      const dedup = new Set();
      links.forEach(a => {
        const href = a.href;
        if (dedup.has(href)) return;
        dedup.add(href);
        const text = a.innerText?.trim() || '';
        const parent = a.closest('table, div.item, li, .result') || a.parentElement;
        const extra = parent?.innerText?.trim() || '';
        out.push({ title: text, url: href, snippet: extra.substring(0, 300) });
      });
      return out;
    });
    console.log(`  Found ${results.length} total links`);
    for (const r of results) {
      const txt = (r.title + ' ' + r.snippet).toLowerCase();
      if (txt.includes('planning') || txt.includes('scheduler') || txt.includes('planner') || txt.includes('project control')) {
        const key = r.title + r.url;
        if (!seen.has(key)) { seen.add(key); jobs.push({ ...r, source: 'Expatriates.com', scrapedAt: new Date().toISOString() }); }
      }
    }
    console.log(`  Planning-related: ${jobs.length}`);
  } catch(e) { console.log(`  Error: ${e.message}`); }
  await browser.close();
}

async function fetchSites() {
  console.log('\n=== Fetch-based ===');
  const urls = [
    { name: 'GulfJobs', url: 'https://www.gulfjobs.com/job-search?q=Planning+Engineer&country=sa' },
    { name: 'SimplyHired', url: 'https://www.simplyhired.com/search?q=Planning+Engineer&l=Saudi+Arabia' },
  ];
  for (const site of urls) {
    try {
      const r = await fetch(site.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000)
      });
      const html = await r.text();
      console.log(`  ${site.name}: HTTP ${r.status}, ${html.length} bytes`);
      // Try to extract titles from HTML
      const titles = html.match(/<h[23][^>]*>([^<]+planning[^<]+)/gi) || [];
      for (const t of titles) {
        const title = t.replace(/<[^>]+>/g, '').trim();
        if (title) {
          const key = title;
          if (!seen.has(key)) { seen.add(key); jobs.push({ title, url: site.url, source: site.name, scrapedAt: new Date().toISOString() }); }
        }
      }
    } catch(e) { console.log(`  ${site.name}: ${e.message}`); }
  }
}

async function checkBaytDirect() {
  console.log('\n=== Bayt.com (Playwright) ===');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  try {
    await page.goto('https://www.bayt.com/en/saudi-arabia/jobs/planning-engineer-jobs/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    const results = await page.evaluate(() => {
      const cards = document.querySelectorAll('.has-pointer-cursor, .card, article, .job-card, [class*=job-]');
      return Array.from(cards).slice(0, 30).map(c => {
        const title = c.querySelector('h2, h1, [class*=title]')?.innerText?.trim() || '';
        const company = c.querySelector('[class*=company]')?.innerText?.trim() || '';
        const location = c.querySelector('[class*=location]')?.innerText?.trim() || '';
        const date = c.querySelector('[class*=date], time')?.innerText?.trim() || '';
        const link = c.querySelector('a')?.href || '';
        return { title, company, location, date, link };
      }).filter(x => x.title);
    });
    console.log(`  ${results.length} jobs`);
    for (const r of results) {
      const key = r.title + r.company;
      if (!seen.has(key)) { seen.add(key); jobs.push({ ...r, source: 'Bayt.com', scrapedAt: new Date().toISOString() }); }
    }
  } catch(e) { console.log(`  Error: ${e.message}`); }
  await browser.close();
}

await checkExpat();
await fetchSites();
await checkBaytDirect();

console.log(`\n========== ${jobs.length} Planning Engineer Jobs ==========`);
jobs.forEach((j, i) => {
  const extra = j.company ? ` @ ${j.company}` : '';
  const loc = j.location ? ` - ${j.location}` : '';
  const date = j.date ? ` (${j.date})` : '';
  console.log(`${i+1}. ${j.title}${extra} [${j.source}]${loc}${date}`);
});

fs.writeFileSync('data/planning_engineer_jobs.json', JSON.stringify(jobs, null, 2));
console.log(`\nSaved to data/planning_engineer_jobs.json`);
