/**
 * harvest-emails.mjs — حصاد بريد المقاولين من مواقعهم (الخيار 2 المتفق؛ muqawil لا ينشر بريداً)
 * ──────────────────────────────────────────────────────────────────────────────────────────
 *  المقاولون الذين يملكون نطاقاً (url) تُجلب مواقعهم عبر مسار HTTP-first — الصفحة
 *  الرئيسية + صفحة الاتصال — ويُستخرج بريدهم بـ mineEmails مع قائمة منع للضوضاء
 *  (example.com، noreply@، خدمات الطرف الثالث) وكتابة تزايدية مماثلة لحصّاد الهواتف.
 *
 *  التشغيل:
 *    node scripts/analytics/harvest-emails.mjs --limit 20           (جريان جاف)
 *    node scripts/analytics/harvest-emails.mjs --limit 200 --write  (تحديث csi.db)
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { httpFetch } from "../../core/http-fetch.mjs";
import { mineEmails } from "../../core/contact-miner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "..", "..", "data", "csi.db");
const STATE_DIR = path.resolve(__dirname, "..", "..", "state", "analytics");

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const args = process.argv.slice(2);
const limit = Number(argOf("--limit") ?? 10);
const write = args.includes("--write");

// بريد ضجيج/نوكالوري من أطراف ثالثة أو عناوين تجريبية
const NOISE_DOMAINS = /(example\.com|domain\.com|sentry\.io|wixpress\.com|schema\.org|jquery\.com|gravatar\.com|typekit\.|w3\.org|googleapis\.com|gstatic\.com|hotjar\.com|mixpanel\.com|zendesk\.com|intercom\.io|cart\.com|myshopify\.com|webflow\.io|squarespace\.com)/i;
const NOISE_LOCAL = /(noreply|no-reply|donotreply|do-not-reply|support\+|example|test)(\b|[0-9@])/i;
const OK_TLD = /\.[a-z]{2,}$/i;

function cleanEmails(text) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const raw of mineEmails(text)) {
    const e = raw.trim().toLowerCase().replace(/^(mailto:|mail:)/i, "").split(/[;,|]/)[0];
    if (!e || e.length > 80 || e.includes("..")) continue;
    if (NOISE_DOMAINS.test(e) || NOISE_LOCAL.test(e)) continue;
    if (!OK_TLD.test(e)) continue;
    if (!e.includes("@") || e.split("@")[1].split(".").length < 2) continue;
    if (!seen.has(e)) { seen.add(e); out.push(e); }
  }
  return out;
}

async function main() {
  const db = new Database(DB_PATH);
  const rows = db.prepare(
    `SELECT id, name, email, url FROM contractors
     WHERE url IS NOT NULL AND url <> '' AND (email IS NULL OR email = '')
     ORDER BY id ASC LIMIT ?`,
  ).all(Math.min(limit, 5000));

  if (!rows.length) { console.log("✗ لا يوجد مقاول بنطاق ونقيس بريده"); db.close(); return; }
  if (!write) console.log(`\n📡 جريان جاف: ${rows.length} مقاول بنطاق (بدون كتابة)\n`);
  else console.log(`\n📡 حصاد بريد ${rows.length} موقعاً (HTTP-first) — كتابة تزايدية\n`);

  let found = 0;
  const out = [];
  const update = db.prepare("UPDATE contractors SET email = ? WHERE id = ?");
  const started = Date.now();

  for (const c of rows) {
    let domain = c.url;
    try { const u = new URL(domain); domain = u.hostname; } catch { domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, ""); }
    const base = `https://${domain}`;
    const candidates = [base, `${base}/contact`, `${base}/contact-us`, `${base}/about`, `${base}/ar`];
    let emails = [];
    for (const u of candidates) {
      const r = await httpFetch(u, { timeout: 9000 });
      if (r.ok && r.text) {
        emails = cleanEmails(r.text);
        if (emails.length) { break; }
      }
    }
    if (emails.length) {
      const email = emails[0];
      found++;
      if (write) update.run(email, String(c.id));
      out.push({ id: c.id, domain, email });
      console.log(`  ✓ ${c.id} (${domain}) → ${email}${emails.length > 1 ? ` +${emails.length - 1}` : ""}`);
    } else {
      out.push({ id: c.id, domain, email: "" });
    }
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  db.close();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, "email-harvest.json");
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), written: write, count: rows.length, found, elapsedSec: elapsed, results: out }, null, 2), "utf8");
  console.log(`\n✓ بريد جدد: ${found} من ${rows.length} في ${elapsed}s`);
  console.log(`✓ سجل مكتوب: ${file}`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });