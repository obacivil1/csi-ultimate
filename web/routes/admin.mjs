import { Router } from 'express';
import { authenticate, isAdmin, loadUsers, saveUsers } from '../middleware/auth.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const adminRouter = Router();

const MSGS_FILE = path.join(__dirname, '..', '..', 'data', 'contact_messages.json');

function loadMessages() {
  try { return JSON.parse(fs.readFileSync(MSGS_FILE, 'utf8')); } catch { return []; }
}

adminRouter.get('/users', authenticate, (req, res) => {
  if (!isAdmin(req.user?.email)) return res.status(403).json({ error: 'غير مصرح' });
  const users = loadUsers().map(u => {
    const { password, ...rest } = u;
    return rest;
  });
  res.json(users);
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
  fs.writeFileSync(MSGS_FILE, JSON.stringify(msgs, null, 2), 'utf8');
  res.json({ ok: true });
});
