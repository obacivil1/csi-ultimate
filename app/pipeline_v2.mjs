import { chromium } from 'playwright';
import pptxgen from 'pptxgenjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(__dirname, '..', 'output');
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
});
const page = await ctx.newPage();

// === STEP 1: Open PM World Library directly to an article ===
console.log('1. Opening PM World Library article...');
// تحديات التقويم والجدولة والتخطيط بالانجليزية - أطول مقال
await page.goto('https://pmworldlibrary.net/category/planning-scheduling/', {
  waitUntil: 'domcontentloaded', timeout: 25000,
});
await page.waitForTimeout(3000);
console.log(`   Title: ${await page.title()}`);

// === STEP 2: Find articles on the page ===
const found = await page.evaluate(() => {
  const items = [];
  for (const link of document.querySelectorAll('a[href*="pmworldlibrary"]')) {
    const text = link.textContent?.trim();
    const href = link.href.trim();
    if (text && text.length > 30 && href.includes('pmworldlibrary') && !href.includes('category') && !href.includes('#')) {
      // check if link inside a h2/h3 (article title)
      const isHeader = link.closest('h1,h2,h3,h4,h5');
      items.push({ text: text.replace(/\s+/g, ' ').slice(0, 120), url: href, header: !!isHeader });
    }
  }
  return items.filter(x => x.header).slice(0, 15);
});
console.log(`   Found ${found.length} article links`);
found.slice(0, 8).forEach((a, i) => console.log(`   ${i+1}. ${a.text.slice(0, 80)}`));

if (found.length === 0) {
  // Fallback: search for known articles
  console.log('   No articles on page, trying Google...');
  // ... fallback code
}

// === STEP 3: Click on the first article ===
const target = found[0];
console.log(`\n2. Opening article: ${target.text.slice(0, 70)}`);
await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
await page.waitForTimeout(3000);
console.log(`   Title: ${await page.title()}`);

// === STEP 4: Extract full content ===
const content = await page.evaluate(() => {
  // Remove clutter
  for (const sel of ['nav', 'header', 'footer', '.sidebar', '.comments', '.widget', '.site-header', '.site-footer', '.ad', '.ads', '.menu', 'script', 'style', 'noscript', 'iframe']) {
    document.querySelectorAll(sel).forEach(el => el.remove());
  }

  const title = document.querySelector('h1')?.textContent?.trim() || document.title;
  const article = document.querySelector('article, .entry-content, .post-content, .content-area, main, [role="main"]') || document.body;

  // Get all meaningful paragraphs
  const paragraphs = Array.from(article.querySelectorAll('p')).map(p => p.textContent.trim()).filter(p => p.length > 40);
  const body = article.innerText.trim();

  const meta = {};

  // Author
  const authorEl = document.querySelector('[rel="author"], .author, .byline, .post-author, [itemprop="author"]');
  if (authorEl) meta.author = authorEl.textContent.trim().slice(0, 100);

  // Date
  const dateEl = document.querySelector('time, .date, .post-date, .published, [itemprop="datePublished"]');
  if (dateEl) meta.date = (dateEl.textContent || dateEl.getAttribute('datetime') || '').trim().slice(0, 80);

  return {
    title: title.replace(/\s+/g, ' '),
    paragraphs,
    body: body.slice(0, 20000),
    meta,
    wordCount: body.split(/\s+/).length,
  };
});

console.log(`   Title: ${content.title}`);
console.log(`   Author: ${content.meta.author || 'N/A'}`);
console.log(`   Date: ${content.meta.date || 'N/A'}`);
console.log(`   Words: ${content.wordCount}`);
console.log(`   Paragraphs: ${content.paragraphs.length}`);

if (content.paragraphs.length < 3) {
  console.log('❌ Not enough content, trying fallback scraping...');
  // Fallback to direct text extraction
  await page.goto('about:blank');
  // Read from text
  const text = await page.evaluate(() => document.body.innerText);
  content.paragraphs = text.split('\n').map(l => l.trim()).filter(l => l.length > 40);
  content.wordCount = text.split(/\s+/).length;
  console.log(`   Fallback paragraphs: ${content.paragraphs.length}`);
}

// === STEP 5: Save data ===
const dataFile = path.join(OUTPUT, `article_${Date.now()}.json`);
fs.writeFileSync(dataFile, JSON.stringify(content, null, 2), 'utf-8');
console.log(`\n3. Saved: ${dataFile}`);

// === STEP 6: Generate PowerPoint ===
console.log('\n4. Generating PowerPoint...');
const pptx = new pptxgen();
const paras = content.paragraphs;
const maxSlides = Math.min(Math.ceil(paras.length / 3) + 2, 25);
const totalSlides = Math.max(maxSlides, 3);

// Slide 1: Title
const s1 = pptx.addSlide();
s1.background = { color: '1A1A2E' };
s1.addText('CSI Ultimate — Scraped Presentation', { x: 0.4, y: 0.2, w: 9.2, h: 0.4, fontSize: 11, color: '3B82F6', bold: true });
s1.addShape(pptx.ShapeType.rect, { x: 0.4, y: 0.65, w: 9.2, h: 0.02, fill: { color: '1E293B' } });
s1.addText(content.title, {
  x: 0.5, y: 1.2, w: 9, h: 1.8,
  fontSize: 24, color: 'FFFFFF', bold: true, align: 'center', valign: 'center',
});
s1.addText(`🖥️ ${content.wordCount.toLocaleString()} words • ${paras.length} paragraphs`, {
  x: 0.5, y: 3.3, w: 9, h: 0.4, fontSize: 13, color: '94A3B8', align: 'center',
});
if (content.meta.author)
  s1.addText(`✍️ ${content.meta.author}`, { x: 0.5, y: 3.8, w: 9, h: 0.4, fontSize: 12, color: '64748B', align: 'center' });
if (content.meta.date)
  s1.addText(`📅 ${content.meta.date}`, { x: 0.5, y: 4.2, w: 9, h: 0.4, fontSize: 12, color: '64748B', align: 'center' });
s1.addText(target.url, { x: 0.5, y: 5.8, w: 9, h: 0.3, fontSize: 9, color: '334155', align: 'center' });

// Content slides
let slideIdx = 2;
for (let i = 0; i < paras.length && slideIdx <= maxSlides; i += 3) {
  const group = paras.slice(i, i + 3);
  const slide = pptx.addSlide();
  slide.background = { color: '0F0F1F' };

  slide.addText('CSI Ultimate', { x: 0.4, y: 0.15, w: 5, h: 0.35, fontSize: 9, color: '3B82F6' });
  slide.addText(`${slideIdx} / ${totalSlides}`, { x: 8.5, y: 0.15, w: 1, h: 0.35, fontSize: 9, color: '475569', align: 'right' });
  slide.addShape(pptx.ShapeType.rect, { x: 0.4, y: 0.55, w: 9.2, h: 0.02, fill: { color: '1E293B' } });

  group.forEach((p, pi) => {
    const short = p.length > 300 ? p.slice(0, 297) + '…' : p;
    slide.addText(`▸ ${short}`, {
      x: 0.5, y: 0.85 + pi * 1.7, w: 9, h: 1.5,
      fontSize: 12, color: 'D0D0E0', valign: 'top',
      lineSpacingMultiple: 1.3,
    });
  });
  slideIdx++;
}

// End slide
const end = pptx.addSlide();
end.background = { color: '0A1A0A' };
end.addText('✓ Complete — تـم', { x: 0.5, y: 2, w: 9, h: 1, fontSize: 30, color: '10B981', bold: true, align: 'center' });
end.addText('Full auto-generated presentation from scraped web content', {
  x: 0.5, y: 3.2, w: 9, h: 0.5, fontSize: 14, color: '94A3B8', align: 'center',
});
end.addText(`CSI Ultimate Engine • ${content.wordCount.toLocaleString()} words`, {
  x: 0.5, y: 5.0, w: 9, h: 0.3, fontSize: 10, color: '475569', align: 'center',
});

const outName = `presentation_${Date.now()}.pptx`;
const outPath = path.join(OUTPUT, outName);
await pptx.writeFile({ fileName: outPath });
console.log(`\n5. ✅ ${outPath}`);
console.log(`   ${slideIdx} slides • ${content.wordCount.toLocaleString()} words • ${paras.length} paragraphs`);

await browser.close();
