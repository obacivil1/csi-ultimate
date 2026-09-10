/**
 * contact-miner.mjs — منقّب جهات تماس
 * يستخرج من نص/روابط أي صفحة: إيميلات، أرقام هواتف، واتساب، وروابط حسابات
 * اجتماعية. افتراضات حذرة حتى لا يلتقط إعلانات/معرفات، وقابل للاختبار حتمياً.
 */
const EMAIL_RX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const EMAIL_BLACKLIST = /example\.com|\.invalid$|@test|sentry|noreply|no-reply|\.png|\.jpg|\.gif|w3\.org|bootstrap|cloudflare|jquery|schema\.org/i;
const PHONE_RX_INTL = /\+\d{1,3}[\s().-]*\d{1,4}[\s().-]*\d{1,4}[\s().-]*\d{2,10}/g;
const PHONE_RX_LOCAL = /\b0\d{9,10}\b/g;
const SUSPICIOUS_DIGITS = /^0+$|^1+$|^2+$|^3+$|^4+$|^5+$|^6+$|^7+$|^8+$|^9+$|123456789|987654321/;

export function mineEmails(text) {
  if (!text || typeof text !== "string") return [];
  const set = new Set();
  for (const m of String(text).matchAll(EMAIL_RX)) {
    const e = m[0].toLowerCase();
    if (EMAIL_BLACKLIST.test(e)) continue;
    if (e.length > 80) continue;
    set.add(e);
  }
  return [...set].slice(0, 25);
}

function cleanPhone(raw) {
  return String(raw || "").replace(/^\+/, "").replace(/[\s().\-/\\]/g, "");
}

function isValidPhoneDigits(d) {
  if (!/^\d{9,15}$/.test(d)) return false;
  if (SUSPICIOUS_DIGITS.test(d)) return false;
  if (/^0+$/.test(d)) return false;
  return true;
}

export function minePhones(text) {
  if (!text || typeof text !== "string") return [];
  const set = new Set();
  const src = String(text);
  for (const rx of [PHONE_RX_INTL, PHONE_RX_LOCAL]) {
    for (const m of src.matchAll(rx)) {
      const cleaned = cleanPhone(m[0]);
      if (!isValidPhoneDigits(cleaned)) continue;
      set.add(cleaned);
      if (set.size >= 15) return [...set];
    }
  }
  return [...set];
}

const WHATSAPP_HOSTS = new Set(["wa.me", "whatsapp.com", "www.whatsapp.com", "api.whatsapp.com"]);
export function mineWhatsapp(links = []) {
  const out = new Set();
  for (const u of links) {
    try {
      const parsed = new URL(u);
      if (!WHATSAPP_HOSTS.has(parsed.hostname)) continue;
      let num = null;
      if (parsed.hostname === "wa.me") num = parsed.pathname.replace(/^\//, "").split("/")[0];
      else {
        const m = parsed.pathname.match(/\/send(\/?\?phone=)?(\d+)/) || u.match(/[?&]phone=(\d+)/);
        num = m ? m[2] || m[1] : null;
      }
      if (num && /^\d{8,15}$/.test(num)) out.add(num);
    } catch { /* صامت */ }
  }
  return [...out].slice(0, 15);
}

const SOCIAL_HOSTS = new Set(["linkedin.com", "www.linkedin.com", "facebook.com", "www.facebook.com", "m.facebook.com",
  "x.com", "twitter.com", "mobile.twitter.com", "instagram.com", "www.instagram.com", "t.me", "telegram.me"]);
export function mineSocial(links = []) {
  const out = [];
  const seen = new Set();
  for (const u of links) {
    try {
      const parsed = new URL(u);
      if (!SOCIAL_HOSTS.has(parsed.hostname)) continue;
      if (/\/sharer\/|\/share\/|\/sharer\.php|login|signup|\/intent\//i.test(parsed.pathname)) continue;
      const canonical = `${parsed.hostname.replace(/^www\.|^m\./, "")}${parsed.pathname.replace(/\/+$/, "")}`;
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      out.push(u);
      if (out.length >= 10) break;
    } catch { /* صامت */ }
  }
  return out;
}

export function mineContacts(text = "", links = []) {
  const linkUrls = (Array.isArray(links) ? links : []).map((l) => (typeof l === "string" ? l : l?.url)).filter(Boolean);
  const emails = mineEmails(text);
  const phones = minePhones(text);
  const whatsapp = mineWhatsapp(linkUrls);
  const social = mineSocial(linkUrls);
  const hasAny = emails.length > 0 || phones.length > 0 || whatsapp.length > 0 || social.length > 0;
  return { emails, phones, whatsapp, social, hasAny };
}