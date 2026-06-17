import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, getPlanLimits } from '../middleware/auth.mjs';
import { getJSON } from '../cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectsRouter = Router();

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'projects_database.json');

function loadProjects() {
  return getJSON('projects', DATA_FILE);
}

// GET /api/projects - List with filters
projectsRouter.get('/', authenticate, (req, res) => {
  let projects = loadProjects();
  if (!Array.isArray(projects)) projects = [];

  const { search, sector, location, hasContractor, page = 1, limit = 15 } = req.query;

  let filtered = [...projects];

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(p =>
      (p.title || '').toLowerCase().includes(s) ||
      (p.contractor || '').toLowerCase().includes(s) ||
      (p.owner || '').toLowerCase().includes(s) ||
      (p.consultant || '').toLowerCase().includes(s) ||
      (p.location || '').toLowerCase().includes(s)
    );
  }
  if (sector) filtered = filtered.filter(p => (p.sector || '').toLowerCase() === sector.toLowerCase());
  if (location) filtered = filtered.filter(p => (p.location || '').toLowerCase().includes(location.toLowerCase()));
  if (hasContractor === 'yes') filtered = filtered.filter(p => p.contractor);
  if (hasContractor === 'no') filtered = filtered.filter(p => !p.contractor);

  // Plan limits
  const limits = getPlanLimits(req.user?.subscription || 'trial');
  let total = filtered.length;
  if (limits.maxProjects && total > limits.maxProjects) {
    total = limits.maxProjects;
    filtered = filtered.slice(0, total);
  }

  const totalPages = Math.ceil(total / Number(limit));
  const p = Number(page);
  const start = (p - 1) * Number(limit);
  const data = filtered.slice(start, start + Number(limit));

  res.json({
    data,
    pagination: { page: p, limit: Number(limit), total, totalPages },
    plan: { limits, subscription: req.user?.subscription || 'guest' },
    stats: { total: projects.length, bySector: {} }
  });
});

// GET /api/projects/sectors
projectsRouter.get('/sectors', (req, res) => {
  const projects = loadProjects();
  if (!Array.isArray(projects)) return res.json({ sectors: [] });
  const sectors = {};
  for (const p of projects) {
    const s = p.sector || 'غير محدد';
    sectors[s] = (sectors[s] || 0) + 1;
  }
  res.json(Object.entries(sectors).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })));
});

// GET /api/projects/locations
projectsRouter.get('/locations', (req, res) => {
  const projects = loadProjects();
  if (!Array.isArray(projects)) return res.json([]);
  const locs = {};
  for (const p of projects) {
    const l = p.location || 'غير محدد';
    locs[l] = (locs[l] || 0) + 1;
  }
  res.json(Object.entries(locs).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })));
});
