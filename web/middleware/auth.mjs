import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { register, getStore, setStore } from '../store.mjs';
import { env } from '../../config/env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required — set it in .env');
}
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

register('users', USERS_FILE);

export function loadUsers() {
  return getStore('users');
}

export function saveUsers(users) {
  setStore('users', users);
}

const PAID_PLANS = ['basic', 'professional', 'enterprise'];
const DAY_MS = 1000 * 60 * 60 * 24;

// Downgrades expired trials/paid passes to 'expired' and exposes the remaining
// days on the user object. Paid subscriptions carry an explicit subscriptionEnd
// (set on capture); trials are always 7 days from trialStart.
export function normalizeSubscription(user, users) {
  if (user.subscription === 'trial') {
    const trialEnd = new Date(user.trialStart);
    trialEnd.setDate(trialEnd.getDate() + 7);
    if (new Date() > trialEnd) {
      user.subscription = 'expired';
      saveUsers(users);
    } else {
      user.trialDaysLeft = Math.max(0, Math.ceil((trialEnd - new Date()) / DAY_MS));
    }
  } else if (PAID_PLANS.includes(user.subscription) && user.subscriptionEnd) {
    const end = new Date(user.subscriptionEnd);
    if (new Date() > end) {
      user.subscription = 'expired';
      saveUsers(users);
    } else {
      user.subscriptionDaysLeft = Math.max(0, Math.ceil((end - new Date()) / DAY_MS));
    }
  }
}

export function authenticate(req, res, next) {
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'تسجيل الدخول مطلوب' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = loadUsers();
    req.user = users.find(u => u.id === decoded.id);
    if (!req.user) return res.status(401).json({ error: 'المستخدم غير موجود' });

    // Check subscription (trial window or paid 30-day pass)
    normalizeSubscription(req.user, users);

    next();
  } catch(e) {
    return res.status(401).json({ error: 'جلسة غير صالحة' });
  }
}

// Like authenticate, but never blocks: sets req.user when a valid session is
// present, otherwise continues as an anonymous (guest) request. Used by public
// endpoints that return a reduced payload for guests and full data for members.
export function optionalAuth(req, res, next) {
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = loadUsers();
    const user = users.find(u => u.id === decoded.id);
    if (user) { normalizeSubscription(user, users); req.user = user; }
  } catch {}
  next();
}

export function requireSubscription(...plans) {
  return (req, res, next) => {
    if (!plans.includes(req.user.subscription)) {
      return res.status(403).json({ error: 'هذه الميزة تتطلب اشتراك فعّال', requiredPlan: plans[0] });
    }
    next();
  };
}

const ADMIN_EMAILS = ['obacivil@gmail.com'];

export function isAdmin(email) {
  return ADMIN_EMAILS.includes(email);
}

const PLAN_LIMITS = {
  trial: { maxTenders: 50, maxContractors: 100, maxAwards: 15, maxProjects: 20, exportRows: 50, canExport: true, canViewContractors: true, contractorAccess: true, tenderPct: null },
  expired: { maxTenders: 0, maxContractors: 0, maxAwards: 0, maxProjects: 0, exportRows: 0, canExport: false, canViewContractors: false, contractorAccess: false, tenderPct: null },
  // The entry paid tier shows a fraction of tenders (tenderPct); the top tier shows everything.
  basic: { maxTenders: -1, maxContractors: -1, maxAwards: -1, maxProjects: -1, exportRows: 1000, canExport: true, canViewContractors: true, contractorAccess: true, tenderPct: 0.30 },
  enterprise: { maxTenders: -1, maxContractors: -1, maxAwards: -1, maxProjects: -1, exportRows: -1, canExport: true, canViewContractors: true, contractorAccess: true, tenderPct: 1 },
  // Legacy alias (grandfathered accounts) — same access as the top tier.
  professional: { maxTenders: -1, maxContractors: -1, maxAwards: -1, maxProjects: -1, exportRows: -1, canExport: true, canViewContractors: true, contractorAccess: true, tenderPct: 1 }
};

// Effective tender cap for a plan: either a fixed number, or a percentage of the
// total available tenders (rounded up). Returns -1 when unlimited.
export function effectiveTenderLimit(limits, availableTotal) {
  if (!limits) return -1;
  if (limits.tenderPct != null && limits.tenderPct < 1) {
    return Math.max(1, Math.ceil(availableTotal * limits.tenderPct));
  }
  return limits.maxTenders;
}

export function getPlanLimits(subscription, userEmail) {
  if (userEmail && isAdmin(userEmail)) return PLAN_LIMITS.enterprise;
  return PLAN_LIMITS[subscription] || PLAN_LIMITS.trial;
}

export function applyPlanLimit(req, total) {
  const limits = getPlanLimits(req.user?.subscription || 'trial', req.user?.email);
  const max = limits.maxTenders;
  if (max > 0 && total > max) {
    return { limited: true, total: max };
  }
  return { limited: false, total };
}

export { JWT_SECRET };
