import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { loadUsers, saveUsers, JWT_SECRET, getPlanLimits, normalizeSubscription, isAdmin } from '../middleware/auth.mjs';
import { env } from '../../config/env.mjs';
import { isTurnstileConfigured, verifyTurnstile } from '../../core/turnstile.mjs';

export const authRouter = Router();

const BCRYPT_ROUNDS = 10;

// Hardened session cookie: httpOnly (no JS access), sameSite=strict (CSRF
// mitigation) and secure in production.
function authCookieOptions() {
  const opts = { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 30 * 24 * 60 * 60 * 1000 };
  if (env.NODE_ENV === 'production') opts.secure = true;
  return opts;
}

// Bot protection — no-op unless TURNSTILE_SECRET_KEY is configured.
async function requireTurnstile(req, res, next) {
  if (!isTurnstileConfigured()) return next();
  const token = req.body?.turnstileToken || req.headers?.['cf-turnstile-response'];
  const ok = await verifyTurnstile(token, req.ip);
  if (!ok) return res.status(400).json({ error: 'فشل التحقق من أنك لست روبوتاً. أعد المحاولة.' });
  next();
}

// Public config for the frontend (site key is public by design).
authRouter.get('/config', (req, res) => {
  res.json({
    turnstileEnabled: isTurnstileConfigured(),
    turnstileSiteKey: env.TURNSTILE.SITE_KEY || null,
  });
});

function isBcrypt(hash) {
  return hash.startsWith('$2b$') || hash.startsWith('$2a$') || hash.startsWith('$2y$');
}

async function verifyPassword(password, hash) {
  if (isBcrypt(hash)) {
    return bcrypt.compare(password, hash);
  }
  const oldHash = crypto.createHash('sha256').update(password + 'csi-salt-2026').digest('hex');
  return oldHash === hash;
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function generateId() {
  return crypto.randomUUID();
}

// Register with 7-day free trial
authRouter.post('/register', requireTurnstile, async (req, res) => {
  const { name, email, password, phone, company } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'الاسم، البريد الإلكتروني وكلمة المرور مطلوبة' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });
  }
  const normalizedEmail = email.trim().toLowerCase();

  const users = loadUsers();
  if (users.find(u => (u.email || '').toLowerCase() === normalizedEmail)) {
    return res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
  }

  const user = {
    id: generateId(),
    name, email: normalizedEmail, phone: phone || '', company: company || '',
    password: await hashPassword(password),
    subscription: 'trial',
    trialStart: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    paypalSubscriptionId: null,
    status: 'active'
  };

  users.push(user);
  saveUsers(users);

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 7);

  res.cookie('token', token, authCookieOptions());
  res.json({
    token, user: {
      id: user.id, name: user.name, email: user.email,
      subscription: 'trial', trialDaysLeft: 7, trialEnd: trialEnd.toISOString()
    }
  });
});

// Login
authRouter.post('/login', requireTurnstile, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبة' });

  const users = loadUsers();
  const lookup = String(email).trim().toLowerCase();
  const user = users.find(u => (u.email || '').toLowerCase() === lookup);
  if (!user) return res.status(401).json({ error: 'بريد إلكتروني أو كلمة مرور غير صحيحة' });

  const valid = await verifyPassword(password, user.password);
  if (!valid) return res.status(401).json({ error: 'بريد إلكتروني أو كلمة مرور غير صحيحة' });

  if (!isBcrypt(user.password)) {
    user.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    saveUsers(users);
  }

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

  normalizeSubscription(user, users);

  res.cookie('token', token, authCookieOptions());
  res.json({
    token, user: {
      id: user.id, name: user.name, email: user.email,
      company: user.company, phone: user.phone,
      subscription: user.subscription,
      trialDaysLeft: user.trialDaysLeft || 0,
      subscriptionDaysLeft: user.subscriptionDaysLeft || 0
    }
  });
});

// Get current user
authRouter.get('/me', (req, res) => {
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (!token) return res.json({ user: null });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = loadUsers();
    const user = users.find(u => u.id === decoded.id);
    if (!user) return res.json({ user: null });

    normalizeSubscription(user, users);

    res.json({
      user: {
        id: user.id, name: user.name, email: user.email,
        company: user.company, phone: user.phone,
        subscription: user.subscription,
        trialDaysLeft: user.trialDaysLeft || 0,
        subscriptionDaysLeft: user.subscriptionDaysLeft || 0,
        subscriptionEnd: user.subscriptionEnd || null,
        isAdmin: isAdmin(user.email),
        planLimits: getPlanLimits(user.subscription, user.email)
      }
    });
  } catch(e) {
    res.json({ user: null });
  }
});

// Logout
authRouter.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ success: true });
});
