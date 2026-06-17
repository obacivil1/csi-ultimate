import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const contactRouter = Router();

const MSGS_FILE = path.join(__dirname, '..', '..', 'data', 'contact_messages.json');

contactRouter.post('/', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'يرجى تعبئة جميع الحقول' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });
  }
  let msgs = [];
  try { msgs = JSON.parse(fs.readFileSync(MSGS_FILE, 'utf8')); } catch {}
  msgs.push({
    id: Date.now(),
    name, email, subject, message,
    date: new Date().toISOString(),
    read: false
  });
  fs.writeFileSync(MSGS_FILE, JSON.stringify(msgs, null, 2), 'utf8');
  res.json({ ok: true });
});
