import { Router } from 'express';
import { authenticate, isAdmin, loadUsers, saveUsers } from '../middleware/auth.mjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { register, getStore, setStore } from '../store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const adminRouter = Router();

const MSGS_FILE = path.join(__dirname, '..', '..', 'data', 'contact_messages.json');
register('messages', MSGS_FILE);

function loadMessages() {
  return getStore('messages');
}

function saveMessages(msgs) {
  setStore('messages', msgs);
}

adminRouter.get('/users', authenticate, (req, res) => {
  if (!isAdmin(req.user?.email)) return res.status(403).json({ error: 'غير مصرح' });
  const users = loadUsers().map(u => {
    const { password, ...rest } = u;
    return rest;
  });
  res.json(users);
});

adminRouter.get('/stats', authenticate, (req, res) => {
  if (!isAdmin(req.user?.email)) return res.status(403).json({ error: 'غير مصرح' });
  const users = loadUsers();
  const byPlan = { trial: 0, basic: 0, professional: 0, enterprise: 0, expired: 0 };
  for (const u of users) byPlan[u.subscription] = (byPlan[u.subscription] || 0) + 1;
  // Subscribers grouped by the packages shown on the site (free = trial).
  const subscribers = {
    free: byPlan.trial || 0,
    basic: byPlan.basic || 0,
    enterprise: byPlan.enterprise || 0,
    legacy: byPlan.professional || 0,
  };
  const msgs = loadMessages();
  const recentSignups = users
    .map(({ password, ...u }) => u)
    .sort((a, b) => new Date(b.createdAt || b.trialStart || 0) - new Date(a.createdAt || a.trialStart || 0))
    .slice(0, 5);
  res.json({
    totalUsers: users.length,
    paidUsers: (byPlan.basic || 0) + (byPlan.professional || 0) + (byPlan.enterprise || 0),
    trialUsers: byPlan.trial || 0,
    expiredUsers: byPlan.expired || 0,
    byPlan,
    subscribers,
    totalMessages: msgs.length,
    unreadMessages: msgs.filter(m => !m.read).length,
    recentSignups
  });
});

adminRouter.post('/users/:id/plan', authenticate, (req, res) => {
  if (!isAdmin(req.user?.email)) return res.status(403).json({ error: 'غير مصرح' });
  const { plan, expiryDays } = req.body;
  const validPlans = ['trial', 'basic', 'professional', 'enterprise', 'expired'];
  if (!validPlans.includes(plan)) return res.status(400).json({ error: 'باقة غير صالحة' });

  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'المستخدم غير موجود' });

  users[idx].subscription = plan;
  if (expiryDays) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(expiryDays));
    users[idx].subscriptionEnd = d.toISOString();
  }
  saveUsers(users);
  const { password, ...rest } = users[idx];
  res.json(rest);
});

adminRouter.get('/messages', authenticate, (req, res) => {
  if (!isAdmin(req.user?.email)) return res.status(403).json({ error: 'غير مصرح' });
  const msgs = loadMessages();
  res.json(msgs.reverse());
});

adminRouter.put('/messages/:id/read', authenticate, (req, res) => {
  if (!isAdmin(req.user?.email)) return res.status(403).json({ error: 'غير مصرح' });
  const msgs = loadMessages();
  const idx = msgs.findIndex(m => m.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'غير موجود' });
  msgs[idx].read = true;
  saveMessages(msgs);
  res.json({ ok: true });
});

adminRouter.post('/messages/:id/reply', authenticate, (req, res) => {
  if (!isAdmin(req.user?.email)) return res.status(403).json({ error: 'غير مصرح' });
  const reply = String(req.body?.reply || '').trim();
  if (!reply) return res.status(400).json({ error: 'الرد فارغ' });
  const msgs = loadMessages();
  const idx = msgs.findIndex(m => m.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'الرسالة غير موجودة' });
  msgs[idx].reply = reply;
  msgs[idx].repliedAt = new Date().toISOString();
  msgs[idx].read = true;
  saveMessages(msgs);
  res.json({ ok: true, reply: msgs[idx].reply, repliedAt: msgs[idx].repliedAt });
});
