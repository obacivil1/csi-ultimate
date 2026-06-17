import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { loadUsers, saveUsers, JWT_SECRET, getPlanLimits } from '../middleware/auth.mjs';

export const authRouter = Router();

const BCRYPT_ROUNDS = 10;

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

// Register with 3-day free trial
authRouter.post('/register', async (req, res) => {
  const { name, email, password, phone, company } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'الاسم، البريد الإلكتروني وكلمة المرور مطلوبة' });
  }

  const users = loadUsers();
  if (users.find(u => u.email === email)) {
    return res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
  }

  const user = {
    id: generateId(),
    name, email, phone: phone || '', company: company || '',
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
  trialEnd.setDate(trialEnd.getDate() + 3);

  const cookieOpts = { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 * 1000 };
  if (process.env.NODE_ENV === 'production') cookieOpts.secure = true;
  res.cookie('token', token, cookieOpts);
  res.json({
    token, user: {
      id: user.id, name: user.name, email: user.email,
      subscription: 'trial', trialDaysLeft: 3, trialEnd: trialEnd.toISOString()
    }
  });
});

// Login
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبة' });

  const users = loadUsers();
  const user = users.find(u => u.email === email);
  if (!user) return res.status(401).json({ error: 'بريد إلكتروني أو كلمة مرور غير صحيحة' });

  const valid = await verifyPassword(password, user.password);
  if (!valid) return res.status(401).json({ error: 'بريد إلكتروني أو كلمة مرور غير صحيحة' });

  if (!isBcrypt(user.password)) {
    user.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    saveUsers(users);
  }

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

  let trialDaysLeft = 0;
  if (user.subscription === 'trial') {
    const trialEnd = new Date(user.trialStart);
    trialEnd.setDate(trialEnd.getDate() + 3);
    trialDaysLeft = Math.max(0, Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24)));
  }

  const cookieOpts = { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 * 1000 };
  if (process.env.NODE_ENV === 'production') cookieOpts.secure = true;
  res.cookie('token', token, cookieOpts);
  res.json({
    token, user: {
      id: user.id, name: user.name, email: user.email,
      company: user.company, phone: user.phone,
      subscription: user.subscription, trialDaysLeft
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

    let trialDaysLeft = 0;
    if (user.subscription === 'trial') {
      const trialEnd = new Date(user.trialStart);
      trialEnd.setDate(trialEnd.getDate() + 3);
      trialDaysLeft = Math.max(0, Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24)));
    }

    res.json({
      user: {
        id: user.id, name: user.name, email: user.email,
        company: user.company, phone: user.phone,
        subscription: user.subscription, trialDaysLeft,
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
