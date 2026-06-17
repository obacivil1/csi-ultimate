import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { loadUsers, saveUsers, JWT_SECRET, isAdmin } from '../middleware/auth.mjs';

export const paymentsRouter = Router();

const PAYPAL_API = process.env.PAYPAL_SANDBOX === 'true'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
console.log('[payments] PAYPAL_CLIENT_ID set =', !!process.env.PAYPAL_CLIENT_ID, '| PAYPAL_CLIENT_SECRET set =', !!process.env.PAYPAL_CLIENT_SECRET, '| SANDBOX =', process.env.PAYPAL_SANDBOX);
console.log('[payments] All env keys:', Object.keys(process.env).filter(k => k.startsWith('PAYPAL') || k.startsWith('JWT') || k.startsWith('PORT')).join(', '));

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
  const id = process.env.PAYPAL_CLIENT_ID || '';
  const secret = process.env.PAYPAL_CLIENT_SECRET || '';
  res.json({ configured: !!(id && secret), clientId: id, keys: Object.keys(process.env).filter(k => k.startsWith('PAYPAL')).join(',') });
});

paymentsRouter.post('/create-order', async (req, res) => {
  const { planId } = req.body;
  const plan = PLANS[planId];
  if (!plan) return res.status(400).json({ error: 'باقة غير صالحة' });

  // Admin auto-activation (no payment needed)
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (isAdmin(decoded.email)) {
        return res.json({
          mock: true, orderId: 'ADMIN-' + Date.now(), plan,
          amount: 0, currency: 'USD',
          message: 'تفعيل فوري للمشرف — بدون دفع'
        });
      }
    } catch {}
  }

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.json({
      mock: true,
      orderId: 'MOCK-' + Date.now(),
      plan,
      amount: plan.priceUSD,
      currency: 'USD',
      message: 'PayPal غير مهيأ. للاختبار: اضغط تأكيد للتفعيل المباشر.'
    });
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

    // Mock mode (PayPal not configured OR admin)
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || orderId?.startsWith('MOCK-') || orderId?.startsWith('ADMIN-')) {
      const users = loadUsers();
      const idx = users.findIndex(u => u.id === decoded.id);
      if (idx === -1) return res.status(404).json({ error: 'المستخدم غير موجود' });
      users[idx].subscription = planId;
      users[idx].subscriptionStart = new Date().toISOString();
      users[idx].paypalSubscriptionId = 'mock-' + Date.now();
      saveUsers(users);
      return res.json({ success: true, message: 'تم تفعيل الاشتراك بنجاح (وهمي)', subscription: planId, plan: plan.name });
    }

    // Real PayPal capture
    const ppToken = await getPayPalToken();
    const r = await fetch(PAYPAL_API + '/v2/checkout/orders/' + orderId + '/capture', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ppToken, 'Content-Type': 'application/json' }
    });
    const capture = await r.json();
    if (capture.status !== 'COMPLETED') return res.status(400).json({ error: 'الدفع لم يكتمل' });

    const users = loadUsers();
    const idx = users.findIndex(u => u.id === decoded.id);
    if (idx === -1) return res.status(404).json({ error: 'المستخدم غير موجود' });
    users[idx].subscription = planId;
    users[idx].subscriptionStart = new Date().toISOString();
    users[idx].paypalSubscriptionId = orderId;
    saveUsers(users);

    res.json({ success: true, message: 'تم تفعيل الاشتراك بنجاح', subscription: planId, plan: plan.name, captureId: capture.purchase_units?.[0]?.payments?.captures?.[0]?.id });
  } catch (e) {
    res.status(500).json({ error: 'فشل تأكيد الدفع: ' + e.message });
  }
});

paymentsRouter.post('/paypal-webhook', (req, res) => {
  const event = req.body;
  console.log('PayPal webhook:', event.event_type);
  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
    if (orderId) {
      const users = loadUsers();
      const idx = users.findIndex(u => u.paypalSubscriptionId === orderId);
      if (idx > -1) {
        users[idx].subscription = 'professional';
        users[idx].subscriptionStart = new Date().toISOString();
        saveUsers(users);
        console.log('Webhook activated subscription for:', users[idx].email);
      }
    }
  }
  res.json({ received: true });
});
