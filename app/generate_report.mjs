import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Find latest data file
const outputDir = path.resolve(__dirname, '..', 'output');
const files = fs.readdirSync(outputDir).filter(f => f.startsWith('www_expatriates') && f.endsWith('.json'));
files.sort((a, b) => fs.statSync(path.join(outputDir, b)).mtimeMs - fs.statSync(path.join(outputDir, a)).mtimeMs);

if (files.length === 0) { console.log('No data files'); process.exit(1); }

const data = JSON.parse(fs.readFileSync(path.join(outputDir, files[0]), 'utf-8'));
const now = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

const title = (s) => { if (!s) return '—'; const t = s.replace(/[""]/g, '"').replace(/['']/g, "'"); return t.length > 80 ? t.slice(0, 77) + '...' : t; };
const loc = (s) => s || 'غير محدد';
const prc = (s) => s ? `💰 ${s.replace(/SAR\s*/i, 'ريال ')}` : '';
const jobs = data.slice(0, 30);

let tableRows = jobs.map((j, i) => `
  <tr>
    <td class="num">${i+1}</td>
    <td><a href="${j.url || '#'}" target="_blank">${title(j.title)}</a></td>
    <td>${loc(j.location)}</td>
    <td>${prc(j.price)}</td>
    <td>${j.source || 'expatriates.com'}</td>
  </tr>`).join('\n');

// Stats
const withPrice = jobs.filter(j => j.price).length;
const withLocation = jobs.filter(j => j.location).length;
const uniqueTitles = new Set(jobs.map(j => j.title?.toLowerCase().trim())).size;

const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CSI Ultimate — تقرير سحب الوظائف</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Cairo', system-ui, sans-serif;
    background: #0a0a0f;
    color: #e0e0e0;
    min-height: 100vh;
    padding: 24px;
  }
  .container { max-width: 1200px; margin: 0 auto; }

  /* Header */
  .header {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    border: 1px solid #334155;
    border-radius: 16px;
    padding: 32px 40px;
    margin-bottom: 24px;
    position: relative;
    overflow: hidden;
  }
  .header::before {
    content: '';
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle at 30% 50%, rgba(59,130,246,0.08) 0%, transparent 60%);
    pointer-events: none;
  }
  .header-badge {
    display: inline-block;
    background: #3b82f6;
    color: white;
    padding: 4px 14px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
  }
  .header h1 { font-size: 32px; font-weight: 900; color: white; margin-bottom: 6px; }
  .header p { color: #94a3b8; font-size: 15px; }
  .header .meta { display: flex; gap: 24px; margin-top: 16px; flex-wrap: wrap; }
  .header .meta span { color: #64748b; font-size: 13px; }
  .header .meta strong { color: #e2e8f0; }

  /* Stats Grid */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .stat-card {
    background: linear-gradient(135deg, #0f172a 0%, #1a2332 100%);
    border: 1px solid #1e293b;
    border-radius: 12px;
    padding: 20px 24px;
    text-align: center;
    transition: border-color 0.2s;
  }
  .stat-card:hover { border-color: #3b82f6; }
  .stat-card .value { font-size: 36px; font-weight: 900; color: #3b82f6; line-height: 1; }
  .stat-card .label { font-size: 13px; color: #64748b; margin-top: 8px; font-weight: 600; }
  .stat-card.alt .value { color: #10b981; }
  .stat-card.warn .value { color: #f59e0b; }

  /* Table */
  .table-wrap {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 24px;
  }
  .table-header {
    padding: 16px 24px;
    border-bottom: 1px solid #1e293b;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .table-header h2 { font-size: 16px; font-weight: 700; color: white; }
  .table-header .count-badge {
    background: #1e293b;
    color: #94a3b8;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 13px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th {
    background: #1a2332;
    color: #64748b;
    font-weight: 600;
    padding: 12px 16px;
    text-align: right;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid #1e293b;
  }
  td { padding: 12px 16px; border-bottom: 1px solid #1a2332; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:hover { background: rgba(59,130,246,0.04); }
  .num { color: #475569; width: 30px; text-align: center; }
  td a { color: #60a5fa; text-decoration: none; }
  td a:hover { text-decoration: underline; color: #93c5fd; }
  td .price { color: #f59e0b; font-weight: 600; }

  /* Footer */
  .footer {
    text-align: center;
    color: #334155;
    font-size: 12px;
    padding: 24px;
    border-top: 1px solid #1e293b;
  }
  .footer strong { color: #475569; }

  @media (max-width: 768px) {
    body { padding: 12px; }
    .header { padding: 20px; }
    .header h1 { font-size: 22px; }
    th, td { padding: 8px 10px; font-size: 12px; }
    .stat-card .value { font-size: 28px; }
  }
</style>
</head>
<body>
<div class="container">

  <!-- HEADER -->
  <div class="header">
    <div class="header-badge">✦ CSI Ultimate Engine</div>
    <h1>تقرير سحب الوظائف</h1>
    <p>بيانات مستخلصة من <strong>expatriates.com</strong> — بحث: "Planning Engineer"</p>
    <div class="meta">
      <span>📅 <strong>${now}</strong></span>
      <span>📄 <strong>${jobs.length}</strong> نتيجة</span>
      <span>🔍 <strong>planning engineer</strong></span>
    </div>
  </div>

  <!-- STATS -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="value">${jobs.length}</div>
      <div class="label">إجمالي النتائج</div>
    </div>
    <div class="stat-card alt">
      <div class="value">${withLocation}</div>
      <div class="label">بها موقع</div>
    </div>
    <div class="stat-card warn">
      <div class="value">${withPrice}</div>
      <div class="label">بها سعر/راتب</div>
    </div>
    <div class="stat-card">
      <div class="value">${uniqueTitles}</div>
      <div class="label">وظيفة مختلفة</div>
    </div>
  </div>

  <!-- TABLE -->
  <div class="table-wrap">
    <div class="table-header">
      <h2>📋 قائمة الوظائف</h2>
      <span class="count-badge">${jobs.length} إعلان</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>المسمى الوظيفي</th>
          <th>الموقع</th>
          <th>الراتب</th>
          <th>المصدر</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <p>تم التوليد بواسطة <strong>CSI Ultimate</strong> — طَور Playwright + Express على Node.js ${process.version}</p>
  </div>

</div>
</body>
</html>`;

const outPath = path.join(outputDir, 'report_planning_engineer.html');
fs.writeFileSync(outPath, html, 'utf-8');
console.log(`✅ HTML report: ${outPath}`);
console.log(`   Size: ${(html.length / 1024).toFixed(1)} KB`);
