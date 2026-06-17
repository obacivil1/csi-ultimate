import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, getPlanLimits } from '../middleware/auth.mjs';
import { getJSON } from '../cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const exportRouter = Router();

const TENDERS_FILE = path.join(__dirname, '..', '..', 'data', 'etimad_all_tenders.json');
const CONTRACTORS_FILE = path.join(__dirname, '..', '..', 'data', 'muqawil_all_regions.json');
const PROJECTS_FILE = path.join(__dirname, '..', '..', 'data', 'projects_database.json');
const AWARDS_FILE = path.join(__dirname, '..', '..', 'data', 'etimad_sample_awards.json');

function loadJSON(file, cacheKey) {
  return getJSON(cacheKey, file);
}

function sendCSV(res, data, filename) {
  if (!data.length) return res.status(400).json({ error: 'لا توجد بيانات للتصدير' });
  const headers = Object.keys(data[0]);
  let csv = headers.join(',') + '\r\n';
  for (const row of data) {
    const vals = headers.map(h => {
      let v = String(row[h] ?? '');
      if (v.includes(',') || v.includes('"') || v.includes('\n')) v = '"' + v.replace(/"/g, '""') + '"';
      return v;
    });
    csv += vals.join(',') + '\r\n';
  }
  const buf = Buffer.from('\uFEFF' + csv, 'utf8');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(filename)}.csv`);
  res.send(buf);
}

function handleExport(req, res, file, cacheKey, filters, mapFn, filename) {
  try {
    const records = loadJSON(file, cacheKey);
    let filtered = [...records];
    if (filters) filters(req.body, filtered);
    const limits = getPlanLimits(req.user?.subscription || 'trial', req.user?.email);
    if (!limits.canExport) return res.status(403).json({ error: 'التصدير غير متاح في الخطتك' });
    let exportLimit = limits.exportRows;
    if (exportLimit < 0) exportLimit = filtered.length;
    const data = filtered.slice(0, exportLimit).map(mapFn);
    sendCSV(res, data, filename);
  } catch (e) {
    console.error('Export error:', e);
    res.status(500).json({ error: 'خطأ في التصدير: ' + e.message });
  }
}

// POST /api/export/tenders
exportRouter.post('/tenders', authenticate, (req, res) => {
  handleExport(req, res, TENDERS_FILE, 'tenders',
    (body, arr) => {
      const { search, activity, agency, type, construction, maxDays } = body;
      if (search) { const s = search.toLowerCase(); for (let i = arr.length - 1; i >= 0; i--) { const t = arr[i]; if (!(t.tenderName || '').toLowerCase().includes(s) && !(t.agencyName || '').toLowerCase().includes(s)) arr.splice(i, 1); } }
      if (activity) for (let i = arr.length - 1; i >= 0; i--) if (!(arr[i].tenderActivityName || '').includes(activity)) arr.splice(i, 1);
      if (agency) for (let i = arr.length - 1; i >= 0; i--) if (!(arr[i].agencyName || '').includes(agency)) arr.splice(i, 1);
      if (type) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].tenderTypeName !== type) arr.splice(i, 1);
      if (construction === 'true') { const kw = ['مقاولات','تشييد','بناء','إنشاء','هدم','ترميم','صيانة','طرق','خرسانة']; for (let i = arr.length - 1; i >= 0; i--) if (!kw.some(k => (arr[i].tenderName + arr[i].tenderActivityName).includes(k))) arr.splice(i, 1); }
      if (maxDays) { const now = new Date(); for (let i = arr.length - 1; i >= 0; i--) { const d = arr[i].lastOfferPresentationDate ? Math.ceil((new Date(arr[i].lastOfferPresentationDate) - now) / (1000*3600*24)) : -1; if (d < 0 || d > Number(maxDays)) arr.splice(i, 1); } }
    },
    t => ({ 'اسم المنافسة': t.tenderName || '', 'رقم المنافسة': t.tenderNumber || '', 'الجهة الحكومية': t.agencyName || '', 'النشاط': t.tenderActivityName || '', 'النوع': t.tenderTypeName || '', 'تاريخ النشر': (t.submitionDate || '').substring(0, 10), 'آخر موعد': (t.lastOfferPresentationDate || '').substring(0, 10), 'سعر الكراسة': t.condetionalBookletPrice || '' }),
    'منافسات_' + new Date().toISOString().slice(0, 10)
  );
});

// POST /api/export/contractors
exportRouter.post('/contractors', authenticate, (req, res) => {
  handleExport(req, res, CONTRACTORS_FILE, 'contractors',
    (body, arr) => {
      const { search, region, city, hasEmail } = body;
      if (search) { const s = search.toLowerCase(); for (let i = arr.length - 1; i >= 0; i--) if (!(arr[i].companyName || '').toLowerCase().includes(s)) arr.splice(i, 1); }
      if (region) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].region_name !== region) arr.splice(i, 1);
      if (city) for (let i = arr.length - 1; i >= 0; i--) if (!(arr[i].cityName || '').includes(city)) arr.splice(i, 1);
      if (hasEmail === 'true') for (let i = arr.length - 1; i >= 0; i--) if (!arr[i].email) arr.splice(i, 1);
    },
    c => ({ 'اسم الشركة': c.companyName || '', 'رقم العضوية': c.membershipNo || '', 'المنطقة': c.region_name || '', 'المدينة': c.cityName || '', 'الجوال': c.phone || '', 'البريد الإلكتروني': c.email || '' }),
    'مقاولين_' + new Date().toISOString().slice(0, 10)
  );
});

// POST /api/export/projects
exportRouter.post('/projects', authenticate, (req, res) => {
  handleExport(req, res, PROJECTS_FILE, 'projects',
    (body, arr) => {
      const { search, sector, hasContractor } = body;
      if (search) { const s = search.toLowerCase(); for (let i = arr.length - 1; i >= 0; i--) { const p = arr[i]; if (!(p.title || '').toLowerCase().includes(s) && !(p.contractor || '').toLowerCase().includes(s) && !(p.owner || '').toLowerCase().includes(s)) arr.splice(i, 1); } }
      if (sector) for (let i = arr.length - 1; i >= 0; i--) if ((arr[i].sector || '').toLowerCase() !== sector.toLowerCase()) arr.splice(i, 1);
      if (hasContractor === 'yes') for (let i = arr.length - 1; i >= 0; i--) if (!arr[i].contractor) arr.splice(i, 1);
      if (hasContractor === 'no') for (let i = arr.length - 1; i >= 0; i--) if (arr[i].contractor) arr.splice(i, 1);
    },
    p => ({ 'المشروع': p.title || '', 'المالك': p.owner || '', 'المقاول': p.contractor || '', 'الاستشاري': p.consultant || '', 'القيمة': p.value || '', 'الموقع': p.location || '', 'القطاع': p.sector || '' }),
    'مشاريع_' + new Date().toISOString().slice(0, 10)
  );
});

// POST /api/export/awards
exportRouter.post('/awards', authenticate, (req, res) => {
  handleExport(req, res, AWARDS_FILE, 'awards_sample',
    (body, arr) => {
      const { search } = body;
      if (search) { const s = search.toLowerCase(); for (let i = arr.length - 1; i >= 0; i--) { const a = arr[i]; if (!(a.tenderName || '').toLowerCase().includes(s) && !(a.agency || '').toLowerCase().includes(s)) arr.splice(i, 1); } }
    },
    a => ({ 'المنافسة': a.tenderName || '', 'الجهة': a.agency || '', 'الفائز': a.winner?.name || '', 'قيمة الترسية': a.winner?.value || '', 'عدد المتنافسين': a.biddersCount || 0, 'آخر موعد': a.lastDate || '' }),
    'ترسيات_' + new Date().toISOString().slice(0, 10)
  );
});
