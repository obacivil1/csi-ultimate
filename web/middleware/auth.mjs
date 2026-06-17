import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getJSON, invalidate } from '../cache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET environment variable is required');
  process.exit(1);
}
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

export function loadUsers() {
  return getJSON('users', USERS_FILE);
}

export function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  invalidate('users');
}

export function authenticate(req, res, next) {
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'تسجيل الدخول مطلوب' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = loadUsers();
    req.user = users.find(u => u.id === decoded.id);
    if (!req.user) return res.status(401).json({ error: 'المستخدم غير موجود' });

    // Check subscription
    if (req.user.subscription === 'trial') {
      const trialEnd = new Date(req.user.trialStart);
      trialEnd.setDate(trialEnd.getDate() + 7);
      if (new Date() > trialEnd) {
        req.user.subscription = 'expired';
        saveUsers(users);
      } else {
        req.user.trialDaysLeft = Math.max(0, Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24)));
      }
    }

    next();
  } catch(e) {
    return res.status(401).json({ error: 'جلسة غير صالحة' });
  }
}

export function requireSubscription(...plans) {
  return (req, res, next) => {
    if (!plans.includes(req.user.subscription)) {
      return res.status(403).json({ error: 'هذه الميزة تتطلب اشتراك فعّال', requiredPlan: plans[0] });
    }
    next();
  };
}

const PLAN_LIMITS = {
  trial: { maxTenders: 240, maxContractors: 100, maxAwards: 15, maxProjects: 20, exportRows: 50, canExport: true, canViewContractors: true, contractorAccess: true },
  expired: { maxTenders: 0, maxContractors: 0, maxAwards: 0, maxProjects: 0, exportRows: 0, canExport: false, canViewContractors: false, contractorAccess: false },
  basic: { maxTenders: 360, maxContractors: 500, maxAwards: 50, maxProjects: 50, exportRows: 50, canExport: true, canViewContractors: true, contractorAccess: true },
  professional: { maxTenders: -1, maxContractors: -1, maxAwards: -1, maxProjects: -1, exportRows: 1000, canExport: true, canViewContractors: true, contractorAccess: true },
  enterprise: { maxTenders: -1, maxContractors: -1, maxAwards: -1, maxProjects: -1, exportRows: -1, canExport: true, canViewContractors: true, contractorAccess: true }
};

export function getPlanLimits(subscription) {
  return PLAN_LIMITS[subscription] || PLAN_LIMITS.trial;
}

export function applyPlanLimit(req, total) {
  const limits = getPlanLimits(req.user?.subscription || 'trial');
  const max = limits.maxTenders;
  if (max > 0 && total > max) {
    return { limited: true, total: max };
  }
  return { limited: false, total };
}

export { JWT_SECRET };
