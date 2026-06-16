import { Router } from 'express';
import { authenticate } from '../middleware/auth.mjs';

export const dashboardRouter = Router();

// GET /api/dashboard/summary - Main dashboard stats
dashboardRouter.get('/summary', authenticate, (req, res) => {
  const { subscription, trialDaysLeft } = req.user;

  res.json({
    user: {
      name: req.user.name,
      email: req.user.email,
      company: req.user.company,
      subscription,
      trialDaysLeft: trialDaysLeft || 0,
      isActive: ['basic', 'professional', 'enterprise', 'trial'].includes(subscription),
      isTrial: subscription === 'trial',
      isExpired: subscription === 'expired'
    },
    features: {
      canViewTenders: true,
      canViewContractors: ['basic', 'professional', 'enterprise', 'trial'].includes(subscription),
      canExport: ['professional', 'enterprise'].includes(subscription),
      canUseAPI: ['enterprise'].includes(subscription),
      maxExport: subscription === 'trial' ? 50 : subscription === 'basic' ? 200 : -1
    }
  });
});
