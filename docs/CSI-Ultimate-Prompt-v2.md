# CSI-Ultimate — Project Continuity Prompt
# استخدم هذا البرومت في محادثة جديدة للاستمرار من حيث توقفنا

---

## المشروع: CSI-Ultimate — Ad Crawler

**الهدف:** بناء crawler احترافي متكامل لاستخراج الإعلانات من expatriates.com
**التقدم الحالي:** 25%

---

## الكود الأصلي (نقطة البداية)

الملف الأصلي: `csi-crawler-v4.js`
- يستخدم Playwright-extra + stealth plugin
- يستخرج إعلانات من expatriates.com
- Architecture: 7.5/10 | Extraction: 8.5/10 | Performance: 5/10 | Scalability: 4/10

**نقاط الضعف الأصلية:**
لا Browser Pool، لا Worker Queue، لا Cache، لا Resume، لا Global Deduplication، لا Category Walker، لا Keyword Search

---

## ما تم بناؤه — Stage 2A ✅ (مكتمل 100% — 37/37 اختبار)

### الملفات المنجزة في `./core/`:

### `core/browser-pool.mjs`
- BrowserPool class: pool ثابت من Playwright contexts مع checkout/checkin
- acquire() / release() / withPage(fn) / drain()
- maxUses: إعادة بناء context تلقائياً بعد N استخدام
- acquireTimeout: رمي خطأ إذا كل الـ contexts مشغولة
- createPool(opts): مصنع يُنشئ browser + pool دفعة واحدة
- Stats: busy / free / recycled / errors

### `core/queue.mjs`
- WorkerQueue class: W عمال دائمون يسحبون من طابور حقيقي
- concurrency حقيقي (ليس Promise.allSettled + delay)
- Exponential backoff مع jitter: backoff(attempt, base, cap)
- maxRetries قابل للضبط
- drain(): ينتظر إتمام كل العمل
- pause() / resume()
- onSuccess / onFailure / onProgress callbacks
- stats(): total, done, succeeded, failed, active, queued, percent
- runParallel(items, fn, opts): مساعد سريع بدون إنشاء queue صريح

### `core/cache.mjs`
- Cache class: L1 ذاكرة (LRU بـ Map) + L2 ملف JSON
- TTL لكل إدخال مع purgeExpired()
- autoSave: flush تلقائي كل N عملية set
- saveInterval: flush دوري كل T ms
- Persist: تحميل التشغيل السابق عند البدء (Resume)
- مثيلان جاهزان: adCache (TTL 7 أيام) و pageCache (TTL ساعتان)
- close(): إغلاق نظيف مع flush نهائي

### `core/dedupe.mjs`
- GlobalDeduper class: إزالة تكرار URL + محتوى
- URL dedup: تطبيع كامل (no trailing slash, no query params)
- Content dedup: MD5 hash على (adId + title + phones + emails)
- SimpleBloom: BloomFilter بدون مكتبة خارجية — O(k) للفحص
- isDuplicate(ad, url): يجمع URL + content dedup
- mark(ad, url): يسجل الاثنين معاً
- Persist: يُحفظ بين الجلسات لمنع تكرار الـ runs
- مثيل عالمي جاهز: dedupe

---

## البيئة

- **OS:** Windows 10
- **Runtime:** Node.js (ESM — .mjs)
- **المسار:** `E:\N8N\scraper\scraper2\csi-ultimate\`
- **هيكل المجلدات:**
  ```
  csi-ultimate/
  ├── core/
  │   ├── browser-pool.mjs  ✅
  │   ├── queue.mjs         ✅
  │   ├── cache.mjs         ✅
  │   └── dedupe.mjs        ✅
  ├── state/                (يُنشأ تلقائياً — ملفات الـ cache/dedupe)
  ├── output/               (ملفات Excel المُصدَّرة)
  ├── csi-crawler-v4.js     (الملف الأصلي — لا تعدّله)
  └── test-stage2a.mjs      ✅ (37/37 اختبار)
  ```
- **Dependencies:** playwright-extra, puppeteer-extra-plugin-stealth, xlsx

---

## المرحلة التالية: Stage 2B (التقدم المستهدف: 25% → 40%)

### المطلوب بناؤه:

**١. `core/crawler-core.mjs`** — ملف جديد يضم:
  - `extractAd(pool, url)`: نسخة معدّلة تستخدم `pool.withPage()` بدلاً من `createPage/close` يدوي
  - `processBatch` تُحذف وتُستبدل بـ WorkerQueue
  - منطق Resume: تحقق من `cache.get(url)` قبل الاستخراج — تخطى إذا موجود
  - منطق Dedup: تحقق من `dedupe.isDuplicate(ad, url)` بعد الاستخراج
  - بعد كل استخراج ناجح: `cache.set(url, ad)` + `dedupe.mark(ad, url)`

**٢. تحديث `collectAdLinks()`** في crawler-core:
  - استخدام `pageCache` لتخزين صفحات القوائم
  - تمرير الروابط عبر `dedupe.seenUrl()` لفلترة المعروفة مسبقاً

**٣. تحديث `main()`:**
  - `createPool({ size: 5 })` بدلاً من `chromium.launch()` مباشرة
  - تمرير `pool` لكل الدوالل بدلاً من `browser`
  - `pool.drain()` + `browser.close()` في الـ finally

### قواعد التطوير:
- لا تكسر الـ API الموجودة في v4 (الـ config، الـ output Excel، discoverCategories، promptChoice)
- كل ملف جديد = ESM (.mjs)
- لا تعدّل الملفات في `./core/` الموجودة — فقط استوردها
- بعد الانتهاء: أنشئ `test-stage2b.mjs` باختبارات integration حقيقية

---

## خارطة الطريق الكاملة

```
Stage 1  — Foundation Architecture        ████░░░░░░░░░░░░░░░░  15% ✅
Stage 2A — Core Modules                   █████░░░░░░░░░░░░░░░  25% ✅
Stage 2B — Crawler Core Refactor          ████████░░░░░░░░░░░░  40% ← نحن هنا
Stage 3  — Discovery Engine               ████████████░░░░░░░░  60%
Stage 4  — Extraction Engine              ██████████████░░░░░░  70%
Stage 5  — Intelligence Layer             █████████████████░░░  85%
Stage 6  — Production                     ███████████████████░  95%
Stage 7  — Enterprise                     ████████████████████ 100%
```

---

**ملاحظة:** لا تقفز إلى Stage 3 (Discovery Engine) قبل إتمام Stage 2B واجتياز اختباراته.
