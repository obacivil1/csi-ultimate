import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, getPlanLimits } from '../middleware/auth.mjs';
import { getJSON } from '../cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const awardsRouter = Router();

const AWARDS_FILE = path.join(__dirname, '..', '..', 'data', 'etimad_all_awards.json');
const SAMPLE_FILE = path.join(__dirname, '..', '..', 'data', 'etimad_sample_awards.json');

function loadAwards() {
  let data = getJSON('awards', AWARDS_FILE);
  if (!data.length) {
    data = getJSON('awards_sample', SAMPLE_FILE);
  }
  return data;
}

awardsRouter.get('/', authenticate, (req, res) => {
  let data = loadAwards();
  const { search, agency, winner, minValue, maxValue, page = 1, limit = 20 } = req.query;

  if (search) {
    const s = search.toLowerCase();
    data = data.filter(a =>
      (a.tenderName || '').toLowerCase().includes(s) ||
      (a.agencyName || '').toLowerCase().includes(s) ||
      (a.winners || []).some(w => (w.name || '').toLowerCase().includes(s))
    );
  }
  if (agency) data = data.filter(a => (a.agencyName || '').includes(agency));
  if (winner) data = data.filter(a => (a.winners || []).some(w => (w.name || '').includes(winner)));
  if (minValue) data = data.filter(a => {
    const v = parseFloat(a.winners?.[0]?.awardValue || a.winners?.[0]?.offerValue || 0);
    return v >= parseFloat(minValue);
  });
  if (maxValue) data = data.filter(a => {
    const v = parseFloat(a.winners?.[0]?.awardValue || a.winners?.[0]?.offerValue || 0);
    return v <= parseFloat(maxValue);
  });

  let total = data.length;
  const limits = getPlanLimits(req.user?.subscription || 'trial');
  if (limits.maxAwards > 0 && total > limits.maxAwards) {
    total = limits.maxAwards;
    data = data.slice(0, total);
  }
  const totalPages = Math.ceil(total / Number(limit));
  const p = Number(page);
  const start = (p - 1) * Number(limit);
  const pageData = data.slice(start, start + Number(limit));

  res.json({
    data: pageData.map(a => ({
      tenderId: a.tenderId,
      tenderName: a.tenderName,
      agency: a.agencyName,
      activity: a.activity,
      type: a.type,
      publishDate: a.publishDate,
      lastDate: a.lastDate,
      winner: a.winners?.[0] ? { name: a.winners[0].name, value: a.winners[0].awardValue || a.winners[0].offerValue } : null,
      biddersCount: a.bidders?.length || 0
    })),
    pagination: { page: p, limit: Number(limit), total, totalPages },
    plan: { limits, subscription: req.user?.subscription }
  });
});

awardsRouter.get('/stats', authenticate, (req, res) => {
  const data = loadAwards();
  const withWinners = data.filter(a => a.winners?.length > 0);
  const totalValue = withWinners.reduce((sum, a) => {
    const v = parseFloat(a.winners?.[0]?.awardValue || a.winners?.[0]?.offerValue || 0);
    return sum + v;
  }, 0);

  res.json({
    total: data.length,
    withWinners: withWinners.length,
    totalValue: Math.round(totalValue),
    avgValue: withWinners.length > 0 ? Math.round(totalValue / withWinners.length) : 0
  });
});
