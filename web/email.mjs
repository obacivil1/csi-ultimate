import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@csi-ultimate.com';
const FROM_NAME = process.env.FROM_NAME || 'CSI Ultimate';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

export function isEmailConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

export async function sendEmail(to, subject, html) {
  const t = getTransporter();
  if (!t) throw new Error('البريد الإلكتروني غير مهيأ. يرجى ضبط SMTP_HOST, SMTP_USER, SMTP_PASS');
  await t.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to,
    subject,
    html
  });
}

export async function sendExpiryAlert(user, tenders) {
  if (!tenders.length) return;
  const rows = tenders.map(t => `
    <tr>
      <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(t.tenderName || '')}</td>
      <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(t.agencyName || '')}</td>
      <td style="padding:8px;border:1px solid #ddd;">${t.lastOfferPresentationDate ? t.lastOfferPresentationDate.substring(0,10) : ''}</td>
      <td style="padding:8px;border:1px solid #ddd;color:${t.remainingDays <= 3 ? '#DC3545' : '#856404'};font-weight:700;">${t.remainingDays || 0} يوم</td>
    </tr>
  `).join('');
  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#1F3864;">🔔 تنبيه منافسات منتهية قريباً</h2>
      <p>مرحباً ${escapeHtml(user.name || '')},</p>
      <p>المنافسات التالية على وشك الانتهاء:</p>
      <table style="width:100%;border-collapse:collapse;margin:15px 0;">
        <thead><tr style="background:#1F3864;color:white;">
          <th style="padding:8px;border:1px solid #1F3864;">المنافسة</th>
          <th style="padding:8px;border:1px solid #1F3864;">الجهة</th>
          <th style="padding:8px;border:1px solid #1F3864;">آخر موعد</th>
          <th style="padding:8px;border:1px solid #1F3864;">المتبقي</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p><a href="https://csi-ultimate.onrender.com/dashboard" style="display:inline-block;padding:10px 20px;background:#1F3864;color:white;text-decoration:none;border-radius:5px;">عرض التفاصيل</a></p>
      <hr style="margin:20px 0;border:none;border-top:1px solid #eee;">
      <p style="color:#888;font-size:0.85em;">هذا إشعار تلقائي من CSI Ultimate. يمكنك إيقاف التنبيهات من لوحة التحكم.</p>
    </div>
  `;
  await sendEmail(user.email, `🔔 ${tenders.length} منافسة على وشك الانتهاء`, html);
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    return '&#39;';
  });
}
