import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(__dirname, '..', 'output');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  viewport: { width: 1280, height: 800 },
});

// 1) Try Yalla Shot for Iraq vs France
const sites = [
  { name: 'يلا شوت', url: 'https://www.yallashoot.io/' },
  { name: 'كورة لايف', url: 'https://kooralive.tv/' },
  { name: 'بيرفوت', url: 'https://barefoottv.online/' },
  { name: 'بي إن سبورت', url: 'https://www.bein.com/ar/' },
];

for (const site of sites) {
  console.log(`\n=== ${site.name}: ${site.url} ===`);
  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    const title = await page.title();
    console.log(`Title: ${title}`);

    // Extract all links mentioning Iraq or France or World Cup
    const links = await page.evaluate(() => {
      const items = []; const seen = new Set();
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.href.trim();
        const text = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        if (!href || !text || text.length < 5 || seen.has(href)) continue;
        seen.add(href);
        const lower = text.toLowerCase() + ' ' + href.toLowerCase();
        if (lower.includes('عراق') || lower.includes('iraq') || lower.includes('فرنسا') || lower.includes('france') || lower.includes('كأس العالم') || lower.includes('world cup') || lower.includes('مونديال') || lower.includes('2026')) {
          items.push({ title: text, url: href.slice(0, 300) });
        }
      }
      return items;
    });

    if (links.length > 0) {
      console.log(`Found ${links.length} relevant links:`);
      links.slice(0, 10).forEach((l, i) => console.log(`  ${i+1}. ${l.title}\n     ${l.url}`));
    } else {
      console.log('No match-related links found');
    }
  } catch (e) {
    console.log(`Error: ${e.message.slice(0, 80)}`);
  }
}

// 2) Try Google search for the match stream
console.log(`\n=== بحث جوجل عن البث المباشر ===`);
try {
  await page.goto('https://www.google.com/search?q=%D8%A7%D9%84%D8%B9%D8%B1%D8%A7%D9%82+%D9%81%D8%B1%D9%86%D8%B3%D8%A7+%D8%A8%D8%AB+%D9%85%D8%A8%D8%A7%D8%B4%D8%B1+%D9%83%D8%A3%D8%B3+%D8%A7%D9%84%D8%B9%D8%A7%D9%84%D9%85+2026', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  console.log(`Title: ${await page.title()}`);

  const results = await page.evaluate(() => {
    const items = []; const seen = new Set();
    for (const a of document.querySelectorAll('a[href^="http"]')) {
      const href = a.href.trim();
      const text = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150);
      if (!href || !text || text.length < 10 || seen.has(href)) continue;
      seen.add(href);
      if (text.toLowerCase().includes('google') || href.includes('google.com')) continue;
      items.push({ title: text, url: href.slice(0, 300) });
    }
    return items;
  });

  console.log(`Found ${results.length} results:`);
  results.slice(0, 15).forEach((r, i) => console.log(`  ${i+1}. ${r.title}\n     ${r.url}`));

  if (results.length > 0) {
    const name = `worldcup_streams_${Date.now()}.json`;
    fs.writeFileSync(path.join(OUTPUT, name), JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\nSaved to ${name}`);
  }
} catch (e) {
  console.log(`Error: ${e.message.slice(0, 80)}`);
}

await browser.close();
console.log('\nDone');
