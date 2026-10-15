import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getJSON } from '../cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const metaRouter = Router();

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILES = {
  tenders: path.join(DATA_DIR, 'etimad_all_tenders.json'),
  contractors: path.join(DATA_DIR, 'muqawil_all_regions.json'),
  projects: path.join(DATA_DIR, 'projects_database.json'),
  awards: path.join(DATA_DIR, 'etimad_sample_awards.json'),
};

const CONSTRUCTION_KW = ['مقاولات','تشييد','بناء','إنشاء','هدم','ترميم','صيانة','تشغيل','نظافة','كهرباء','سباكة','طرق','خرسانة','دهان','عزل','حفر','ردم','تسوية','أساسات','حديد'];

export const SOURCES = [
  { name: 'منصة اعتماد', url: 'https://tenders.etimad.sa', desc: 'المنافسات والترسيات الحكومية' },
  { name: 'هيئة المقاولين (مقاول)', url: 'https://muqawil.org', desc: 'دليل المقاولين المصنّفين' },
  { name: 'مشاريع السعودية (RSS)', url: 'https://saudigulfprojects.com', desc: 'المشاريع الكبرى' },
];

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

let metaCache = null;
let metaCacheTime = 0;
const META_TTL = 10 * 60 * 1000;

function mtime(file) { try { return fs.statSync(file).mtime.toISOString(); } catch { return null; } }

function num(n) { return Number(n || 0).toLocaleString('en-US'); }
function plus(n) { return num(Math.floor(Number(n || 0) / 100) * 100) + '+'; }

function ago(iso) {
  if (!iso) return 'غير معروف';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'الآن';
  if (diff < 60000) return 'قبل لحظات';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  const d = Math.floor(h / 24);
  return `قبل ${d} يوم`;
}

function fmtExact(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS_AR[d.getUTCMonth()]} ${d.getUTCFullYear()} — ${hh}:${mm} UTC`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Aggregated, cache-friendly snapshot of the published datasets. Single source of
// truth for both the public /api/meta/freshness endpoint and the server-rendered
// landing page (so number-driven claims stay honest and consistent with the data).
export function getMeta() {
  const now = Date.now();
  if (metaCache && now - metaCacheTime < META_TTL) return metaCache;
  const tenders = getJSON('tenders', FILES.tenders) || [];
  const contractors = getJSON('contractors', FILES.contractors) || [];
  const projects = getJSON('projects', FILES.projects) || [];
  const awards = getJSON('awards_sample', FILES.awards) || [];
  const nowDate = new Date();
  const weekLater = new Date(nowDate.getTime() + 7 * 24 * 60 * 60 * 1000);

  const total = tenders.filter(t => t.tenderStatusId !== 8).length;
  const active = tenders.filter(t => [2, 3, 4, 5].includes(t.tenderStatusId)).length;
  const construction = tenders.filter(t => {
    const txt = (t.tenderName || '') + ' ' + (t.tenderActivityName || '');
    return CONSTRUCTION_KW.some(k => txt.includes(k));
  }).length;
  const expiringSoon = tenders.filter(t => {
    const d = t.lastOfferPresentationDate;
    if (!d) return false;
    const dt = new Date(d);
    return dt > nowDate && dt < weekLater;
  }).length;

  const withEmail = contractors.filter(c => c.email).length;
  const withPhone = contractors.filter(c => c.phone).length;
  const withContact = contractors.filter(c => c.email || c.phone).length;

  metaCache = {
    generatedAt: new Date().toISOString(),
    lastUpdated: mtime(FILES.tenders),
    sources: SOURCES,
    tenders: { total, active, construction, expiringSoon, records: tenders.length },
    contractors: { total: contractors.length, withEmail, withPhone, withContact },
    projects: { total: projects.length },
    awards: { total: awards.length },
  };
  metaCacheTime = now;
  return metaCache;
}

export function getSampleTenders(n = 5) {
  const tenders = getJSON('tenders', FILES.tenders) || [];
  const now = new Date();
  const rows = [];
  for (const t of tenders) {
    if (t.tenderStatusId === 8) continue;
    const d = t.lastOfferPresentationDate ? new Date(t.lastOfferPresentationDate) : null;
    const remainingDays = d ? Math.ceil((d - now) / 86400000) : null;
    if (remainingDays !== null && remainingDays < 0) continue;
    rows.push({
      name: t.tenderName || '',
      agency: t.agencyName || '',
      activity: t.tenderActivityName || '',
      lastDate: (t.lastOfferPresentationDate || '').substring(0, 10),
      remainingDays,
    });
  }
  rows.sort((a, b) => (a.remainingDays ?? 9999) - (b.remainingDays ?? 9999));
  return rows.slice(0, n);
}

export function renderSampleRows(n = 5) {
  const rows = getSampleTenders(n);
  if (!rows.length) {
    return '<tr><td colspan="5" style="text-align:center;color:#999;">تُحدَّث البيانات تلقائياً كل 6 ساعات</td></tr>';
  }
  return rows.map(r => {
    const urgent = r.remainingDays != null && r.remainingDays <= 3;
    const remain = r.remainingDays != null ? (esc(r.remainingDays) + ' يوم' + (urgent ? ' 🔥' : '')) : '';
    return `<tr><td>${esc(r.name)}</td><td>${esc(r.agency)}</td><td>${esc(r.activity)}</td><td>${esc(r.lastDate)}</td><td${urgent ? ' style="color:#DC3545;font-weight:700;"' : ''}>${remain}</td></tr>`;
  }).join('');
}

// Replace {{TOKEN}} placeholders in the landing page with live values so the page
// renders meaningful content and numbers even without JavaScript (SEO / first paint).
export function renderHome(html) {
  let out = html;
  let rows = '';
  try {
    const m = getMeta();
    rows = renderSampleRows(5);
    const map = {
      TENDERS_TOTAL: num(m.tenders.total),
      TENDERS_TOTAL_PLUS: plus(m.tenders.total),
      TENDERS_ACTIVE: num(m.tenders.active),
      TENDERS_CONSTRUCTION: num(m.tenders.construction),
      TENDERS_EXPIRING: num(m.tenders.expiringSoon),
      CONTRACTORS_TOTAL: num(m.contractors.total),
      CONTRACTORS_TOTAL_PLUS: plus(m.contractors.total),
      CONTRACTORS_CONTACT: num(m.contractors.withContact),
      PROJECTS_TOTAL: num(m.projects.total),
      LAST_SYNC: fmtExact(m.lastUpdated),
      LAST_SYNC_AGO: ago(m.lastUpdated),
    };
    for (const [k, v] of Object.entries(map)) out = out.split('{{' + k + '}}').join(v);
  } catch { /* fall through to placeholders */ }
  out = out.split('{{SAMPLE_ROWS}}').join(rows || '<tr><td colspan="5" style="text-align:center;color:#999;">تُحدَّث البيانات تلقائياً كل 6 ساعات</td></tr>');
  out = out.replace(/\{\{[A-Z_]+\}\}/g, () => '—');
  return out;
}

metaRouter.get('/freshness', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600');
  const m = getMeta();
  res.json({ ...m, lastSyncAgo: ago(m.lastUpdated), lastSyncText: fmtExact(m.lastUpdated) });
});

metaRouter.get('/sample.csv', (req, res) => {
  const rows = getSampleTenders(25).map(r => ({
    'اسم المنافسة': r.name,
    'الجهة الحكومية': r.agency,
    'النشاط': r.activity,
    'آخر موعد': r.lastDate,
    'المتبقي (أيام)': r.remainingDays ?? '',
  }));
  if (!rows.length) return res.status(503).json({ error: 'لا توجد بيانات متاحة حالياً' });
  const headers = Object.keys(rows[0]);
  let csv = headers.join(',') + '\r\n';
  for (const row of rows) {
    csv += headers.map(h => {
      let v = String(row[h] ?? '');
      if (v.includes(',') || v.includes('"') || v.includes('\n')) v = '"' + v.replace(/"/g, '""') + '"';
      return v;
    }).join(',') + '\r\n';
  }
  const buf = Buffer.from('\uFEFF' + csv, 'utf8');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sample_tenders.csv"; filename*=UTF-8''${encodeURIComponent('عينة_منافسات')}.csv`);
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.send(buf);
});
