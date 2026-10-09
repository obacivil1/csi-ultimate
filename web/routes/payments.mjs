import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { loadUsers, saveUsers, JWT_SECRET, isAdmin } from '../middleware/auth.mjs';
import { logger } from '../../core/logger.mjs';
import { env } from '../../config/env.mjs';

export const paymentsRouter = Router();

const PAYPAL_SANDBOX = env.PAYPAL.SANDBOX;
const PAYPAL_API = PAYPAL_SANDBOX
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';
const PAYPAL_CLIENT_ID = env.PAYPAL.CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = env.PAYPAL.CLIENT_SECRET || '';
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';
logger.info('payments module initialised', {
  paypalConfigured: !!PAYPAL_CLIENT_ID && !!PAYPAL_CLIENT_SECRET,
  sandbox: PAYPAL_SANDBOX,
});

const PLANS = {
  basic: { id: 'basic', name: 'الباقة الأساسية', price: 500, priceUSD: 133,
    features: ['البحث في المنافسات الحكومية', 'عرض 15 منافسة يومياً', 'تصدير Excel محدود', 'فلتر حسب النشاط والجهة', 'دعم عبر البريد الإلكتروني'],
    limit: { dailyTenders: 15, exportRows: 50, contractorAccess: false } },
  professional: { id: 'professional', name: 'الباقة الاحترافية', price: 1199, priceUSD: 320,
    features: ['جميع المنافسات (غير محدود)', 'فلتر التشييد والبناء', 'فلتر الأيام المتبقية', 'دليل المقاولين (13,000+)', 'فلتر المقاولين بالمنطقة والمدينة', 'تصدير Excel حتى 1,000 صف', 'تنبيهات المنافسات', 'دعم عبر البريد الإلكتروني'],
    limit: { dailyTenders: -1, exportRows: 1000, contractorAccess: true } },
  enterprise: { id: 'enterprise', name: 'الباقة الشاملة', price: 2999, priceUSD: 800,
    features: ['جميع مزايا الاحترافية', 'تصدير Excel غير محدود', 'API مباشرة للتكامل', 'تحديث يومي آلي', 'إضافة 5 مستخدمين فرعيين', 'استخراج جوالات وإيميلات المقاولين', 'مدير حساب مخصص', 'تدريب الفريق'],
    limit: { dailyTenders: -1, exportRows: -1, contractorAccess: true, apiAccess: true, maxUsers: 5 } }
};

async function getPayPalToken() {
  const auth = Buffer.from(PAYPAL_CLIENT_ID + ':' + PAYPAL_CLIENT_SECRET).toString('base64');
  const r = await fetch(PAYPAL_API + '/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('فشل الحصول على توكن PayPal');
  return d.access_token;
}

// The plan is bound to the order at creation time (custom_id) and re-derived
// from PayPal's own response — never trusted from the client. Fallback to the
// client value only for legacy orders, and always cross-checked against amount.
function resolveOrderPlan(order, fallbackPlanId) {
  const customId = order?.purchase_units?.[0]?.custom_id;
  if (customId && PLANS[customId]) return PLANS[customId];
  if (fallbackPlanId && PLANS[fallbackPlanId]) return PLANS[fallbackPlanId];
  return null;
}

function readCapturedPayment(order) {
  const cap = order?.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    value: parseFloat(cap?.amount?.value),
    currency: cap?.amount?.currency_code,
    captureId: cap?.id,
  };
}

function amountMatchesPlan(payment, plan) {
  return payment.currency === 'USD'
    && Number.isFinite(payment.value)
    && Math.abs(payment.value - plan.priceUSD) <= 0.01;
}

paymentsRouter.get('/plans', (req, res) => {
  res.json({ plans: Object.values(PLANS).map(p => ({
    id: p.id, name: p.name, price: p.price, priceUSD: p.priceUSD, features: p.features, limit: p.limit
  })) });
});

paymentsRouter.get('/config', (req, res) => {
  const configured = !!(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);
  // clientId is a public identifier (safe to expose); the secret never leaves the server.
  res.json({
    configured,
    clientId: PAYPAL_CLIENT_ID || null,
    sandbox: PAYPAL_SANDBOX,
    live: configured && !PAYPAL_SANDBOX,
  });
});

paymentsRouter.post('/create-order', async (req, res) => {
  const { planId } = req.body;
  const plan = PLANS[planId];
  if (!plan) return res.status(400).json({ error: 'باقة غير صالحة' });

  // Admin test mode — simulates full payment flow with $0
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (isAdmin(decoded.email)) {
        return res.json({
          mock: true, orderId: 'ADMIN-' + Date.now(), plan,
          amount: 0, currency: 'USD',
          message: '🧪 اختبار عملية الدفع'
        });
      }
    } catch {}
  }

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.status(503).json({ error: 'الدفع غير مهيأ حالياً. حاول لاحقاً.' });
  }

  try {
    const token = await getPayPalToken();
    const r = await fetch(PAYPAL_API + '/v2/checkout/orders', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: plan.priceUSD.toString() },
          description: plan.name,
          custom_id: plan.id,
          reference_id: plan.id,
        }]
      })
    });
    const order = await r.json();
    if (order.error) return res.status(500).json({ error: order.error_description || 'فشل إنشاء الدفع' });

    res.json({ orderId: order.id, plan, amount: plan.priceUSD, currency: 'USD' });
  } catch (e) {
    logger.error('create-order failed', { error: e.message });
    res.status(500).json({ error: 'فشل الاتصال بـ PayPal. حاول لاحقاً.' });
  }
});

paymentsRouter.post('/capture-order', async (req, res) => {
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'تسجيل الدخول مطلوب' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { orderId, planId } = req.body;
    const requestedPlan = PLANS[planId];
    if (!requestedPlan) return res.status(400).json({ error: 'باقة غير صالحة' });
    if (!orderId || typeof orderId !== 'string') return res.status(400).json({ error: 'معرّف طلب غير صالح' });

    const users = loadUsers();
    const idx = users.findIndex(u => u.id === decoded.id);
    if (idx === -1) return res.status(404).json({ error: 'المستخدم غير موجود' });

    // PayPal order ids are alphanumeric (may include dashes/underscores) — validate to
    // prevent injection into the capture URL (CWE-78/CWE-20).
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(orderId)) {
      return res.status(400).json({ error: 'معرّف طلب غير صالح' });
    }

    // Admin-only test mode: ADMIN- orders are issued by create-order strictly to verified admins.
    if (orderId.startsWith('ADMIN-')) {
      if (!isAdmin(decoded.email)) return res.status(403).json({ error: 'غير مصرح' });
      users[idx].subscription = requestedPlan.id;
      users[idx].subscriptionStart = new Date().toISOString();
      users[idx].paypalSubscriptionId = orderId;
      saveUsers(users);
      return res.json({ success: true, message: 'تم تفعيل الاشتراك (اختبار الأدمن)', subscription: requestedPlan.id, plan: requestedPlan.name });
    }
    // Client-fabricated legacy mock ids are always rejected for every user.
    if (orderId.startsWith('MOCK-')) {
      return res.status(400).json({ error: 'طلب وهمي غير مسموح' });
    }

    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
      return res.status(503).json({ error: 'الدفع غير مهيأ. تواصل معنا لتفعيل اشتراكك.' });
    }

    // Real PayPal capture — verification against PayPal, never trust the client id.
    const ppToken = await getPayPalToken();
    const r = await fetch(PAYPAL_API + '/v2/checkout/orders/' + orderId + '/capture', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ppToken, 'Content-Type': 'application/json' }
    });
    const capture = await r.json();
    if (capture.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'الدفع لم يكتمل', status: capture.status, details: capture.details?.[0]?.issue });
    }

    // Bind the activated plan to what was actually ordered/paid (business-logic guard).
    const paidPlan = resolveOrderPlan(capture, planId);
    if (!paidPlan) {
      logger.warn('capture: unknown plan', { orderId, planId });
      return res.status(400).json({ error: 'تعذّر تحديد الباقة لهذا الطلب' });
    }
    const payment = readCapturedPayment(capture);
    if (!amountMatchesPlan(payment, paidPlan)) {
      logger.warn('capture: amount mismatch — subscription NOT activated', {
        orderId, expected: paidPlan.priceUSD, paid: payment.value, currency: payment.currency,
      });
      return res.status(400).json({ error: 'قيمة الدفع لا تطابق الباقة المطلوبة. لم يتم تفعيل الاشتراك.' });
    }

    users[idx].subscription = paidPlan.id;
    users[idx].subscriptionStart = new Date().toISOString();
    users[idx].paypalSubscriptionId = orderId;
    saveUsers(users);

    res.json({ success: true, message: 'تم تفعيل الاشتراك بنجاح', subscription: paidPlan.id, plan: paidPlan.name, captureId: payment.captureId });
  } catch (e) {
    logger.error('capture-order failed', { error: e.message });
    res.status(500).json({ error: 'فشل تأكيد الدفع' });
  }
});

// PayPal webhook — authenticity is verified server-side against PayPal's own
// verify-webhook-signature API (the local HMAC scheme is not valid for PayPal).
// The activated plan is derived from the order's custom_id and re-checked
// against the captured amount, so a webhook can never grant a plan that wasn't paid for.
paymentsRouter.post('/paypal-webhook', async (req, res) => {
  const transmissionId = req.headers['paypal-transmission-id'];
  const transmissionTime = req.headers['paypal-transmission-time'];
  const signature = req.headers['paypal-transmission-sig'];
  const certUrl = req.headers['paypal-cert-url'];
  const authAlgo = req.headers['paypal-auth-algo'];

  if (!PAYPAL_WEBHOOK_ID || !PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    logger.warn('paypal webhook received but PayPal/webhook id not configured');
    return res.status(400).json({ received: false });
  }
  if (!transmissionId || !transmissionTime || !signature || !certUrl || !authAlgo) {
    logger.warn('paypal webhook missing transmission headers — rejected');
    return res.status(400).json({ received: false });
  }

  try {
    const ppToken = await getPayPalToken();
    const vr = await fetch(PAYPAL_API + '/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ppToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transmission_id: transmissionId,
        transmission_time: transmissionTime,
        cert_url: certUrl,
        auth_algo: authAlgo,
        transmission_sig: signature,
        webhook_id: PAYPAL_WEBHOOK_ID,
        webhook_event: req.body,
      }),
    });
    const verification = await vr.json();
    if (verification.verification_status !== 'SUCCESS') {
      logger.warn('paypal webhook signature rejected', { status: verification.verification_status });
      return res.status(401).json({ received: false });
    }
  } catch (e) {
    logger.error('paypal webhook verification failed', { error: e.message });
    return res.status(401).json({ received: false });
  }

  const event = req.body;
  logger.info('paypal webhook authenticated', { eventType: event.event_type });

  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const resource = event.resource || {};
    const orderId = resource.supplementary_data?.related_ids?.order_id;
    const plan = resource.custom_id ? PLANS[resource.custom_id] : null;
    if (orderId) {
      const users = loadUsers();
      const idx = users.findIndex(u => u.paypalSubscriptionId === orderId);
      if (idx > -1) {
        const paid = parseFloat(resource.amount?.value);
        if (plan && resource.amount?.currency_code === 'USD' && Number.isFinite(paid) && Math.abs(paid - plan.priceUSD) <= 0.01) {
          users[idx].subscription = plan.id;
          users[idx].subscriptionStart = new Date().toISOString();
          saveUsers(users);
          logger.info('webhook activated subscription', { email: users[idx].email, plan: plan.id });
        } else {
          logger.warn('webhook amount/plan mismatch — not activating', { orderId, paid, expected: plan?.priceUSD, currency: resource.amount?.currency_code });
        }
      }
    }
  }
  res.json({ received: true });
});
