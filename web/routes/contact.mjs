import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { register, getStore, setStore } from '../store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const contactRouter = Router();

const MSGS_FILE = path.join(__dirname, '..', '..', 'data', 'contact_messages.json');
register('messages', MSGS_FILE);

contactRouter.post('/', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'يرجى تعبئة جميع الحقول' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });
  }
  const msgs = getStore('messages');
  msgs.push({
    id: Date.now(),
    name, email, subject, message,
    date: new Date().toISOString(),
    read: false
  });
  setStore('messages', msgs);
  res.json({ ok: true });
});
