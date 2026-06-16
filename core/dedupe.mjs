/**
 * ============================================================
 *  CSI-Ultimate — GlobalDeduper
 *  إزالة التكرار العالمي: URL + محتوى + هاش سريع
 *  Stage 2A — core/dedupe.mjs
 * ============================================================
 *
 *  لماذا؟
 *  -------
 *  v4 يجمع روابط per-category فقط. عند تشغيل فئات متعددة
 *  (أو إعادة التشغيل)، نفس الإعلان يُستخرج مرات.
 *
 *  الميزات:
 *  ---------
 *  ① URL dedup      : Set بسيط على الـ URL الطبيعي.
 *  ② Content dedup  : هاش سريع على (adId + title + phone).
 *  ③ BloomFilter    : هيكل احتمالي للـ URLs الجديدة (false-positive مقبول).
 *  ④ Persist        : يُحفظ كل seen إلى ملف JSON للـ resume.
 *
 *  القاعدة الذهبية:
 *  - seenUrl(url)     : هل رأينا هذا الـ URL من قبل؟
 *  - markUrl(url)     : سجّله كمرئي.
 *  - seenContent(ad)  : هل رأينا هذا المحتوى (بغض النظر عن URL)؟
 *  - markContent(ad)  : سجّله.
 *  - isDuplicate(ad, url): الجمع بين الاثنين.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve }                                    from "path";
import { createHash }                                          from "crypto";

// ── هاش سريع (xxhash-like بـ crypto MD5 مقطوع) ───────────────
function quickHash(...parts) {
  return createHash("md5")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 16);
}

// ── تطبيع URL ─────────────────────────────────────────────────
function normalizeUrl(url = "") {
  try {
    const u = new URL(url);
    u.search   = "";      // أزل query params
    u.hash     = "";      // أزل fragment
    return u.href.toLowerCase().replace(/\/$/, "");
  } catch {
    return url.toLowerCase().trim();
  }
}

// ── هاش المحتوى ──────────────────────────────────────────────
function contentHash(ad) {
  return quickHash(
    ad.adId,
    (ad.title  || "").slice(0, 60).toLowerCase(),
    (ad.phones || "").replace(/\s/g, ""),
    (ad.emails || "").toLowerCase(),
  );
}

// ============================================================
//  BloomFilter بسيط (بدون مكتبة خارجية)
//  false-positive rate ~1% عند m=10^6 bit, k=7
// ============================================================

class SimpleBloom {
  constructor(size = 1_000_000, hashes = 7) {
    this._size   = size;
    this._hashes = hashes;
    this._bits   = new Uint8Array(Math.ceil(size / 8));
  }

  _positions(key) {
    const h1 = parseInt(createHash("md5").update(key).digest("hex").slice(0, 8), 16);
    const h2 = parseInt(createHash("sha1").update(key).digest("hex").slice(0, 8), 16);
    const pos = [];
    for (let i = 0; i < this._hashes; i++) {
      pos.push(Math.abs((h1 + i * h2) % this._size));
    }
    return pos;
  }

  add(key) {
    for (const p of this._positions(key)) {
      this._bits[p >> 3] |= 1 << (p & 7);
    }
  }

  test(key) {
    return this._positions(key).every(p => this._bits[p >> 3] & (1 << (p & 7)));
  }
}

// ============================================================
//  GlobalDeduper
// ============================================================

export class GlobalDeduper {
  /**
   * @param {object} opts
   * @param {string}  [opts.path]        - ملف الـ state (./state/dedupe.json)
   * @param {number}  [opts.bloomSize]   - حجم BloomFilter bits (1_000_000)
   * @param {number}  [opts.autoSave]    - احفظ كل N mark (100)
   */
  constructor(opts = {}) {
    this._path     = resolve(opts.path     ?? "./state/dedupe.json");
    this._bloomSz  = opts.bloomSize        ?? 1_000_000;
    this._autoSave = opts.autoSave         ?? 100;

    this._urlSet     = new Set();    // URL الطبيعي
    this._contentSet = new Set();    // هاش المحتوى
    this._bloom      = new SimpleBloom(this._bloomSz); // فحص سريع
    this._dirty      = 0;

    this._stats = { urlHits: 0, contentHits: 0, bloomFP: 0, newItems: 0 };

    this._load();
  }

  // ── هل رأينا هذا الـ URL؟ ─────────────────────────────────────
  seenUrl(url) {
    const n = normalizeUrl(url);
    if (!this._bloom.test(n)) return false;     // bloom miss → confirmed new
    return this._urlSet.has(n);
  }

  // ── سجّل URL ──────────────────────────────────────────────────
  markUrl(url) {
    const n = normalizeUrl(url);
    if (this._urlSet.has(n)) return false;      // موجود بالفعل
    this._urlSet.add(n);
    this._bloom.add(n);
    this._dirty++;
    this._maybeSave();
    return true;
  }

  // ── هل رأينا هذا المحتوى؟ ────────────────────────────────────
  seenContent(ad) {
    return this._contentSet.has(contentHash(ad));
  }

  // ── سجّل محتوى ───────────────────────────────────────────────
  markContent(ad) {
    const h = contentHash(ad);
    if (this._contentSet.has(h)) return false;
    this._contentSet.add(h);
    this._dirty++;
    this._maybeSave();
    return true;
  }

  // ── الجمع: هل هو مكرر؟ (URL أو محتوى) ───────────────────────
  /**
   * @param {object} ad  - نتيجة extractAd()
   * @param {string} url
   * @returns {{ duplicate: boolean, reason?: string }}
   */
  isDuplicate(ad, url) {
    if (this.seenUrl(url)) {
      this._stats.urlHits++;
      return { duplicate: true, reason: "url" };
    }
    if (this.seenContent(ad)) {
      this._stats.contentHits++;
      return { duplicate: true, reason: "content" };
    }
    return { duplicate: false };
  }

  // ── سجّل كلاهما بعد التحقق ───────────────────────────────────
  mark(ad, url) {
    this.markUrl(url);
    this.markContent(ad);
    this._stats.newItems++;
  }

  // ── إحصاءات ───────────────────────────────────────────────────
  stats() {
    return {
      ...this._stats,
      urlsSeen:     this._urlSet.size,
      contentsSeen: this._contentSet.size,
    };
  }

  // ── حذف URL محدد (تراجع) ──────────────────────────────────────
  forgetUrl(url) {
    const n = normalizeUrl(url);
    this._urlSet.delete(n);
    // لا يمكن إزالة من Bloom — مقبول
  }

  // ── إعادة التهيئة الكاملة ────────────────────────────────────
  reset() {
    this._urlSet.clear();
    this._contentSet.clear();
    this._bloom = new SimpleBloom(this._bloomSz);
    this._dirty++;
    this.flush();
  }

  // ── حفظ إلى الديسك ────────────────────────────────────────────
  flush() {
    try {
      mkdirSync(dirname(this._path), { recursive: true });
      const data = {
        urls:     [...this._urlSet],
        contents: [...this._contentSet],
        savedAt:  new Date().toISOString(),
      };
      writeFileSync(this._path, JSON.stringify(data), "utf8");
      this._dirty = 0;
    } catch (err) {
      console.error("[Dedupe] ❌ فشل الحفظ:", err.message);
    }
  }

  close() { this.flush(); }

  // ──────────────────────────────────────────────────────────────
  //  خاص
  // ──────────────────────────────────────────────────────────────

  _load() {
    if (!existsSync(this._path)) return;
    try {
      const data = JSON.parse(readFileSync(this._path, "utf8"));
      for (const u of (data.urls     || [])) { this._urlSet.add(u);     this._bloom.add(u); }
      for (const c of (data.contents || [])) this._contentSet.add(c);
      console.log(
        `[Dedupe] 📂 تحميل — URLs: ${this._urlSet.size}, محتوى: ${this._contentSet.size}`
      );
    } catch (err) {
      console.warn("[Dedupe] ⚠️  فشل تحميل ملف dedupe:", err.message);
    }
  }

  _maybeSave() {
    if (this._dirty >= this._autoSave) this.flush();
  }
}

// ── مثيل عالمي واحد ───────────────────────────────────────────
export const dedupe = new GlobalDeduper();

process.on("exit", () => dedupe.close());
