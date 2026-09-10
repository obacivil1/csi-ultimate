import { chromium } from 'playwright';
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

// 1. ابحث عن مقال متخصص في Planning Planet عن Delay Analysis
console.log('1. Searching Planning Planet for articles...');
await page.goto('https://www.planningplanet.com/blog', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);

const articles = await page.evaluate(() => {
  const items = []; const seen = new Set();
  const anchors = document.querySelectorAll('a[href*="/blog/"]');
  for (const a of anchors) {
    const href = a.href.trim();
    const text = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150);
    if (!href || !text || text.length < 20 || seen.has(href)) continue;
    if (a.closest('nav,.nav,.menu,header,footer,.footer')) continue;
    seen.add(href);
    const descEl = a.closest('article,.node,.post,.teaser')?.querySelector('p');
    const desc = descEl ? descEl.textContent.trim().slice(0, 200) : '';
    items.push({ title: text, url: href, description: desc });
  }
  return items.slice(0, 20);
});

console.log(`   Found ${articles.length} blog articles`);
articles.forEach((a, i) => console.log(`   ${i+1}. ${a.title.slice(0, 80)}`));

// 2. اختر أول مقال جاد ومتخصص (Delay Analysis, CPM, Forensic, etc.)
const target = articles.find(a => {
  const t = (a.title + ' ' + a.description).toLowerCase();
  return t.includes('delay') || t.includes('forensic') || t.includes('cpm') || t.includes('claim') || t.includes('fragnet') || t.includes('float');
}) || articles[0];

if (!target) { console.log('No articles found'); await browser.close(); process.exit(1); }

console.log(`\n2. Selected article: ${target.title}`);
console.log(`   ${target.url}`);

// 3. اقرأ المقال كاملاً
await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);

const content = await page.evaluate(() => {
  // Try to get the main content
  const main = document.querySelector('article') || document.querySelector('.node-content') || document.querySelector('.content') || document.querySelector('main');
  if (!main) return { title: document.title, body: document.body.innerText.slice(0, 3000) };
  
  const title = document.querySelector('h1')?.textContent?.trim() || document.title;
  const bodyText = main.innerText.trim();
  const paragraphs = Array.from(main.querySelectorAll('p')).map(p => p.textContent.trim()).filter(p => p.length > 20);
  
  const meta = {};
  const author = document.querySelector('.author, .byline, [rel="author"]');
  if (author) meta.author = author.textContent.trim();
  const date = document.querySelector('time, .date, .submitted, .post-date');
  if (date) meta.date = date.textContent.trim() || date.getAttribute('datetime') || '';
  const cats = Array.from(document.querySelectorAll('.category, .tag, .field-name-field-tags a')).map(c => c.textContent.trim());
  if (cats.length) meta.categories = cats;
  
  return { title, body: bodyText.slice(0, 8000), paragraphs: paragraphs.slice(0, 40), meta };
});

console.log(`\n3. Content extracted: ${content.title}`);
console.log(`   ${content.paragraphs.length} paragraphs, ${content.body.length} chars`);
if (content.meta.author) console.log(`   Author: ${content.meta.author}`);
if (content.meta.date) console.log(`   Date: ${content.meta.date}`);

// 4. حفظ البيانات الخام
const dataFile = path.join(OUTPUT, `planning_article_${Date.now()}.json`);
fs.writeFileSync(dataFile, JSON.stringify({ source: target.url, ...content }), 'utf-8');
console.log(`\n4. Saved raw data to: ${dataFile}`);

// 5. تقسيم المحتوى إلى شرائح عرض
const paras = content.paragraphs.filter(p => p.length > 30);
const slides = [];
let current = { title: 'المقدمة', bullets: [] };

for (const p of paras) {
  // كشف إذا كانت هذه فقرة عنوان (قصيرة، بدون نقطة في النهاية)
  const isHeading = p.length < 100 && !p.endsWith('.') && !p.endsWith('!') && !p.endsWith('?');
  if (isHeading && current.bullets.length > 0) {
    slides.push(current);
    current = { title: p, bullets: [] };
  } else if (isHeading) {
    current.title = p;
  } else {
    // اختصار الفقرة
    const short = p.length > 200 ? p.slice(0, 197) + '...' : p;
    current.bullets.push(short);
    if (current.bullets.length >= 5) {
      slides.push(current);
      current = { title: 'تابع', bullets: [] };
    }
  }
}
if (current.bullets.length > 0) slides.push(current);
if (slides.length === 0) {
  // fallback: كل الفقرات كشرائح
  for (let i = 0; i < paras.length && i < 8; i++) {
    slides.push({ title: paras[i].slice(0, 60), bullets: [paras[i]] });
  }
}

console.log(`\n5. Generated ${slides.length} slides`);

// 6. توليد HTML Presentation احترافي
function slideToHtml(s, idx) {
  const isTitle = idx === 0;
  const isEnd = idx === slides.length - 1;
  const cls = isTitle ? 'slide title-slide' : isEnd ? 'slide end-slide' : 'slide';
  const icon = isTitle ? '📊' : isEnd ? '🎯' : '📄';
  
  return `
  <div class="${cls}">
    <div class="slide-number">${idx + 1} / ${slides.length}</div>
    <div class="slide-icon">${icon}</div>
    <div class="slide-title">${s.title}</div>
    <ul class="slide-bullets">
      ${s.bullets.slice(0, 6).map(b => `<li>${b}</li>`).join('\n        ')}
    </ul>
    ${idx < slides.length - 1 ? '<div class="nav-arrow">▼</div>' : ''}
  </div>`;
}

const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${content.title} — CSI Ultimate Presentation</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Cairo', sans-serif;
    background: #08080f;
    color: #e0e0e0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px;
  }
  .container { max-width: 900px; width: 100%; }

  /* Progress bar */
  .progress { display: flex; gap: 4px; margin-bottom: 20px; padding: 0 4px; }
  .progress .dot { flex: 1; height: 3px; border-radius: 2px; background: #1a1a3a; transition: background 0.3s; }
  .progress .dot.active { background: #3b82f6; }
  .progress .dot.done { background: #10b981; }

  /* Slide */
  .slide {
    background: linear-gradient(135deg, #0a0a1a 0%, #12122a 100%);
    border: 1px solid #1e1e4a;
    border-radius: 20px;
    padding: 40px;
    min-height: 500px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    position: relative;
    margin-bottom: 16px;
  }
  .slide-number {
    position: absolute;
    top: 16px; right: 20px;
    color: #2a2a5a;
    font-size: 13px;
    font-weight: 700;
  }
  .slide-icon { font-size: 48px; margin-bottom: 16px; }
  .slide-title {
    font-size: 26px;
    font-weight: 900;
    color: white;
    line-height: 1.4;
    margin-bottom: 20px;
  }
  .slide-bullets {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .slide-bullets li {
    font-size: 15px;
    line-height: 1.7;
    color: #c0c0d0;
    padding-right: 24px;
    position: relative;
  }
  .slide-bullets li::before {
    content: '▸';
    position: absolute;
    right: 0;
    color: #3b82f6;
    font-weight: 700;
  }
  .nav-arrow {
    text-align: center;
    color: #2a2a5a;
    font-size: 20px;
    margin-top: 24px;
    animation: bounce 1.5s infinite;
  }
  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(6px); }
  }

  /* Title slide */
  .title-slide {
    background: linear-gradient(135deg, #0a0a2a 0%, #1a1a5a 100%);
    border-color: #3b82f6;
    text-align: center;
    min-height: 400px;
  }
  .title-slide .slide-title { font-size: 30px; }
  .title-slide .subtitle { font-size: 14px; color: #94a3b8; margin-top: 8px; }

  /* End slide */
  .end-slide {
    background: linear-gradient(135deg, #0a2a0a 0%, #1a3a1a 100%);
    border-color: #10b981;
    text-align: center;
    min-height: 300px;
  }
  .end-slide .slide-title { color: #10b981; }

  /* Controls */
  .controls {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin-top: 4px;
  }
  .controls button {
    font-family: 'Cairo', sans-serif;
    background: #1a1a3a;
    border: 1px solid #2a2a5a;
    color: #e0e0e0;
    padding: 10px 28px;
    border-radius: 12px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 700;
    transition: background 0.2s;
  }
  .controls button:hover { background: #2a2a5a; }
  .controls button:disabled { opacity: 0.3; cursor: default; }

  /* Meta */
  .meta-bar {
    display: flex;
    justify-content: center;
    gap: 20px;
    flex-wrap: wrap;
    margin-bottom: 16px;
    font-size: 12px;
    color: #475569;
  }
  .meta-bar strong { color: #94a3b8; }

  @media (max-width: 600px) {
    .slide { padding: 24px; min-height: 350px; }
    .slide-title { font-size: 20px; }
    .slide-bullets li { font-size: 13px; }
  }
</style>
</head>
<body>
<div class="container">

<div class="meta-bar">
  <span>📅 <strong>${new Date().toLocaleDateString('ar-SA')}</strong></span>
  <span>📄 <strong>${slides.length}</strong> شريحة</span>
  <span>🌐 <strong>${new URL(target.url).hostname}</strong></span>
</div>

<div class="progress" id="progress">
  ${slides.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}" data-idx="${i}"></div>`).join('\n  ')}
</div>

<div id="slideContainer">
  ${slideToHtml({ ...slides[0], bullets: [content.meta.author ? `✍️ ${content.meta.author}` : '', content.meta.date ? `📅 ${content.meta.date}` : '', `📎 ${target.url}`].filter(Boolean) }, 0)}
</div>

<div class="controls">
  <button id="prevBtn" disabled>السابق</button>
  <button id="nextBtn">التالي</button>
</div>
<script>
  const slides = ${JSON.stringify(slides)};
  let current = 0;
  const container = document.getElementById('slideContainer');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const dots = document.querySelectorAll('.dot');

  function render(idx) {
    const s = slides[idx];
    const isTitle = idx === 0;
    const isEnd = idx === slides.length - 1;
    const icon = isTitle ? '📊' : isEnd ? '🎯' : '📄';
    container.innerHTML = \`
      <div class="slide \${isTitle ? 'title-slide' : isEnd ? 'end-slide' : 'slide'}">
        <div class="slide-number">\${idx + 1} / \${slides.length}</div>
        <div class="slide-icon">\${icon}</div>
        <div class="slide-title">\${s.title}</div>
        <ul class="slide-bullets">
          \${s.bullets.slice(0, 6).map(b => '<li>' + b + '</li>').join('')}
        </ul>
        \${idx < slides.length - 1 ? '<div class="nav-arrow">▼</div>' : ''}
      </div>\`;
    prevBtn.disabled = idx === 0;
    nextBtn.textContent = idx === slides.length - 1 ? 'إعادة' : 'التالي';
    dots.forEach((d, i) => {
      d.className = 'dot ' + (i < idx ? 'done' : i === idx ? 'active' : '');
    });
  }

  prevBtn.onclick = () => { if (current > 0) { current--; render(current); } };
  nextBtn.onclick = () => {
    if (current === slides.length - 1) { current = 0; render(current); return; }
    current++; render(current);
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextBtn.onclick();
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prevBtn.onclick();
  });
</script>
</div>
</body>
</html>`;

const reportFile = path.join(OUTPUT, `presentation_planning_${Date.now()}.html`);
fs.writeFileSync(reportFile, html, 'utf-8');
console.log(`\n6. ✅ Presentation generated: ${reportFile}`);
console.log(`   ${(html.length / 1024).toFixed(1)} KB — ${slides.length} slides`);

await browser.close();
