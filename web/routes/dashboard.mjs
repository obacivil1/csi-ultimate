import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, getPlanLimits } from '../middleware/auth.mjs';
import { getJSON } from '../cache.mjs';
import { computeTenderAnalytics } from '../analytics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dashboardRouter = Router();

const TENDERS_FILE = path.join(__dirname, '..', '..', 'data', 'etimad_all_tenders.json');

// In-memory analytics cache (computed once, refreshed when tenders cache invalidates).
// Shape is produced by the shared analytics module so the public insights page and
// this dashboard always agree on the numbers.
let analyticsCache = null;
let analyticsCacheTime = 0;
const ANALYTICS_CACHE_TTL = 3600000; // 1h

// GET /api/dashboard/summary - Main dashboard stats
dashboardRouter.get('/summary', authenticate, (req, res) => {
  const { subscription, trialDaysLeft, subscriptionDaysLeft } = req.user;
  const limits = getPlanLimits(subscription, req.user.email);

  res.json({
    user: {
      name: req.user.name,
      email: req.user.email,
      company: req.user.company,
      subscription,
      trialDaysLeft: trialDaysLeft || 0,
      subscriptionDaysLeft: subscriptionDaysLeft || 0,
      isActive: ['basic', 'professional', 'enterprise', 'trial'].includes(subscription),
      isTrial: subscription === 'trial',
      isExpired: subscription === 'expired'
    },
    features: {
      canViewTenders: true,
      canViewContractors: limits.canViewContractors,
      canExport: limits.canExport,
      canUseAPI: subscription === 'enterprise',
      maxExport: limits.exportRows,
      tenderPct: limits.tenderPct
    }
  });
});

// GET /api/dashboard/analytics - Charts data (cached)
dashboardRouter.get('/analytics', authenticate, (req, res) => {
  try {
    const now = Date.now();
    if (analyticsCache && (now - analyticsCacheTime) < ANALYTICS_CACHE_TTL) {
      return res.json(analyticsCache);
    }
    const tenders = getJSON('tenders', TENDERS_FILE) || [];
    analyticsCache = computeTenderAnalytics(tenders);
    analyticsCacheTime = now;
    res.json(analyticsCache);
  } catch(e) {
    res.json({ topAgencies: [], activityDist: [], monthlyTrend: [] });
  }
});
