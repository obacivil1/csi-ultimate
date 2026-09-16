/**
 * harvest-gaps.mjs — حصاد الحقول الناقصة عبر مسار HTTP-first (السكة C في الإنتاج)
 * ────────────────────────────────────────────────────────────────────────────
 *  مقاولو muqawil.org يملكون صفحات تفاصيل سيرفر-ريندر تحتوي "جوال/بريد".
 *  البنّاء الجديد يلتقطها بـ fetch خفيف مع كامل كومة الحظر (قاطع الدائرة +
 *  حدّاد المضيف + كشف الحجب المركزي) — دون متصفح بلاي-رايفر بطيء.
 *
 *  التشغيل:
 *    node scripts/analytics/harvest-gaps.mjs --limit 50 --concurrency 4   (جريان جاف: يعرض ما سيتغيير)
 *    node scripts/analytics/harvest-gaps.mjs --limit 50 --write            (تحديث csi.db فعلياً)
 *
 *  ملاحظة: كتابة قاعدة البيانات تحدث فقط عند تمرير --write؛ الافتراضي مخرجات فقط.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { httpFetch } from "../../core/http-fetch.mjs";
import { mineContacts } from "../../core/contact-miner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "..", "..", "data", "csi.db");
const STATE_DIR = path.resolve(__dirname, "..", "..", "state", "analytics");

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const args = process.argv.slice(2);
const limit = Number(argOf("--limit") ?? 10);
const concurrency = Math.min(Number(argOf("--concurrency") ?? 4), 8);
const write = args.includes("--write");

/**
 * يستخرج هاتفاً/بريداً من نص صفحة muqawil التفصيلي — يكمل نص سكربت muqawil-phones
 * لكن عبر نص الوثيقة المنظمة بدل Regex يدوي مسطح.
 */
/** أرقام خدمة عامة تظهر افتراضياً بصفحات muqawil عديمة الهاتف — لا تُحتسب. */
function isGenericPhone(phone) {
  if (!phone) return true;
  const c = String(phone).replace(/[^\d]/g, "");
  return /^966?920\d{6}$/.test(c) || /^920\d{6}$/.test(c);
}

function extractFromText(text) {
  const out = { phone: "", email: "" };
  if (!text) return out;
  const em = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (em) out.email = em[0].toLowerCase();
  // "جوال " يسبق عادةً الرقم في صفحة muqawil
  const pi = text.indexOf("جوال ");
  if (pi > -1) {
    const m = text.substring(pi, pi + 120).match(/(\d[\d\s\-()]{7,16})/);
    if (m && !isGenericPhone(m[1])) out.phone = m[1].trim();
  }
  if (!out.phone) {
    const ph = mineContacts(text, []).phones;
    if (ph && ph.length && !isGenericPhone(ph[0])) out.phone = ph[0];
  }
  return out;
}

async function harvestContractor(db, ids) {
  const results = [];
  const queue = [...ids];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const url = `https://muqawil.org/ar/contractors/${id}/143`;
      const r = await httpFetch(url, { timeout: 10000 });
      if (!r.ok || !r.text) { results.push({ id, url, status: r.status, skipped: r.kind || "no_content" }); continue; }
      const { phone, email } = extractFromText(r.text);
      const found = Boolean(phone) || Boolean(email);
      results.push({ id, url, status: r.status, phone, email, newPhone: Boolean(phone), newEmail: Boolean(email), found });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function main() {
  const db = new Database(DB_PATH);
  const missing = db.prepare(
    `SELECT id FROM contractors
     WHERE ((phone IS NULL OR phone = '') OR (email IS NULL OR email = ''))
       AND id IS NOT NULL AND CAST(id AS TEXT) LIKE '200%'
     ORDER BY id ASC LIMIT ?`,
  ).all(Math.min(limit, 500));

  if (!missing.length) { console.log("✗ لا يوجد مقاول ناقص phone/email"); db.close(); return; }

  console.log(`\n📡 حصاد ${missing.length} مقاول عبر HTTP-first (${concurrency} تزامن) ${write ? "(كتابة)" : "(جريان جاف)"}\n`);
  const results = await harvestContractor(db, missing.map((r) => r.id));

  let newPhone = 0, newEmail = 0;
  for (const r of results) {
    if (r.found) {
      if (r.newPhone) newPhone++;
      if (r.newEmail) newEmail++;
      if (write) {
        db.prepare("UPDATE contractors SET phone = COALESCE(NULLIF(phone, ''), ?), email = COALESCE(NULLIF(email, ''), ?) WHERE id = ?")
          .run(r.phone || null, r.email || null, String(r.id));
      }
      console.log(`  ✓ ${r.id}  phone: ${r.phone || "—"}  email: ${r.email || "—"}  (${r.status})`);
    } else {
      console.log(`  · ${r.id}  ${r.skipped ?? "لا توابع"} (${r.status})`);
    }
  }

  db.close();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const outFile = path.join(STATE_DIR, "gap-harvest.json");
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), written: write, results }, null, 2), "utf8");
  console.log(`\n✓ جدد: ${newPhone} هاتف / ${newEmail} بريد (من أصل ${results.length})`);
  console.log(`✓ سجل مكتوب: ${outFile}`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });