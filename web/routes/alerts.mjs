import { Router } from 'express';
import { authenticate, getPlanLimits, isAdmin } from '../middleware/auth.mjs';
import { isEmailConfigured, sendExpiryAlert } from '../email.mjs';

export const alertsRouter = Router();

// GET /api/alerts/config - check if email is configured
alertsRouter.get('/config', authenticate, (req, res) => {
  const limits = getPlanLimits(req.user.subscription, req.user.email);
  const canSend = limits.exportRows === -1 || limits.exportRows >= 1000 || isAdmin(req.user.email);
  res.json({
    emailConfigured: isEmailConfigured(),
    canSend,
    userEmail: req.user.email
  });
});

// POST /api/alerts/send-expiry - send expiry alert email
alertsRouter.post('/send-expiry', authenticate, async (req, res) => {
  try {
    const limits = getPlanLimits(req.user.subscription, req.user.email);
    const canSend = limits.exportRows === -1 || limits.exportRows >= 1000 || isAdmin(req.user.email);
    if (!canSend) {
      return res.status(403).json({ error: 'هذه الميزة تتطلب الباقة الاحترافية أو الشاملة' });
    }
    if (!isEmailConfigured()) {
      return res.status(400).json({ error: 'البريد الإلكتروني غير مهيأ. يرجى ضبط SMTP_HOST, SMTP_USER, SMTP_PASS' });
    }

    // Get expiring tenders from the API
    const tendersRes = await fetch(`http://localhost:${process.env.PORT || 3000}/api/tenders?expiring=true&limit=50`);
    const tendersData = await tendersRes.json();

    if (!tendersData.data || !tendersData.data.length) {
      return res.status(400).json({ error: 'لا توجد منافسات منتهية قريباً' });
    }

    await sendExpiryAlert(req.user, tendersData.data);
    res.json({ success: true, sent: tendersData.data.length });
  } catch (e) {
    console.error('Alert error:', e);
    res.status(500).json({ error: 'خطأ في إرسال التنبيه: ' + e.message });
  }
});
