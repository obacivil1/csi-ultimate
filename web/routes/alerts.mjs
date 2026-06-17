import { Router } from 'express';
import { authenticate, getPlanLimits, isAdmin } from '../middleware/auth.mjs';
import { getJSON } from '../cache.mjs';
import { isEmailConfigured, sendExpiryAlert } from '../email.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const alertsRouter = Router();

const TENDERS_FILE = path.join(__dirname, '..', '..', 'data', 'etimad_all_tenders.json');
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

// GET /api/alerts/config - get email config status
alertsRouter.get('/config', authenticate, (req, res) => {
  const limits = getPlanLimits(req.user.subscription, req.user.email);
  res.json({
    emailConfigured: isEmailConfigured(),
    canSendEmail: limits.canExport && (isAdmin(req.user.email) || req.user.subscription === 'professional' || req.user.subscription === 'enterprise'),
    subscription: req.user.subscription
  });
});

// POST /api/alerts/send-expiry - send expiry notification to current user
alertsRouter.post('/send-expiry', authenticate, async (req, res) => {
  try {
    const limits = getPlanLimits(req.user.subscription, req.user.email);
    if (limits.maxTenders === 0) return res.status(403).json({ error: 'حسابك غير نشط' });
    if (!isAdmin(req.user.email) && req.user.subscription !== 'professional' && req.user.subscription !== 'enterprise') {
      return res.status(403).json({ error: 'التنبيهات متاحة للباقة الاحترافية والشاملة فقط' });
    }
    const tenders = getJSON('tenders', TENDERS_FILE);
    const now = new Date();
    const expiryThreshold = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const expiringSoon = tenders.filter(t => {
      if (!t.lastOfferPresentationDate) return false;
      const d = new Date(t.lastOfferPresentationDate);
      return d > now && d <= expiryThreshold;
    }).sort((a, b) => new Date(a.lastOfferPresentationDate) - new Date(b.lastOfferPresentationDate))
      .slice(0, 20)
      .map(t => ({
        ...t,
        remainingDays: Math.ceil((new Date(t.lastOfferPresentationDate) - now) / (1000 * 3600 * 24))
      }));
    if (!expiringSoon.length) return res.json({ message: 'لا توجد منافسات على وشك الانتهاء', sent: 0 });
    await sendExpiryAlert(req.user, expiringSoon);
    res.json({ message: `تم إرسال ${expiringSoon.length} تنبيه`, sent: expiringSoon.length });
  } catch (e) {
    console.error('Alert error:', e);
    res.status(500).json({ error: e.message });
  }
});
