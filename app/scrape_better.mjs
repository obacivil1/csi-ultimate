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

// البحث عن مقال طويل ومفصل
console.log('1. البحث عن مقال تخطيط طويل...');

// جرب PM World Library - فيه أبحاث كاملة
const targets = [
  { name: 'PM World Library - Delay Analysis', url: 'https://pmworldlibrary.net/delay-analysis-in-construction-projects/' },
  { name: 'Planning Planet - Forensic Planning', url: 'https://www.planningplanet.com/forensic-planning-analysis-article' },
  { name: 'PM World Library', url: 'https://pmworldlibrary.net/search/?q=delay+analysis' },
];

let bestArticle = null;

for (const t of targets) {
  try {
    console.log(`   Trying: ${t.name}`);
    await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    const title = await page.title();
    if (title.includes('just a moment') || title.includes('Attention Required')) {
      console.log('   Blocked by Cloudflare');
      continue;
    }
    console.log(`   Title: ${title}`);
    
    const content = await page.evaluate(() => {
      const main = document.querySelector('article, .entry-content, .post-content, main, .content-area');
      if (!main) return null;
      const text = main.innerText.trim();
      if (text.length < 500) return null;
      const paras = Array.from(main.querySelectorAll('p')).map(p => p.textContent.trim()).filter(p => p.length > 30);
      return {
        title: document.title,
        body: text.slice(0, 12000),
        paragraphs: paras.slice(0, 50),
        wordCount: text.split(/\s+/).length,
      };
    });
    
    if (content && content.paragraphs.length >= 5) {
      bestArticle = { ...t, ...content };
      console.log(`   ✅ Good article: ${content.paragraphs.length} paragraphs, ${content.wordCount} words`);
      break;
    }
  } catch(e) { console.log(`   Error: ${e.message.slice(0,60)}`); }
}

// إذا ما لقينا مقال، نقرأ أطول مقال من Planning Planet blog
if (!bestArticle) {
  console.log('\n2. No PM World article found, trying Planning Planet in-depth...');
  await page.goto('https://www.planningplanet.com/blog', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2000);
  
  // نجيب روابط المقالات
  const links = await page.evaluate(() => {
    const items = []; const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/blog/"]')) {
      const href = a.href.trim();
      const text = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150);
      if (!href || !text || text.length < 15 || seen.has(href)) continue;
      seen.add(href);
      items.push({ title: text, url: href });
    }
    return items.slice(0, 15);
  });
  
  links.forEach((l, i) => console.log(`   ${i+1}. ${l.title}`));
  
  // اختر المقال الأطول
  for (const link of links) {
    try {
      await page.goto(link.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1500);
      const body = await page.evaluate(() => {
        const main = document.querySelector('article, .node-content, .content, main');
        if (!main) return null;
        const text = main.innerText.trim();
        const paras = Array.from(main.querySelectorAll('p')).map(p => p.textContent.trim()).filter(p => p.length > 30);
        return { text: text.slice(0, 12000), paragraphs: paras.slice(0, 50), wordCount: text.split(/\s+/).length };
      });
      if (body && body.paragraphs.length >= 8) {
        bestArticle = { name: link.title, url: link.url, title: link.title, ...body };
        console.log(`   ✅ Chosen: "${link.title}" (${body.wordCount} words, ${body.paragraphs.length} paragraphs)`);
        break;
      }
    } catch(e) { continue; }
  }
}

if (!bestArticle) {
  console.log('❌ No substantial article found');
  await browser.close();
  process.exit(1);
}

// 3. حفظ البيانات
const dataFile = path.join(OUTPUT, `article_full_${Date.now()}.json`);
fs.writeFileSync(dataFile, JSON.stringify({ source: bestArticle.url, title: bestArticle.title, paragraphs: bestArticle.paragraphs, body: bestArticle.body }, null, 2), 'utf-8');
console.log(`\n3. ✅ Article saved: ${dataFile}`);

// 4. توليد العرض التقديمي
const paras = bestArticle.paragraphs;
const slides = [{ title: bestArticle.title, bullets: [`المصدر: ${bestArticle.name || bestArticle.url}`, `عدد الكلمات: ${bestArticle.wordCount}`, `عدد الفقرات: ${paras.length}`] }];

// قسم المحتوى إلى شرائح (كل شريحة 4-5 نقاط)
let currentBullets = [];
for (const p of paras) {
  const short = p.length > 180 ? p.slice(0, 177) + '...' : p;
  const isHeading = p.length < 80 && !p.endsWith('.') && !p.endsWith(':');
  
  if (isHeading && currentBullets.length > 0) {
    slides.push({ title: p, bullets: currentBullets });
    currentBullets = [];
  } else if (isHeading) {
    slides.push({ title: p, bullets: [] });
  } else {
    currentBullets.push(short);
    if (currentBullets.length >= 4) {
      slides.push({ title: 'تفاصيل', bullets: currentBullets });
      currentBullets = [];
    }
  }
}
if (currentBullets.length > 0) slides.push({ title: 'تفاصيل إضافية', bullets: currentBullets });
if (slides.length < 3) {
  // fallback: وزع الفقرات كشرائح
  slides.length = 0;
  slides.push({ title: bestArticle.title, bullets: [`المصدر: ${bestArticle.url}`, `عدد الكلمات: ${bestArticle.wordCount}`] });
  for (let i = 0; i < paras.length; i += 3) {
    slides.push({ title: `الجزء ${Math.floor(i/3) + 1}`, bullets: paras.slice(i, i + 3).map(p => p.length > 180 ? p.slice(0, 177) + '...' : p) });
  }
}
slides.push({ title: 'نهاية العرض', bullets: ['تم إعداد هذا العرض بواسطة CSI Ultimate Engine', 'جميع المعلومات مأخوذة من المصادر الأصلية', 'يمكنك استخدام هذا القالب لتقديم عروض احترافية لعملائك'] });

console.log(`\n4. ${slides.length} slides generated`);

// توليد HTML
function slideHtml(s, idx) {
  const isStart = idx === 0;
  const isEnd = idx === slides.length - 1;
  const icon = isStart ? '📊' : isEnd ? '🎯' : '📄';
  return `
  <div class="slide ${isStart ? 'start' : isEnd ? 'end' : ''}">
    <div class="slide-num">${idx + 1}/${slides.length}</div>
    <div class="slide-icon">${icon}</div>
    <div class="slide-title">${s.title}</div>
    <ul class="bullets">
      ${s.bullets.map(b => `<li>${b}</li>`).join('\n')}
    </ul>
  </div>`;
}

const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${bestArticle.title} — CSI Ultimate</title>
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
  .container { max-width: 860px; width: 100%; }

  .top-bar {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 12px; padding: 0 4px;
  }
  .top-bar .brand {
    font-size: 12px; font-weight: 700; color: #3b82f6;
    background: #1a1a3a; padding: 4px 14px; border-radius: 8px;
  }
  .top-bar .date { font-size: 12px; color: #475569; }

  .progress { display: flex; gap: 3px; margin-bottom: 16px; }
  .progress .dot { flex: 1; height: 3px; border-radius: 2px; background: #1a1a3a; transition: background 0.3s; }
  .progress .dot.active { background: #3b82f6; }
  .progress .dot.done { background: #10b981; }

  .slide {
    background: linear-gradient(135deg, #0c0c20 0%, #141430 100%);
    border: 1px solid #222255;
    border-radius: 20px;
    padding: 36px;
    min-height: 420px;
    position: relative;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .slide.start {
    background: linear-gradient(135deg, #0c0c30 0%, #1a1a60 100%);
    border-color: #3b82f6;
  }
  .slide.end {
    background: linear-gradient(135deg, #0a200a 0%, #183018 100%);
    border-color: #10b981;
  }

  .slide-num {
    position: absolute; top: 14px; left: 18px;
    font-size: 12px; color: #333366;
    font-weight: 700;
  }
  .slide-icon { font-size: 42px; margin-bottom: 12px; }
  .slide-title {
    font-size: 24px; font-weight: 900; color: white;
    line-height: 1.4; margin-bottom: 16px;
  }
  .start .slide-title { font-size: 26px; }
  .end .slide-title { color: #10b981; }

  .bullets { list-style: none; display: flex; flex-direction: column; gap: 10px; }
  .bullets li {
    font-size: 15px; line-height: 1.7; color: #c0c0d0;
    padding-right: 20px; position: relative;
  }
  .bullets li::before {
    content: '▸'; position: absolute; right: 0; color: #3b82f6; font-weight: 700;
  }

  .controls { display: flex; gap: 10px; justify-content: center; margin-top: 8px; }
  .controls button {
    font-family: 'Cairo', sans-serif;
    background: #1a1a3a; border: 1px solid #222255;
    color: #e0e0e0; padding: 8px 24px; border-radius: 10px;
    cursor: pointer; font-size: 14px; font-weight: 700;
    transition: background 0.2s;
  }
  .controls button:hover { background: #2a2a5a; }
  .controls button:disabled { opacity: 0.3; cursor: default; }

  .source-link {
    text-align: center; font-size: 11px; color: #333366;
    margin-top: 8px;
  }
  .source-link a { color: #5555aa; text-decoration: none; }
</style>
</head>
<body>
<div class="container">

<div class="top-bar">
  <span class="brand">✦ CSI Ultimate</span>
  <span class="date">${new Date().toLocaleDateString('ar-SA')}</span>
</div>

<div class="progress" id="progress">
  ${slides.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}"></div>`).join('\n')}
</div>

<div id="slideContainer">
  ${slideHtml(slides[0], 0)}
</div>

<div class="controls">
  <button id="prevBtn" disabled>السابق</button>
  <button id="nextBtn">التالي</button>
</div>

<div class="source-link">
  <a href="${bestArticle.url}" target="_blank">${bestArticle.url}</a>
</div>

<script>
  const slides = ${JSON.stringify(slides)};
  let idx = 0;
  const c = document.getElementById('slideContainer');
  const p = document.getElementById('prevBtn');
  const n = document.getElementById('nextBtn');
  const dots = document.querySelectorAll('.dot');

  function show(i) {
    const s = slides[i];
    const isStart = i === 0;
    const isEnd = i === slides.length - 1;
    const icon = isStart ? '📊' : isEnd ? '🎯' : '📄';
    c.innerHTML = \`
      <div class="slide \${isStart ? 'start' : isEnd ? 'end' : ''}">
        <div class="slide-num">\${i+1}/\${slides.length}</div>
        <div class="slide-icon">\${icon}</div>
        <div class="slide-title">\${s.title}</div>
        <ul class="bullets">\${s.bullets.map(b => '<li>' + b + '</li>').join('')}</ul>
      </div>\`;
    p.disabled = i === 0;
    n.textContent = i === slides.length - 1 ? '🔄 إعادة' : 'التالي ◀';
    dots.forEach((d, j) => {
      d.className = 'dot ' + (j < i ? 'done' : j === i ? 'active' : '');
    });
  }
  p.onclick = () => { if (idx > 0) { idx--; show(idx); } };
  n.onclick = () => {
    if (idx === slides.length - 1) { idx = 0; show(idx); return; }
    idx++; show(idx);
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n.onclick();
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') p.onclick();
  });
  show(0);
</script>
</div>
</body>
</html>`;

const presFile = path.join(OUTPUT, `presentation_${Date.now()}.html`);
fs.writeFileSync(presFile, html, 'utf-8');
console.log(`\n5. ✅ Presentation: ${presFile}`);
console.log(`   ${slides.length} slides, ${(html.length/1024).toFixed(1)} KB`);

await browser.close();
