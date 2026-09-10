import { chromium } from 'playwright';
import pptxgen from 'pptxgenjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(__dirname, '..', 'output');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  viewport: { width: 1280, height: 800 },
});

// 1. افتح Planning Planet
console.log('1. Opening Planning Planet...');
await page.goto('https://www.planningplanet.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
console.log(`   Title: ${await page.title()}`);

// 2. استخرج روابط المقالات من الصفحة الرئيسية
const articles = await page.evaluate(() => {
  const items = []; const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href.trim();
    const text = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150);
    if (!href || !text || text.length < 15 || seen.has(href)) continue;
    if (a.closest('nav,.nav,.menu,header,.header,footer,.footer')) continue;
    if (href.startsWith('javascript:') || href === '#') continue;
    seen.add(href);
    
    const cat = href.includes('/blog/') ? 'مدونة' : href.includes('/forum/') ? 'منتدى' : href.includes('/group/') ? 'مجموعة' : 'عام';
    items.push({ title: text, url: href, category: cat });
  }
  return items.filter(a => a.title.length > 20).slice(0, 25);
});

console.log(`   Found ${articles.length} articles`);
articles.slice(0, 10).forEach((a, i) => console.log(`   ${i+1}. [${a.category}] ${a.title.slice(0, 70)}`));

// 3. اختر أول مقال في المدونة
const blogArticle = articles.find(a => a.category === 'مدونة') || articles[0];
console.log(`\n2. Reading article: ${blogArticle.title}`);

await page.goto(blogArticle.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);

// 4. استخرج المحتوى الكامل
const content = await page.evaluate(() => {
  // إزالة العناصر غير المرغوب فيها
  document.querySelectorAll('nav, header, footer, .ads, .sidebar, .comments').forEach(el => el.remove());
  
  const main = document.querySelector('article, .node-content, .content, main, .region-content') || document.body;
  const title = document.querySelector('h1')?.textContent?.trim() || document.title;
  const paragraphs = Array.from(main.querySelectorAll('p')).map(p => p.textContent.trim()).filter(p => p.length > 30);
  const bodyText = main.innerText.trim();
  
  const author = document.querySelector('[rel="author"], .author, .byline, .submitted')?.textContent?.trim() || '';
  const date = document.querySelector('time, .date, .post-date, .submitted')?.textContent?.trim() || '';
  
  return {
    title: title.replace(/\s+/g, ' '),
    paragraphs: paragraphs.slice(0, 60),
    body: bodyText.slice(0, 15000),
    author: author.slice(0, 100),
    date: date.slice(0, 80),
    wordCount: bodyText.split(/\s+/).length,
  };
});

console.log(`   Title: ${content.title}`);
console.log(`   Author: ${content.author || 'N/A'}`);
console.log(`   Date: ${content.date || 'N/A'}`);
console.log(`   Words: ${content.wordCount}`);
console.log(`   Paragraphs: ${content.paragraphs.length}`);

if (content.paragraphs.length < 3) {
  console.log('❌ Not enough content');
  await browser.close();
  process.exit(1);
}

// 5. حفظ البيانات
const dataFile = path.join(OUTPUT, `article_${Date.now()}.json`);
fs.writeFileSync(dataFile, JSON.stringify(content, null, 2), 'utf-8');
console.log(`\n3. Saved: ${dataFile}`);

// 6. توليد البوربوينت
console.log('\n4. Generating PowerPoint...');
const pptx = new pptxgen();
const paras = content.paragraphs;
const totalSlides = Math.min(Math.ceil(paras.length / 3) + 2, 20);

function hex(c) { return c; }

// SLIDE 1: Title
const s1 = pptx.addSlide();
s1.background = { color: '1A1A2E' };
s1.addText('CSI Ultimate', { x: 0.4, y: 0.2, w: 9.2, h: 0.4, fontSize: 12, color: '3B82F6', bold: true });
s1.addShape(pptx.ShapeType.rect, { x: 0.4, y: 0.7, w: 9.2, h: 0.02, fill: { color: '1E293B' } });
s1.addText(content.title, { x: 0.5, y: 1.3, w: 9, h: 1.5, fontSize: 26, color: 'FFFFFF', bold: true, align: 'center' });
s1.addText('مستخلص بواسطة CSI Ultimate Engine', { x: 0.5, y: 3.0, w: 9, h: 0.5, fontSize: 15, color: '94A3B8', align: 'center' });
s1.addText(`📄 ${content.wordCount} كلمة • ${paras.length} فقرة`, { x: 0.5, y: 3.6, w: 9, h: 0.4, fontSize: 12, color: '64748B', align: 'center' });
if (content.author) s1.addText(`✍️ ${content.author}`, { x: 0.5, y: 4.2, w: 9, h: 0.4, fontSize: 12, color: '64748B', align: 'center' });
if (content.date) s1.addText(`📅 ${content.date}`, { x: 0.5, y: 4.7, w: 9, h: 0.4, fontSize: 12, color: '64748B', align: 'center' });
s1.addText(blogArticle.url, { x: 0.5, y: 5.8, w: 9, h: 0.3, fontSize: 9, color: '334155', align: 'center' });

// Content slides
let slideIdx = 2;
for (let i = 0; i < paras.length && slideIdx <= totalSlides; i += 3) {
  const group = paras.slice(i, i + 3);
  const slide = pptx.addSlide();
  slide.background = { color: '0F0F1F' };
  
  slide.addText('CSI Ultimate', { x: 0.4, y: 0.15, w: 5, h: 0.35, fontSize: 9, color: '3B82F6' });
  slide.addText(`${slideIdx} / ${totalSlides}`, { x: 8.5, y: 0.15, w: 1, h: 0.35, fontSize: 9, color: '475569', align: 'right' });
  slide.addShape(pptx.ShapeType.rect, { x: 0.4, y: 0.55, w: 9.2, h: 0.02, fill: { color: '1E293B' } });
  
  group.forEach((p, pi) => {
    const short = p.length > 280 ? p.slice(0, 277) + '...' : p;
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
end.addText('✓ تم الانتهاء', { x: 0.5, y: 2, w: 9, h: 1, fontSize: 30, color: '10B981', bold: true, align: 'center' });
end.addText('هذا العرض تم توليده تلقائياً بالكامل', { x: 0.5, y: 3.2, w: 9, h: 0.5, fontSize: 14, color: '94A3B8', align: 'center' });
end.addText(`CSI Ultimate • ${content.wordCount} كلمة من ${new URL(blogArticle.url).hostname}`, { x: 0.5, y: 5.0, w: 9, h: 0.3, fontSize: 10, color: '475569', align: 'center' });

const outName = `planning_presentation_${Date.now()}.pptx`;
const outPath = path.join(OUTPUT, outName);
await pptx.writeFile({ fileName: outPath });
console.log(`\n5. ✅ ${outPath}`);
console.log(`   ${slideIdx + 1} slides • ${content.wordCount} words`);

await browser.close();
