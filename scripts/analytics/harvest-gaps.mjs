/**
 * harvest-gaps.mjs — حصاد الحقول الناقصة عبر مسار HTTP-first (السكة C في الإنتاج)
 * ────────────────────────────────────────────────────────────────────────────
 *  مقاولو muqawil.org يملكون صفحات تفاصيل سيرفر-ريندر تحتوي "جوال/بريد".
 *  البنّاء الجديد يلتقطها بـ fetch خفيف مع كامل كومة الحظر (قاطع الدائرة +
 *  حدّاد المضيف + كشف الحجب المركزي) — دون متصفح بلاي-رايفر بطيء.
 *  الكتابة تتم تزايدياً أثناء العمل: أي انقطاع لا يضيع ما تمّ تحصيله،
 *  ويستأنف الجريان التالي من حيث توقف (يأخذ الناقصين فقط بالترتيب).
 *
 *  المناعة: القيم المُحصّلة تُخزَّن دائماً في gap-harvested.json
 *  ({attempted, phones}) — وهي مصدر الحقيقة؛ أي إعادة استيراد للقاعدة
 *  لا تمسّ الشرح (db-import يعيد تطبيق phones بعد كل استيراد).
 *
 *  التشغيل:
 *    node scripts/analytics/harvest-gaps.mjs --limit 50 --concurrency 4     (جريان جاف)
 *    node scripts/analytics/harvest-gaps.mjs --limit 2000 --write          (تحديث csi.db فعلياً)
 *    node scripts/analytics/harvest-gaps.mjs --limit 2000 --write --force  (إعادة زيارة المسؤولين ولو قد عُرِفوا)
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
const STATE_FILE = path.join(STATE_DIR, "gap-harvested.json");

/** دولة دائمة: attempted (ids مسؤول عنها) + phones (id → قيمة مكتشفة) — مصدر حقيقة الشرح. */
function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (Array.isArray(raw)) {
      const attemptedArr = raw;
      return { attempted: new Set(attemptedArr), phones: {} }; // صيغة قديمة: مخزنة هكذا
    }
    return { attempted: new Set(raw.attempted || []), phones: raw.phones || {} };
  } catch { return { attempted: new Set(), phones: {} }; }
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ attempted: [...state.attempted].sort(), phones: state.phones }, null, 1), "utf8");
}

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const args = process.argv.slice(2);
const limit = Number(argOf("--limit") ?? 10);
const concurrency = Math.min(Number(argOf("--concurrency") ?? 4), 8);
const write = args.includes("--write");
const force = args.includes("--force");

/**
 * يستخرج هاتفاً/بريداً من نص صفحة muqawil التفصيلي — يكمل نص سكربت muqawil-phones
 * لكن عبر نص الوثيقة المنظمة بدل Regex يدوي مسطح.
 */
/** أرقام خدمة عامة/وهمية (920...، رقم مكرر، تسلسلي، أو مصفّرة) — لا تُحتسب. */
function isGenericPhone(phone) {
  if (!phone) return true;
  const c = String(phone).replace(/[^\d]/g, "");
  if (c.length < 6) return true;
  if (/^966?920\d{6}$/.test(c) || /^920\d{6}$/.test(c)) return true; // خدمة عامة
  if (new Set(c).size <= 2) return true;                             // 599999999 / 0111111111
  if (/(.)\1{5,}/.test(c)) return true;                              // 0120000000 (صف أصفار طويل)
  if (c.length >= 8 && c.charCodeAt(c.length - 1) - c.charCodeAt(0) === c.length - 1 && [...c].every((ch, i) => ch === String.fromCharCode(c.charCodeAt(0) + i))) return true; // 0123456789
  return false;
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

async function harvestContractor(db, ids, write, phones) {
  const results = [];
  let newPhone = 0, newEmail = 0, restoredPhone = 0;
  const update = db.prepare("UPDATE contractors SET phone = COALESCE(NULLIF(phone, ''), ?), email = COALESCE(NULLIF(email, ''), ?) WHERE id = ?");
  const queue = [...ids];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const url = `https://muqawil.org/ar/contractors/${id}/143`;
      const r = await httpFetch(url, { timeout: 10000 });
      if (!r.ok || !r.text) { results.push({ id, url, status: r.status, skipped: r.kind || "no_content" }); continue; }
      const { phone, email } = extractFromText(r.text);
      const known = phones[id] && !force;
      const freshPhone = Boolean(phone) && !known;
      const found = freshPhone || Boolean(email);
      results.push({ id, url, status: r.status, phone: phone || "", email, newPhone: freshPhone, restored: Boolean(phone) && known, found });
      if (write && found) {
        update.run(phone || null, email || null, String(id)); // تزايدي: يحفظ فوراً
        if (freshPhone) newPhone++;
        if (Boolean(phone) && known) restoredPhone++;
        if (email) newEmail++;
        process.stdout.write(`✓ ${id} P`);
      } else if (write) {
        process.stdout.write("·");
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { results, newPhone, newEmail, restoredPhone };
}

async function main() {
  const db = new Database(DB_PATH);
  const state = loadState();
  const { attempted, phones } = state;

  const candidates = db.prepare(
    `SELECT id FROM contractors
     WHERE (phone IS NULL OR phone = '')
       AND id IS NOT NULL AND CAST(id AS TEXT) LIKE '200%'
     ORDER BY id ASC`,
  ).all();

  // معتلى إلى الشرح الدائم (قيم معروفة) أو مُجرب من قبل دون قيمة معروفة — يُمرَّر عندما force
  const ids = force
    ? candidates.map((r) => String(r.id)).slice(0, Math.min(limit, 50000))
    : candidates.filter((r) => !attempted.has(String(r.id)) || phones[String(r.id)])
        .map((r) => String(r.id)).slice(0, Math.min(limit, 50000));

  if (!ids.length) { console.log("✗ لا يوجد مقاول ناقص لم يُسأل بعد"); db.close(); return; }

  console.log(`\n📡 حصاد ${ids.length} مقاول عبر HTTP-first (${concurrency} تزامن) ${write ? "(كتابة تزايدية)" : "(جريان جاف)"} ${force ? "— إعادة زيارة قسرية" : ""} — مسؤول عنها ${attempted.size}، قيم محفوظة ${Object.keys(phones).length}\n`);
  const started = Date.now();
  const { results, newPhone, newEmail, restoredPhone } = await harvestContractor(db, ids, write, phones);
  const elapsed = Math.round((Date.now() - started) / 1000);

  for (const r of results) {
    if (r.id !== undefined && r.id !== null) attempted.add(String(r.id));
    if (r.phone) phones[String(r.id)] = r.phone; // القيمة تبقى في المخازن الدائم ولو أُعيد استيراد القاعدة
  }
  saveState(state);

  // نتائج مُطوّقة بزمن حتى لا تُكتب فوق السابقة (تاريخ قابل للتتبع)
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const outFile = path.join(STATE_DIR, `gap-harvest-${stamp}.json`);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), written: write, force, count: results.length, attempted: attempted.size, phonesStored: Object.keys(phones).length, elapsedSec: elapsed, results }, null, 2), "utf8");
  console.log(`\n\n✓ جدد: ${newPhone} هاتف / ${newEmail} بريد (من أصل ${results.length} في ${elapsed}s, ~${((elapsed / results.length) || 0).toFixed(1)}s/سجل)${restoredPhone ? `، أُعيد تطبيق ${restoredPhone} معروفاً` : ""}`);
  console.log(`✓ سجل مكتوب: ${outFile}`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });