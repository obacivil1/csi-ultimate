import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { loadUsers, saveUsers, JWT_SECRET, isAdmin } from '../middleware/auth.mjs';
import { logger } from '../../core/logger.mjs';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export const paymentsRouter = Router();

const PAYPAL_API = process.env.PAYPAL_SANDBOX === 'true'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
logger.info('payments module initialised', {
  paypalConfigured: !!PAYPAL_CLIENT_ID && !!PAYPAL_CLIENT_SECRET,
  sandbox: process.env.PAYPAL_SANDBOX === 'true',
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

paymentsRouter.get('/plans', (req, res) => {
  res.json({ plans: Object.values(PLANS).map(p => ({
    id: p.id, name: p.name, price: p.price, priceUSD: p.priceUSD, features: p.features, limit: p.limit
  })) });
});

paymentsRouter.get('/config', (req, res) => {
  const configured = !!(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET);
  res.json({ configured, live: !configured && process.env.PAYPAL_SANDBOX === 'false' ? false : process.env.PAYPAL_SANDBOX !== 'true' });
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
        purchase_units: [{ amount: { currency_code: 'USD', value: plan.priceUSD.toString() }, description: plan.name }]
      })
    });
    const order = await r.json();
    if (order.error) return res.status(500).json({ error: order.error_description || 'فشل إنشاء الدفع' });

    res.json({ orderId: order.id, plan, amount: plan.priceUSD, currency: 'USD' });
  } catch (e) {
    res.status(500).json({ error: 'فشل الاتصال بـ PayPal: ' + e.message });
  }
});

paymentsRouter.post('/capture-order', async (req, res) => {
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'تسجيل الدخول مطلوب' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { orderId, planId } = req.body;
    const plan = PLANS[planId];
    if (!plan) return res.status(400).json({ error: 'باقة غير صالحة' });
    if (!orderId || typeof orderId !== 'string') return res.status(400).json({ error: 'معرّف طلب غير صالح' });

    const users = loadUsers();
    const idx = users.findIndex(u => u.id === decoded.id);
    if (idx === -1) return res.status(404).json({ error: 'المستخدم غير موجود' });

    // Admin-only test mode: ADMIN- orders are issued by create-order strictly to verified admins.
    if (orderId.startsWith('ADMIN-')) {
      if (!isAdmin(decoded.email)) return res.status(403).json({ error: 'غير مصرح' });
      users[idx].subscription = planId;
      users[idx].subscriptionStart = new Date().toISOString();
      users[idx].paypalSubscriptionId = orderId;
      saveUsers(users);
      return res.json({ success: true, message: 'تم تفعيل الاشتراك (اختبار الأدمن)', subscription: planId, plan: plan.name });
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

    users[idx].subscription = planId;
    users[idx].subscriptionStart = new Date().toISOString();
    users[idx].paypalSubscriptionId = orderId;
    saveUsers(users);

    res.json({ success: true, message: 'تم تفعيل الاشتراك بنجاح', subscription: planId, plan: plan.name, captureId: capture.purchase_units?.[0]?.payments?.captures?.[0]?.id });
  } catch (e) {
    res.status(500).json({ error: 'فشل تأكيد الدفع: ' + e.message });
  }
});

// PayPal webhook — verifies authenticity via transmission signature headers.
// Requires PAYPAL_WEBHOOK_ID in production; computes HMAC-SHA256 of
// (transmission_id + transmission_time + webhook_id + crc32(body)).
paymentsRouter.post('/paypal-webhook', async (req, res) => {
  const raw = JSON.stringify(req.body);
  const transmissionId = req.headers['paypal-transmission-id'];
  const transmissionTime = req.headers['paypal-transmission-time'];
  const signature = req.headers['paypal-transmission-sig'];
  const certUrl = req.headers['paypal-cert-url'];
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  if (!webhookId) {
    logger.warn('paypal webhook received but PAYPAL_WEBHOOK_ID not configured', { certUrl });
    return res.status(400).json({ received: false });
  }
  if (!transmissionId || !transmissionTime || !signature) {
    logger.warn('paypal webhook missing transmission headers — rejected');
    return res.status(400).json({ received: false });
  }

  // Verify signature (crc32 = last 8 hex chars of a standard CRC32)
  // Formula per PayPal local-verification docs: HMAC-SHA256(client_secret,
  // transmission_id|transmission_time|webhook_id|crc32), base64-encoded.
  const crc = crc32(Buffer.from(raw)) >>> 0;
  const crcHex = ('00000000' + crc.toString(16)).slice(-8);
  const expected = ['transmission_id=' + transmissionId, 'transmission_time=' + transmissionTime, 'webhook_id=' + webhookId, 'crc32=' + crcHex].join('|');
  const hmac = crypto.createHmac('sha256', PAYPAL_CLIENT_SECRET).update(expected).digest('base64');

  // Constant-time compare to prevent timing attacks
  const ok = hmac.length === signature.length && crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  if (!ok) {
    logger.warn('paypal webhook signature mismatch — rejected');
    return res.status(401).json({ received: false });
  }

  const event = req.body;
  logger.info('paypal webhook authenticated', { eventType: event.event_type });
  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
    if (orderId) {
      const users = loadUsers();
      const idx = users.findIndex(u => u.paypalSubscriptionId === orderId);
      if (idx > -1) {
        users[idx].subscription = 'professional';
        users[idx].subscriptionStart = new Date().toISOString();
        saveUsers(users);
        logger.info('webhook activated subscription', { email: users[idx].email });
      }
    }
  }
  res.json({ received: true });
});
