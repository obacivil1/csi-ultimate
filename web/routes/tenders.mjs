import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, requireSubscription, getPlanLimits, applyPlanLimit } from '../middleware/auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const tendersRouter = Router();

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'etimad_all_tenders.json');
const CONSTRUCTION_KW = ['مقاولات','تشييد','بناء','إنشاء','هدم','ترميم','صيانة','تشغيل','نظافة','كهرباء','سباكة','طرق','خرسانة','دهان','عزل','حفر','ردم','تسوية','أساسات','حديد'];

function loadTenders() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

const STATUS_MAP = { 2: 'نشطة', 3: 'فتح العروض', 4: 'فحص العروض', 5: 'الترسية', 6: 'تم الترسية', 8: 'منتهية' };

// GET /api/tenders - List with filters
tendersRouter.get('/', (req, res) => {
  const tenders = loadTenders();
  let filtered = [...tenders];

  // Filters
  const { search, activity, agency, type, status, region, construction, expiring, maxDays, minDays, dateFrom, dateTo, page = 1, limit = 24 } = req.query;

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(t =>
      (t.tenderName || '').toLowerCase().includes(s) ||
      (t.tenderNumber || '').toLowerCase().includes(s) ||
      (t.agencyName || '').toLowerCase().includes(s)
    );
  }
  if (activity) filtered = filtered.filter(t => (t.tenderActivityName || '').includes(activity));
  if (agency) filtered = filtered.filter(t => (t.agencyName || '').includes(agency));
  if (type) filtered = filtered.filter(t => t.tenderTypeName === type);
  if (status) filtered = filtered.filter(t => status.includes(String(t.tenderStatusId)));
  if (dateFrom) filtered = filtered.filter(t => t.lastOfferPresentationDate && t.lastOfferPresentationDate.substring(0, 10) >= dateFrom);
  if (dateTo) filtered = filtered.filter(t => t.lastOfferPresentationDate && t.lastOfferPresentationDate.substring(0, 10) <= dateTo);
  if (construction === 'true') {
    filtered = filtered.filter(t => {
      const txt = (t.tenderName || '') + ' ' + (t.tenderActivityName || '');
      return CONSTRUCTION_KW.some(k => txt.includes(k));
    });
  }
  if (expiring === 'true') {
    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    filtered = filtered.filter(t => {
      const d = t.lastOfferPresentationDate;
      if (!d) return false;
      const dt = new Date(d);
      return dt > now && dt < weekLater;
    });
  }
  // Calculate live remainingDays
  const now = new Date();
  for (const t of filtered) {
    if (t.lastOfferPresentationDate) {
      const dt = new Date(t.lastOfferPresentationDate);
      t._remainingDays = Math.ceil((dt - now) / (1000 * 60 * 60 * 24));
    } else {
      t._remainingDays = null;
    }
  }
  if (maxDays) {
    const max = Number(maxDays);
    filtered = filtered.filter(t => t._remainingDays !== null && t._remainingDays >= 0 && t._remainingDays <= max);
  }
  if (minDays) {
    const min = Number(minDays);
    filtered = filtered.filter(t => t._remainingDays !== null && t._remainingDays >= 0 && t._remainingDays >= min);
  }

  // Pagination
  let total = filtered.length;
  const limits = getPlanLimits(req.user?.subscription || 'trial');
  if (limits.maxTenders > 0 && total > limits.maxTenders) {
    total = limits.maxTenders;
  }
  const totalPages = Math.ceil(total / Number(limit));
  const p = Number(page);
  const start = (p - 1) * Number(limit);
  const data = filtered.slice(start, start + Number(limit));

  // Clean data for response (remove large fields)
  const clean = data.map(t => ({
    id: t.tenderId,
    name: t.tenderName,
    number: t.tenderNumber,
    reference: t.referenceNumber,
    agency: t.agencyName,
    branch: t.branchName,
    activity: t.tenderActivityName,
    type: t.tenderTypeName,
    status: STATUS_MAP[t.tenderStatusId] || t.tenderStatusId,
    publishDate: (t.submitionDate || '').substring(0, 10),
    lastDate: (t.lastOfferPresentationDate || '').substring(0, 10),
    openDate: (t.offersOpeningDate || '').substring(0, 10),
    bookletPrice: t.condetionalBookletPrice,
    remainingDays: t._remainingDays
  }));

  // Aggregations
  const typeCounts = {};
  for (const t of filtered) {
    const ty = t.tenderTypeName || 'غير محدد';
    typeCounts[ty] = (typeCounts[ty] || 0) + 1;
  }

  res.json({
    data: clean,
    pagination: { page: p, limit: Number(limit), total, totalPages },
    plan: { limits, subscription: req.user?.subscription || 'guest' },
    aggregations: { types: typeCounts }
  });
});

// GET /api/tenders/agencies - List all unique agencies
tendersRouter.get('/agencies', (req, res) => {
  const tenders = loadTenders();
  const agencies = {};
  for (const t of tenders) {
    const a = t.agencyName || 'غير محدد';
    agencies[a] = (agencies[a] || 0) + 1;
  }
  res.json(Object.entries(agencies)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))
  );
});

// GET /api/tenders/activities - List all unique activities
tendersRouter.get('/activities', (req, res) => {
  const tenders = loadTenders();
  const activities = {};
  for (const t of tenders) {
    const a = t.tenderActivityName || 'غير محدد';
    activities[a] = (activities[a] || 0) + 1;
  }
  res.json(Object.entries(activities)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))
  );
});

// GET /api/tenders/stats - Quick stats
tendersRouter.get('/stats', (req, res) => {
  const tenders = loadTenders();
  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const expiring = tenders.filter(t => {
    const d = t.lastOfferPresentationDate;
    if (!d) return false;
    const dt = new Date(d);
    return dt > now && dt < weekLater;
  });

  const construction = tenders.filter(t => {
    const txt = (t.tenderName || '') + ' ' + (t.tenderActivityName || '');
    return CONSTRUCTION_KW.some(k => txt.includes(k));
  });

  const active = tenders.filter(t => [2, 3, 4, 5].includes(t.tenderStatusId));

  res.json({
    total: tenders.length,
    active: active.length,
    construction: construction.length,
    expiringSoon: expiring.length,
    types: {
      'شراء مباشر': tenders.filter(t => t.tenderTypeName === 'شراء مباشر').length,
      'منافسة عامة': tenders.filter(t => t.tenderTypeName === 'منافسة عامة').length
    }
  });
});
