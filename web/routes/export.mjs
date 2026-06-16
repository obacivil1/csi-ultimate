import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
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

function sendExcel(res, data, headers, filename) {
  const ws = XLSX.utils.json_to_sheet(data, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  res.send(buf);
}

// POST /api/export/tenders
exportRouter.post('/tenders', authenticate, (req, res) => {
  const tenders = loadJSON(TENDERS_FILE, 'tenders');
  let filtered = [...tenders];
  const { search, activity, agency, type, construction, maxDays } = req.body;

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(t => (t.tenderName || '').toLowerCase().includes(s) || (t.agencyName || '').toLowerCase().includes(s));
  }
  if (activity) filtered = filtered.filter(t => (t.tenderActivityName || '').includes(activity));
  if (agency) filtered = filtered.filter(t => (t.agencyName || '').includes(agency));
  if (type) filtered = filtered.filter(t => t.tenderTypeName === type);
  if (construction === 'true') {
    const kw = ['مقاولات','تشييد','بناء','إنشاء','هدم','ترميم','صيانة','طرق','خرسانة'];
    filtered = filtered.filter(t => kw.some(k => (t.tenderName + t.tenderActivityName).includes(k)));
  }
  if (maxDays) {
    const now = new Date();
    filtered = filtered.filter(t => {
      if (!t.lastOfferPresentationDate) return false;
      const d = Math.ceil((new Date(t.lastOfferPresentationDate) - now) / (1000*3600*24));
      return d >= 0 && d <= Number(maxDays);
    });
  }

  const limits = getPlanLimits(req.user?.subscription || 'trial');
  if (!limits.canExport) return res.status(403).json({ error: 'التصدير غير متاح في الخطتك' });
  let exportLimit = limits.exportRows;
  if (exportLimit < 0) exportLimit = filtered.length;
  const data = filtered.slice(0, exportLimit).map(t => ({
    'اسم المنافسة': t.tenderName || '',
    'رقم المنافسة': t.tenderNumber || '',
    'الجهة الحكومية': t.agencyName || '',
    'النشاط': t.tenderActivityName || '',
    'النوع': t.tenderTypeName || '',
    'تاريخ النشر': (t.submitionDate || '').substring(0, 10),
    'آخر موعد': (t.lastOfferPresentationDate || '').substring(0, 10),
    'سعر الكراسة': t.condetionalBookletPrice || ''
  }));

  sendExcel(res, data, ['اسم المنافسة','رقم المنافسة','الجهة الحكومية','النشاط','النوع','تاريخ النشر','آخر موعد','سعر الكراسة'], 'منافسات_' + new Date().toISOString().slice(0,10));
});

// POST /api/export/contractors
exportRouter.post('/contractors', authenticate, (req, res) => {
  const contractors = loadJSON(CONTRACTORS_FILE, 'contractors');
  let filtered = [...contractors];
  const { search, region, city, hasEmail } = req.body;

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(c => (c.companyName || '').toLowerCase().includes(s));
  }
  if (region) filtered = filtered.filter(c => c.region_name === region);
  if (city) filtered = filtered.filter(c => (c.cityName || '').includes(city));
  if (hasEmail === 'true') filtered = filtered.filter(c => c.email);

  const limits = getPlanLimits(req.user?.subscription || 'trial');
  if (!limits.canExport) return res.status(403).json({ error: 'التصدير غير متاح في خطتك' });
  let exportLimit = limits.exportRows;
  if (exportLimit < 0) exportLimit = filtered.length;
  const data = filtered.slice(0, exportLimit).map(c => ({
    'اسم الشركة': c.companyName || '',
    'رقم العضوية': c.membershipNo || '',
    'المنطقة': c.region_name || '',
    'المدينة': c.cityName || '',
    'الجوال': c.phone || '',
    'البريد الإلكتروني': c.email || ''
  }));

  sendExcel(res, data, ['اسم الشركة','رقم العضوية','المنطقة','المدينة','الجوال','البريد الإلكتروني'], 'مقاولين_' + new Date().toISOString().slice(0,10));
});

// POST /api/export/projects
exportRouter.post('/projects', authenticate, (req, res) => {
  const projects = loadJSON(PROJECTS_FILE, 'projects');
  let filtered = [...projects];
  const { search, sector, hasContractor } = req.body;

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(p => (p.title || '').toLowerCase().includes(s) || (p.contractor || '').toLowerCase().includes(s) || (p.owner || '').toLowerCase().includes(s));
  }
  if (sector) filtered = filtered.filter(p => (p.sector || '').toLowerCase() === sector.toLowerCase());
  if (hasContractor === 'yes') filtered = filtered.filter(p => p.contractor);
  if (hasContractor === 'no') filtered = filtered.filter(p => !p.contractor);

  const limits = getPlanLimits(req.user?.subscription || 'trial');
  if (!limits.canExport) return res.status(403).json({ error: 'التصدير غير متاح في خطتك' });
  let exportLimit = limits.exportRows;
  if (exportLimit < 0) exportLimit = filtered.length;
  const data = filtered.slice(0, exportLimit).map(p => ({
    'المشروع': p.title || '',
    'المالك': p.owner || '',
    'المقاول': p.contractor || '',
    'الاستشاري': p.consultant || '',
    'القيمة': p.value || '',
    'الموقع': p.location || '',
    'القطاع': p.sector || ''
  }));

  sendExcel(res, data, ['المشروع','المالك','المقاول','الاستشاري','القيمة','الموقع','القطاع'], 'مشاريع_' + new Date().toISOString().slice(0,10));
});

// POST /api/export/awards
exportRouter.post('/awards', authenticate, (req, res) => {
  const awards = loadJSON(AWARDS_FILE, 'awards_sample');
  let filtered = [...awards];
  const { search } = req.body;

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(a => (a.tenderName || '').toLowerCase().includes(s) || (a.agency || '').toLowerCase().includes(s));
  }

  const limits = getPlanLimits(req.user?.subscription || 'trial');
  if (!limits.canExport) return res.status(403).json({ error: 'التصدير غير متاح في خطتك' });
  let exportLimit = limits.exportRows;
  if (exportLimit < 0) exportLimit = filtered.length;
  const data = filtered.slice(0, exportLimit).map(a => ({
    'المنافسة': a.tenderName || '',
    'الجهة': a.agency || '',
    'الفائز': a.winner?.name || '',
    'قيمة الترسية': a.winner?.value || '',
    'عدد المتنافسين': a.biddersCount || 0,
    'آخر موعد': a.lastDate || ''
  }));

  sendExcel(res, data, ['المنافسة','الجهة','الفائز','قيمة الترسية','عدد المتنافسين','آخر موعد'], 'ترسيات_' + new Date().toISOString().slice(0,10));
});
