import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { loadUsers, saveUsers, JWT_SECRET, getPlanLimits } from '../middleware/auth.mjs';

export const authRouter = Router();

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'csi-salt-2026').digest('hex');
}

function generateId() {
  return crypto.randomUUID();
}

// Register with 7-day free trial
authRouter.post('/register', (req, res) => {
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
    password: hashPassword(password),
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

  res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({
    token, user: {
      id: user.id, name: user.name, email: user.email,
      subscription: 'trial', trialDaysLeft: 7, trialEnd: trialEnd.toISOString()
    }
  });
});

// Login
authRouter.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبة' });

  const users = loadUsers();
  const user = users.find(u => u.email === email && u.password === hashPassword(password));
  if (!user) return res.status(401).json({ error: 'بريد إلكتروني أو كلمة مرور غير صحيحة' });

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

  let trialDaysLeft = 0;
  if (user.subscription === 'trial') {
    const trialEnd = new Date(user.trialStart);
    trialEnd.setDate(trialEnd.getDate() + 7);
    trialDaysLeft = Math.max(0, Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24)));
  }

  res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
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
      trialEnd.setDate(trialEnd.getDate() + 7);
      trialDaysLeft = Math.max(0, Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24)));
    }

    res.json({
      user: {
        id: user.id, name: user.name, email: user.email,
        company: user.company, phone: user.phone,
        subscription: user.subscription, trialDaysLeft,
        planLimits: getPlanLimits(user.subscription)
      }
    });
  } catch(e) {
    res.json({ user: null });
  }
});

// Logout
authRouter.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});
