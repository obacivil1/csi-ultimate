import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, requireSubscription, getPlanLimits } from '../middleware/auth.mjs';
import { getJSON } from '../cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const contractorsRouter = Router();

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'muqawil_all_regions.json');

function loadContractors() {
  return getJSON('contractors', DATA_FILE);
}

// GET /api/contractors - List with filters
contractorsRouter.get('/', authenticate, (req, res) => {
  const contractors = loadContractors();
  let filtered = [...contractors];

  const { search, region, city, hasEmail, hasPhone, page = 1, limit = 50 } = req.query;

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(c =>
      (c.companyName || '').toLowerCase().includes(s) ||
      (c.membershipNo || '').toLowerCase().includes(s)
    );
  }
  if (region) filtered = filtered.filter(c => c.region_name === region);
  if (city) filtered = filtered.filter(c => (c.cityName || '').includes(city));
  if (hasEmail === 'true') filtered = filtered.filter(c => c.email);
  if (hasPhone === 'true') filtered = filtered.filter(c => c.phone);

  let total = filtered.length;
  const limits = getPlanLimits(req.user?.subscription || 'trial', req.user?.email);
  if (limits.maxContractors > 0 && total > limits.maxContractors) {
    total = limits.maxContractors;
    filtered = filtered.slice(0, total);
  }
  const totalPages = Math.ceil(total / Number(limit));
  const p = Number(page);
  const start = (p - 1) * Number(limit);
  const data = filtered.slice(start, start + Number(limit));

  const clean = data.map(c => ({
    companyName: c.companyName,
    membershipNo: c.membershipNo,
    region: c.region_name,
    city: c.cityName,
    phone: c.phone,
    email: c.email,
    companySize: c.companySize
  }));

  res.json({ data: clean, pagination: { page: p, limit: Number(limit), total, totalPages }, plan: { limits, subscription: req.user?.subscription } });
});

// GET /api/contractors/regions
contractorsRouter.get('/regions', (req, res) => {
  const contractors = loadContractors();
  const regions = {};
  for (const c of contractors) {
    const r = c.region_name || 'غير محدد';
    regions[r] = (regions[r] || 0) + 1;
  }
  res.json(Object.entries(regions)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))
  );
});

// GET /api/contractors/cities?region=...
contractorsRouter.get('/cities', (req, res) => {
  const contractors = loadContractors();
  const { region } = req.query;
  let filtered = contractors;
  if (region) filtered = filtered.filter(c => c.region_name === region);
  const cities = {};
  for (const c of filtered) {
    const city = c.cityName || 'غير محدد';
    cities[city] = (cities[city] || 0) + 1;
  }
  res.json(Object.entries(cities)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))
  );
});

// GET /api/contractors/stats
contractorsRouter.get('/stats', (req, res) => {
  const contractors = loadContractors();
  const withEmail = contractors.filter(c => c.email).length;
  const withPhone = contractors.filter(c => c.phone).length;
  res.json({
    total: contractors.length,
    withEmail,
    withPhone,
    withoutContact: contractors.length - withEmail - withPhone + Math.min(withEmail, withPhone)
  });
});
