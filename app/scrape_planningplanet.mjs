import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.resolve(__dirname, '..', 'output');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
});

console.log('🌐 جاري فتح Planning Planet...');
await page.goto('https://www.planningplanet.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
console.log('✅', await page.title());

// استخراج المواضيع والمقالات
const articles = await page.evaluate(() => {
  // نجيب كل الروابط ونصنفهم
  const items = []; const seen = new Set();
  const anchors = document.querySelectorAll('a[href]');
  
  for (const a of anchors) {
    const href = a.href.trim();
    let text = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150);
    if (!href || !text || text.length < 10 || seen.has(href)) continue;
    if (href.startsWith('javascript:') || href === '#') continue;
    if (a.closest('nav,.nav,.menu,header,.header,footer,.footer')) continue;
    seen.add(href);
    
    // استخراج الوصف من العنصر الأب
    const parent = a.closest('article,.node,.content,.forum-post,.story,li,.teaser,div[class*="node"],div[class*="post"],div[class*="teaser"]');
    let desc = '', date = '', category = '';
    if (parent) {
      const allText = parent.textContent.replace(/\s+/g, ' ').trim();
      desc = allText.replace(text, '').slice(0, 250);
      const d = parent.querySelector('time,.date,.submitted,.posted');
      if (d) date = d.textContent.trim().slice(0, 50) || d.getAttribute('datetime') || '';
    }

    // تصنيف تقريبي
    const lower = (text + ' ' + href + ' ' + desc).toLowerCase();
    if (lower.includes('planning') || lower.includes('schedule') || lower.includes('cpm') || lower.includes('primavera') || lower.includes('p6') || lower.includes('project control')) category = 'تخطيط وجدولة';
    else if (lower.includes('training') || lower.includes('course') || lower.includes('learn')) category = 'تدريب';
    else if (lower.includes('software') || lower.includes('tool') || lower.includes('synchro') || lower.includes('ms project')) category = 'برمجيات';
    else if (lower.includes('book') || lower.includes('guide') || lower.includes('resource')) category = 'مراجع';
    else category = 'عام';

    items.push({ title: text, url: href.slice(0, 300), description: desc.slice(0, 300), date, category });
  }
  return items;
});

console.log(`\n📊 تم استخراج ${articles.length} موضوع`);
const byCat = {};
articles.forEach(a => { byCat[a.category] = (byCat[a.category] || 0) + 1; });
Object.entries(byCat).forEach(([k, v]) => console.log(`   ${k}: ${v}`));

// حفظ البيانات
const dataFile = path.join(OUTPUT, `planningplanet_${Date.now()}.json`);
fs.writeFileSync(dataFile, JSON.stringify(articles, null, 2), 'utf-8');
console.log(`\n💾 محفوظ: ${dataFile}`);

// توليد HTML presentation احترافي
const now = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

const card = (a, i) => {
  const catColor = { 'تخطيط وجدولة': '#3b82f6', 'تدريب': '#10b981', 'برمجيات': '#f59e0b', 'مراجع': '#8b5cf6', 'عام': '#64748b' }[a.category] || '#64748b';
  return `
  <div class="card">
    <div class="card-num">${i+1}</div>
    <div class="card-body">
      <div class="card-cat" style="background:${catColor}20; color:${catColor}">${a.category}</div>
      <div class="card-title">${a.title}</div>
      <div class="card-desc">${a.description.slice(0, 200)}</div>
      ${a.date ? `<div class="card-date">📅 ${a.date}</div>` : ''}
    </div>
  </div>`;
};

const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CSI Ultimate — تقرير Planning Planet</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Cairo', sans-serif;
    background: #080810;
    color: #e0e0e0;
    min-height: 100vh;
    padding: 20px;
  }
  .container { max-width: 1100px; margin: 0 auto; }

  .hero {
    background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3a 100%);
    border: 1px solid #2a2a5a;
    border-radius: 20px;
    padding: 40px;
    margin-bottom: 30px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }
  .hero::before {
    content: '';
    position: absolute; top: -50%; left: -50%;
    width: 200%; height: 200%;
    background: radial-gradient(circle at 50% 50%, rgba(59,130,246,0.06) 0%, transparent 60%);
    pointer-events: none;
  }
  .hero .icon { font-size: 48px; margin-bottom: 12px; }
  .hero h1 { font-size: 34px; font-weight: 900; color: white; margin-bottom: 6px; }
  .hero p { color: #94a3b8; font-size: 15px; }
  .hero .meta { margin-top: 16px; display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; font-size: 13px; color: #64748b; }
  .hero .meta strong { color: #e2e8f0; }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
    margin-bottom: 30px;
  }
  .stat {
    background: #0f0f1f;
    border: 1px solid #1e1e3e;
    border-radius: 14px;
    padding: 18px;
    text-align: center;
  }
  .stat .val { font-size: 32px; font-weight: 900; color: #3b82f6; line-height: 1; }
  .stat .lbl { font-size: 12px; color: #64748b; margin-top: 6px; }

  .section-title { font-size: 18px; font-weight: 700; color: white; margin-bottom: 16px; padding-right: 4px; }

  .cards { display: flex; flex-direction: column; gap: 12px; margin-bottom: 30px; }
  .card {
    background: #0a0a1a;
    border: 1px solid #1a1a3a;
    border-radius: 14px;
    padding: 18px 20px;
    display: flex;
    gap: 16px;
    transition: border-color 0.2s, background 0.2s;
    cursor: default;
  }
  .card:hover { border-color: #3b82f6; background: #0e0e24; }
  .card-num {
    width: 36px; height: 36px; min-width: 36px;
    background: #1a1a3a;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 900; font-size: 14px; color: #3b82f6;
  }
  .card-body { flex: 1; }
  .card-cat {
    display: inline-block;
    padding: 2px 12px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .card-title { font-size: 15px; font-weight: 700; color: white; margin-bottom: 4px; }
  .card-desc { font-size: 13px; color: #64748b; line-height: 1.6; }
  .card-date { font-size: 12px; color: #475569; margin-top: 4px; }

  .footer {
    text-align: center; color: #1e1e3e; font-size: 12px;
    padding: 20px; border-top: 1px solid #1a1a3a;
  }

  @media (max-width: 600px) {
    .hero h1 { font-size: 24px; }
    .card { padding: 14px; }
    .card-title { font-size: 13px; }
  }
</style>
</head>
<body>
<div class="container">

<div class="hero">
  <div class="icon">🏗️</div>
  <h1>Planning Planet — مستخلص المواضيع</h1>
  <p>بيانات مستخلصة بواسطة <strong>CSI Ultimate Engine</strong> (Playwright + Node.js)</p>
  <div class="meta">
    <span>📅 <strong>${now}</strong></span>
    <span>📄 <strong>${articles.length}</strong> موضوع</span>
    <span>🌐 <strong>planningplanet.com</strong></span>
  </div>
</div>

<div class="stats">
  <div class="stat"><div class="val">${articles.length}</div><div class="lbl">إجمالي المواضيع</div></div>
  <div class="stat"><div class="val">${Object.keys(byCat).length}</div><div class="lbl">تصنيفات</div></div>
  <div class="stat"><div class="val">${Object.entries(byCat).filter(([k]) => k === 'تخطيط وجدولة').reduce((s, [,v]) => s+v, 0)}</div><div class="lbl">تخطيط وجدولة</div></div>
  <div class="stat"><div class="val">${articles.filter(a => a.date).length}</div><div class="lbl">بها تاريخ</div></div>
</div>

<div class="section-title">📋 جميع المواضيع (${articles.length})</div>
<div class="cards">
  ${articles.slice(0, 30).map((a, i) => card(a, i)).join('\n  ')}
</div>

<div class="footer">
  Generated by CSI Ultimate — ${process.version} | Planning Planet Scrape
</div>

</div>
</body>
</html>`;

const reportFile = path.join(OUTPUT, 'planningplanet_report.html');
fs.writeFileSync(reportFile, html, 'utf-8');
console.log(`\n✅ Presentation: ${reportFile}`);
console.log(`   ${(html.length / 1024).toFixed(1)} KB`);

await browser.close();
