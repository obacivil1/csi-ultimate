import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { loadUsers, saveUsers, JWT_SECRET } from '../middleware/auth.mjs';

export const paymentsRouter = Router();

// PayPal plans configuration
const PLANS = {
  basic: {
    id: 'basic', name: 'الباقة الأساسية', price: 500, priceUSD: 133,
    features: [
      'البحث في المنافسات الحكومية',
      'عرض 15 منافسة يومياً',
      'تصدير Excel محدود',
      'فلتر حسب النشاط والجهة',
      'دعم عبر البريد الإلكتروني'
    ],
    limit: { dailyTenders: 15, exportRows: 50, contractorAccess: false }
  },
  professional: {
    id: 'professional', name: 'الباقة الاحترافية', price: 1199, priceUSD: 320,
    features: [
      'البحث في جميع المنافسات (غير محدود)',
      'فلتر التشييد والبناء',
      'فلتر الأيام المتبقية (3/7/14/30 يوم)',
      'دليل المقاولين (13,000+)',
      'فلتر المقاولين حسب المنطقة والمدينة',
      'تصدير Excel حتى 1,000 صف',
      'تنبيهات المنافسات المنتهية قريباً',
      'دعم عبر البريد الإلكتروني'
    ],
    limit: { dailyTenders: -1, exportRows: 1000, contractorAccess: true }
  },
  enterprise: {
    id: 'enterprise', name: 'الباقة الشاملة', price: 2999, priceUSD: 800,
    features: [
      'جميع مزايا الباقة الاحترافية',
      'تصدير Excel + PDF غير محدود',
      'الوصول لواجهة API مباشرة للتكامل',
      'تحديث يومي آلي للبيانات',
      'إضافة 5 مستخدمين فرعيين لنفس الحساب',
      'استخراج جوالات وإيميلات المقاولين',
      'تقارير مخصصة حسب الطلب',
      'مدير حساب مخصص',
      'تدريب الفريق عن بُعد'
    ],
    limit: { dailyTenders: -1, exportRows: -1, contractorAccess: true, apiAccess: true, maxUsers: 5 }
  }
};

// GET /api/payments/plans
paymentsRouter.get('/plans', (req, res) => {
  res.json({ plans: Object.values(PLANS).map(p => ({
    id: p.id, name: p.name, price: p.price, priceUSD: p.priceUSD,
    features: p.features, limit: p.limit
  })) });
});

// POST /api/payments/create-order - Create PayPal order
paymentsRouter.post('/create-order', (req, res) => {
  const { planId } = req.body;
  const plan = PLANS[planId];
  if (!plan) return res.status(400).json({ error: 'باقة غير صالحة' });

  // For MVP: generate a simple order reference
  const orderId = 'ORDER-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);

  res.json({
    orderId,
    plan,
    // PayPal sandbox button URL (replace with live when ready)
    paypalLink: `https://www.paypal.com/ncp/payment/${orderId}`,
    amount: plan.priceUSD,
    currency: 'USD'
  });
});

// POST /api/payments/verify - Verify payment and activate subscription
paymentsRouter.post('/verify', (req, res) => {
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'تسجيل الدخول مطلوب' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = loadUsers();
    const userIndex = users.findIndex(u => u.id === decoded.id);
    if (userIndex === -1) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const { planId, paypalOrderId } = req.body;
    const plan = PLANS[planId];
    if (!plan) return res.status(400).json({ error: 'باقة غير صالحة' });

    // For MVP: simulate verification (in production, verify with PayPal API)
    users[userIndex].subscription = planId;
    users[userIndex].subscriptionStart = new Date().toISOString();
    users[userIndex].paypalSubscriptionId = paypalOrderId || 'manual-' + Date.now();
    saveUsers(users);

    res.json({
      success: true,
      message: 'تم تفعيل الاشتراك بنجاح',
      subscription: planId,
      plan: plan.name
    });
  } catch(e) {
    res.status(401).json({ error: 'جلسة غير صالحة' });
  }
});

// POST /api/payments/paypal-webhook - PayPal webhook handler
paymentsRouter.post('/paypal-webhook', (req, res) => {
  const event = req.body;
  console.log('PayPal webhook received:', event.event_type);

  // Handle subscription activation
  if (event.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
    const subscriptionId = event.resource?.id;
    if (subscriptionId) {
      const users = loadUsers();
      const userIndex = users.findIndex(u => u.paypalSubscriptionId === subscriptionId);
      if (userIndex > -1) {
        users[userIndex].subscription = 'professional';
        users[userIndex].subscriptionStart = new Date().toISOString();
        saveUsers(users);
        console.log('Subscription activated for user:', users[userIndex].email);
      }
    }
  }

  res.json({ received: true });
});
