import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate, isAdmin } from '../middleware/auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const contactRouter = Router();

const MSGS_FILE = path.join(__dirname, '..', '..', 'data', 'contact_messages.json');

function loadMessages() {
  try {
    return JSON.parse(fs.readFileSync(MSGS_FILE, 'utf8'));
  } catch { return []; }
}

function saveMessages(msgs) {
  fs.writeFileSync(MSGS_FILE, JSON.stringify(msgs, null, 2), 'utf8');
}

contactRouter.post('/', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'يرجى تعبئة جميع الحقول' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });
  }
  const msgs = loadMessages();
  msgs.push({
    id: Date.now(),
    name, email, subject, message,
    date: new Date().toISOString(),
    read: false
  });
  saveMessages(msgs);
  res.json({ ok: true });
});

contactRouter.get('/', authenticate, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
  const msgs = loadMessages();
  res.json(msgs.reverse());
});

contactRouter.put('/:id/read', authenticate, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
  const msgs = loadMessages();
  const idx = msgs.findIndex(m => m.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  msgs[idx].read = true;
  saveMessages(msgs);
  res.json({ ok: true });
});
