# تحليل حالة سكرابر CSI-Ultimate — مصفوفة تطوير قابلة للتتبع

**تاريخ التحليل:** 2026-09-12
**الإصدار:** v9.0.0 (كود ESM بالكامل)
**الفرع:** main — آخر commit: `22e091b` (contact-miner + Gulf Classifieds)
**الجمهور:** مطوّر / مهندس التطوير
**الهدف:** توفير مرجع تحليلي واحد يسهل منه اتخاذ قرارات التطوير القادمة.

---

## 1. بطاقة النظام في سطر واحد

| البُعد | القيمة | الحكم |
|---|---|---|
| الوحدات | **64 في core/ + 84 في scripts/ + 21 في web/ + 16 app/** | غني لكن متضخم |
| مواقع نشطة | **7** (+1 جديد Gulf Classifieds) | 4 أخرى معطَّلة/محجوبة |
| الاختبارات | **23 ملفاً ≈ 133 حالة، تشغيل أساسي 117/117 ✅ + CI (Node 20/22)** | جيد |
| قاعدة البيانات | **SQLite (better-sqlite3, WAL): 8,303 مناقصة / 13,375 مقاول** | انتقال جزئي من JSON |
| الويب | web/server.mjs **منفذ 3000** (+ /api/v1) — shim 3030 + قديم 3456 | متركز ✅ |
| البيانات على القرص | data/ 57 ملفاً (~54.6MB)؛ output/ 935 ملفاً (~12.4MB) | JSON لا يزال مبعثراً |
| الأمان | تحقق fail-fast من .env + توطين الأسرار ✅ (7 ثغرات web أُصلحت) | جيد |
| **الدرجة الإجمالية** | — | **B+ → A− (بانتظار التركيز المقبل)** |

---

## 2. خارطة القدرة (ماذا يفعل النظام فعلياً اليوم)

```
إدخال (search/keyword/urls)
   │
   ▼
Strategy Engine ── API → RSS → Browser → FlareSolverr
   │
   ▼
Adaptive Rate Limiter + Anti-Detect (بصمة/سلوك/stealth)
   │
   ▼
Discovery → Extraction → Canonical Extract (SA/GCC/UK/PK)
   │
   ▼
Dedupe (URL+hash) → Cache (LRU+ملف)
   │
   ├── بيانات نصية  ──> CSV / XLSX / JSON (ثنائي اللغة)
   ├── مناقصات/مقاولات ──> SQLite (db.mjs)
   └── جهات الاتصال ──> contact-miner (إيميل/هاتف/واتساب/سوشيال)
   │
   ▼
مصنع التقارير (report-factory) → HTML/Deck/CSV/XLSX
   │
   ▼
web (port 3000) API v1 + general /mission /crawl /jobs
```

**ثلاثة أوضاع تشغيل جاهزة:**
1. **الوضع الموجه (site-based):** `core/run.mjs <host> Jobs "<kw>" --uat` — 7 مواقع.
2. **الوضع العام (general):** `POST /api/v1/general/mission` — رحلة «سحب → تصنيف → فلترة → تصدير».
3. **الوضع المستدام (sustainable-agent):** زحف تلقائي بحدود وثقة.

---

## 3. مصفوفة المواقع — الحالة الواحدة (أهم جدول للقرار)

| الموقع | النطاق | الدرجة | الحالة الحالية | المصداقية |
|---|---|---|---|---|
| **Indeed SA** | وظائف | **A+** | إنتاجي (API→RSS→Browser) | ✅ تحقق حي |
| **Saudi Gulf Projects** | مشاريع | **A+** | إنتاجي (RSS يومي) | ✅ |
| **Muqawil.org** | مقاولون | **A** | إنتاجي — **8,136 سجلاً** (كل المناطق) | ✅ |
| **Etimad (مناقصات/جوائز)** | حكومي | **A** | إنتاجي + تحديث آلي (GitHub Actions) | ✅ |
| **Gumtree.co.uk** | كلاسيفايدز | **A−** | إنتاجي — DM قياسي (173 رابطاً/30 ث) | ✅ |
| **Craigslist London** | كلاسيفايدز | **A−** | إنتاجي (23 رابطاً/17 ث) | ✅ |
| **Expatriates.com** | إعلانات GCC | **A−** | إنتاجي | ✅ |
| **Preloved.co.uk** | كلاسيفايدز | **B+** | إنتاجي (42 رابطاً/13 ث) | ✅ |
| **OLX.pk** | كلاسيفايدز | **B+** | **محجوب** (CF Error 1015) | ⚠️ |
| **OpenSooq SA** | كلاسيفايدز | **B+** | **محجوب** (SPA+JS) | ⚠️ |
| **Gulf Classifieds** | عقارات/وظائف | **جديد** | بروب حي 200 + جهات — **غير مُنتج بعد** | 🆕 |
| **Bayt.com** | وظائف | **B** | **معطَّل موثَّق 2026-09-11** (CF 403 "Attention Required!") | ⛔ |
| **LinkedIn** | ملفات | **D** | **محجوب كلياً** (login-wall) | ⛔ |
| **Google Jobs / Bing** | وظائف | B–A− | محلول SERP | ✅ |

> **الخلاصة الاستراتيجية:** التغطية السعودية ممتازة (المناقصات والمقاولات هي جوهر القيمة). الثغرة هي لوحات الوظائف الخليجية (Bayt) وكلاسيفايدز الخليجية (OLX/OpenSooq) — كلها حجب Cloudflare، لا عيوب بنيوية.

---

## 4. مصفوفة النضج المعماري (core/)

| الركيزة | الوحدات | الحالة | تقييم |
|---|---|---|---|
| استخراج رباعي | bridge, extractor, canonical, strategy-engine | موحَّد ✅ | **A** |
| مكافحة الحظر | anti-detect, fingerprint, behavior, flare-solver, stealth | إنتاجي | **A** |
| تحديد معدّل + كشف ban | rate-limiter, resource-controller | تكيّفي متموضع بالثوابت | **A+** |
| بروكسيات | proxy-pool (فحص tcp + دوران + كسر بثقة) | حي عبر /api/proxies + /api/v1 | **A−** |
| البيانات | db (SQLite/WAL), cache, dedupe | انتقال جزئي | **B+** |
| أتمتة الزحف | scheduler, job-manager | طابور per-host | **B+** |
| محركات ذكاء | 12 محركاً (تصنيف صفات/قرار/transfer/knowledge-graph…) | جاهزة لكن قليلة التفعيل | **B** |
| الوضع العام | topic-classifier, general-crawl, general-mission, report-factory | **جديد (9-Sep)** | **B+** |
| جهات الاتصال | contact-miner | **جديد (11-Sep)** | **B+** |
| التوثيق | validation-engine, insight-engine, live-verifier | ضروري قبل إعادة تفعيل أي موقع | **A−** |

---

## 5. نقاط القوة التي يجب البناء عليها

1. **كشف الحظر المبني على المحتوى** (`detectBan`: "just a moment"/"checking your browser") + hyperlink على HTTP 403/429/503 — جدار دفاعي حقيقي.
2. **استراتيجية الرباعية الآمنة** — موقع لا يعمل يتراجع تلقائياً API→RSS→Browser→FlareSolverr.
3. **قياس موثوق بالنماذج**: fixtures واقعية + CI على Node 20/22 — تعديل آمن.
4. **probe حي موثّق**: Bayt 403 بتاريخ، Gulf Classifieds 200 — القرارات مبنية على دليل لا على الحدس.
5. **ثوابت متمركزة** في `config/defaults.json` — ضبط معدل بلا بحث في الكود.
6. **تصدير ثنائي اللغة** + XLSX/CSV/JSON — منتج جاهز للعميل.
7. **بروكسيات ذاتية المواد** (`CSI_PROXY` + rotations) — أساس التوسع.

---

## 6. ديون فنية حرجة (مرتبة بالأثر)

| # | الدين | المكان | الأثر | الجهد المقدر |
|---|---|---|---|---|
| D1 | **JSON لا يزال مصدر النواتج** بينما SQLite مخصّص للمناقصات/المقاولات فقط | output/, state/records | O(n) قراءات، لا نمط استعلام، تضخم 1,000+ ملف | أسبوع |
| D2 | **خادم app/server.mjs قديم (3456) ما زال مدخل START_SCRAPER.bat** مع واجهة تعمل عليه، رغم DESIGNATION DEPRECATED | app/, START_SCRAPER.bat, docs | تشغيل موازٍ/تباين سلوكي | يوم |
| D3 | **84 سكربتاً في scripts/ (37 منها scratch)** — مناطق مؤقتة بلا امتلاك | scripts/scratch, scripts/legacy | صيانة مستحيلة/وقت ضائع | يومان |
| D4 | **التوثيق الداخلي قديم** (Stage 2B/مرحلته 40%) لا يطابق الواقع (عام/contact/DB) | docs/CSI-Ultimate-Prompt-v2.md وغيرها | قرارات خاطئة إذا قُرئ حرفياً | بضع ساعات |
| D5 | **وضع LinkedIn "محجوب" يقتل مسار الذكاء الوظيفي** رغم أنه الوقود الأعلى قيمة | scripts/job-hunter | فجوة مبيعات | أسبوع+ |
| D6 | **FlareSolverr sidecar (localhost:8191) غير مضمّن** في docker-compose | Dockerfile/docker-compose | إعادة تشغيل بيئية تكسر Flare | ساعات |
| D7 | **engine/server.mjs shim (3030)** + old docs 3030/3031 | engine/ | ارتباك محطات | ساعات |
| D8 | **`dedupe.mjs:41` يمسح query params القيّمة في المسار الوراثي** — يُصلح عند توحيد مسارات الديدوب ضمن R1 المرحلة 2 (ADR: `normalizeUrlForHash` في core/db.mjs هو المعيار الجديد عبر C4؛ لا يعتمد C4 الجديد على legacy) | core/dedupe.mjs | تكرار مُحتمل لسجلات search ذات الـ params القيّمة في المسار القديم فقط | ساعات |
| D9 | **`canonical-extractor.mjs` (سطر 339 سابقاً): regex الهاتف يُجري `replace(\s,"")` قبل المطابقة فالتصق أرقام متجاورة (`0501234567 8` → `05012345678`) ويُفقد أرقاماً مُقطّعة بشرطات (`050-123-456-789`) مع سحب `+` الدولي** — يُستهلك فعلياً من مسار تشغيل إنتاجي (`core/run.mjs` exportAll + `web/routes/engine.mjs`) في صافي CSV/XLSX. ✅ **مُصلح بالمطابقة على النص الأصلي ببنوك رقمية مفصولة بفاصل واحد والاحتفاظ بـ `+`** — مُختبَر D9 في `tests/site-extraction.test.mjs` | core/canonical-extractor.mjs | سجلات مفقودة الأرقام — مغلق الآن | مُنفذ ✅ |

---

## 7. مصفوفة فرص التطوير (قرار التالي) — مرتّبة بـ ROI

| # | الفرصة | القيمة | الجهد | المخاطرة | القرار الموصى به |
|---|---|---|---|---|---|
| R1 | **وحّد النواتج على SQLite (+ طبقة query عامة للـ general/report)** | عالٍ جداً | متوسط | منخفض | ✅ ابدأ بها |
| R2 | **فعّل Gulf Classifieds إنتاجياً** (site-config جاهز + جهات تخرج) | عالٍ | يوم | منخفض | ✅ فوري |
| R3 | **أرشفة scratch + تدقيق scripts/** (امتلاك كل أداة) | صيانة | يومان | منخفض | ✅ |
| R4 | **FlareSolverr v2/Turnstile-حل** لإعادة OLX/OpenSooq | عالٍ | أسبوع | متوسط | ⏳ بعد R1 |
| R5 | **إعادة Bayt عبر إستراتيجية بديلة موثقة** (مع cf_cookie / صيد لنمط جديد) | عالٍ | أسبوع+ | متوسط | ⏳ |
| R6 | **إضافة integration بين general-crawl و contact-miner في web/export** (مفردات الجهات في التقرير) | متوسط | يوم | منخفض | ✅ سريع |
| R7 | **لوحة مقاييس حية (site-health عبر متريكس)** على /api/v1/dashboard | متوسط | يومان | منخفض | ⏳ |
| R8 | **N8N orchestrator + lead scoring عبر الجدول الجديد** (تكامل عميل) | عالٍ | أسبوع | متوسط | ⏳ |

---

## 8. مقياس «الصحة» سريع للتشغيل

```bash
npm test                     # الاختبارات الأساسية (المتوقع 117/117)
node --check run.mjs         # فحص صياغي (script lint)
curl http://localhost:3000/api/health
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/general/jobs   # قائمة مهام الوضع العام
curl http://localhost:3000/api/proxies           # صحة البروكسيات (فقط إن شغّلتها)
```

---

## 9. مخطط القرار (من أين تبدأ بناءً على الهدف)

```
هدفك توسيع المواقع (أكثر بيانات)؟
   ▼
R1 (SQLite) ثم R4/R5 (FlareSolverr v2 + Bayt) ثم نعم R2

هدفك منتج جاهز للعميل (تقارير/جهات)؟
   ▼
R2 + R6 (جهات في التقرير) ثم R8 (N8N) — أسرع عائد

هدفك هندسة نظيفة / صيانة؟
   ▼
R3 (أرشفة) + D2 (إيقاف خادم 3456) + تحديث docs

هدفك قياس/مراقبة؟
   ▼
R7 (متريكس حية) + استخدام التوثيق live-verifier لكل موقع
```

---

## 10. توصية نهائية (المقبلة القصيرة: 7 أيام)

1. **R1:** جدول `documents` واحدا في SQLite + import لل general-crawl فيرَيتها للمنشور و contact-miner. *(رافعة كل شيء)*
2. **R2+R6:** تحويل Gulf Classifieds إلى وضع إنتاج + ظهور أعمدة الجهات في تصدير general.
3. **R3:** أرشفة `scripts/scratch` المنتهية؛ امتلاك كل ملف `scripts/` متبقٍ.
4. **تحديث docs:** تصحيح "prompt-v2" وغلق مراجع 3456/3030 لصالح 3000.
5. **إعادة فحص حي** لـ Bayt/OLX/OpenSooq بعد أسبوع من اليوم — بروتوكول جديد موثق = إعادة تفعيل.

> بعد هذه الرزمة يكون النظام عند حد **A− → A** و"جاهز لتوسيع المواقع" بدلاً من "إصلاح السخام".

---

## 11. R1 — حالة التنفيذ (محدث 2026-09-12)

### 11.1 منجز (R1.1) — طبقة البيانات الموحدة
| المكوّن | الملف | ما تم |
|---|---|---|
| جدول `documents` | `core/db.mjs` | SQL Schema نهائي (doc_type/url_hash/raw_json/canonical_json/contacts_json/topic/run_id…) + فهارس `source,doc_type` و`run_id` |
| الهاش | `core/db.mjs` | `normalizeUrlForHash` قبل sha256: يزيل fragment/www./trailing-slash + معلمات متغيرة (`utm_*`, `fbclid`, `gclid`, `sid`…) ويرتّب الباقية — **الديدوب لن ينكسر صمتاً** |
| الخرّاط | `core/db.mjs` | `toDocumentRow(doc, opts)` — form الوثيقة الخام/canonical/contacts إلى صف |
| الكتابة الوحيدة | `core/db.mjs` | `upsertDocuments(rows)` — transaction واحد، ديدوب عبر url_hash |
| القراءة | `core/db.mjs` | `queryDocuments` + `countDocuments` + فلتر `missingContacts` (null/''/'{}'), تفسير JSON تلقائي عند القراءة |
| الدمج في المهمة | `core/general-mission.mjs` | `runMission` يكتب CG batch عند `persist:true`؛ `run_id` يُحقن من المتصل (fallback تلقائي)؛ `doc_type` متدرج siteProfile→docType→suggestedType→document؛ `canonical` = flattenDocs مسبقاً؛ `dbPath` حقن اختباري |
| نمط الإثراء | `core/contact-miner.mjs` | `runContactMine({run_id, dbPath, persist, filter, force})` — يقرأ rows ناقصة contacts، يتجاهل بأمان `raw_json` بلا نص كافٍ (يُشعَر عنه في `skipped_no_text`)، يعيد كتابة دفعة واحدة |

### 11.2 قرارات قيد الجلسة (موثقة هنا للرجوع)
- **enrichment لا fresh-crawl**: `runContactMine` يُثري المخزون القائم ولا يستقبل urls — أي صفحة جديدة تدخل عبر general-mission وتأتي contacts من `parseHtmlDocument` لحظة الاقتناص (chlor 109).
- **persist صريح**: افتراض الإنتاج `true`، وكل استدعاء اختبار يمرر `persist:false` صراحة — لا افتراضات ضمنية تُنسى (مبدأ "الرصد قبل التفاعل").
- **ربط لا نسخ** (R1.2): قرار معتمد، انظر ADR أدناه.

### 11.3 نتائج تحقق (قياسية لا تخمين)
- مجموعة الاختبارات الكاملة: **131/131 ✅** (منها 5 جديدة لـ `contact-miner-db` + 7 لـ hash/dedup من جلسة R1.1).
- `queryDocuments` يقرأ `raw_json`/`canonical_json`/`contacts_json` objects جاهزة — ولم يعد هناك `JSON.parse` يدوي عند المستهلك.
- محاكاة واقعية على عيّنة: `runContactMine` أثرى `{emails:1, phones:1, whatsapp:1}` من raw واحد بلا بيانات قديمة — و `persist:false` (dry-run) لا يكتب شيئاً.

### 11.4 دَين منجَل مكتشف خلال R1.1 (مهم للرجوع)
- **`dedupe.mjs:41` يمسح كل query params** في المسار الوراثي القديم — سُجّل كـ **D8** (§6) مع ADR مصغر: لا يعتمد عليه C4 الجديد؛ يُصلح عند توحيد مسارات الديدوب.
- **`parseHtmlDocument` يختم contacts فورياً** عند الاقتناص — دور `runContactMine` الإثرائي مخصص للتغطية القديمة/القسرية (force)، لا للتشغيل اليومي.

### 11.5 مفتوح (R1.2) — قرار الربط — **مغلق (مؤجل التمرير العادي)**
قرار استشاري اعتمد: **ربط (Link) لا ترحيل (Migrate)** للجداول القديمة (`tenders`/`contractors`) تجاه `documents` — التفاصيل والسبب في ADR-002 أدناه.
- **مُنفَّذ:** عمود `document_id INTEGER NULL` أُضيف إلى `tenders`/`contractors`/`awards`/`projects` عبر ALTER آمن (محمي بـ `PRAGMA table_info` في `migrate()`)، ويتحقق منه — `importMany`/`query`/`count` تعمل دون أثر، والعمود يبقى NULL للمسار الوراثي.
- **مؤجّل عمداً (حتى وجود دليل):** تمرير `document_id` عند نقطة كتابة التخصصات الحالية — لا نقطة كتابة موحدة اليوم، والتسلسل المنطقي أن يُمرَّر أول منتج جديد يكتب تخصصاً (لا افتراض).

---

## 12. ADR-002 — ربط لا نسخ (R1.2) — 2026-09-12

**الحالة:** معتمد

**القرار:** الإبقاء على الجداول القديمة `tenders`/`contractors`/`awards`/`projects` كموارد مستقلة، وإضافة عمود `document_id INTEGER NULL` عليها يربط كل صف بمعرّف نظيره في `documents` (عندما يوجد نظير). لا تنفيذ ترحيل جماعي (نسخ) للصفوف إلى `documents`، ولا إيقاف للجداول القديمة في هذه المرحلة.

**السياق:** النظام اليوم يخزن 21,678 صفاً موزعة على `tenders`/`contractors` (و`awards`/`projects`)، جميعها تشتغل بلا شكوى موثقة وتُستهلك من routes/API قائمة. `documents` الجديد هو مصدر الحقيقة للمسار العام/contact (R1.1). كانت المعضلة: هل تُدمج البيانات التاريخية **فيزيائياً** داخل `documents` (توحيد حرفي) أم تُربط **منطقياً** عبر FK؟

**السبب:**
1. **أرخص وأقل مخاطرة:** نسخ 21,678 صفاً يعرّض نظاماً عاملاً لاحتمال تعطّل مؤقت دون عائد مباشر ملموس؛ بينما الربط لا يمسّ أي صف قائم.
2. **لا تلمس مساراً يعمل بلا ضرورة مباشرة** (نفس مبدأ تطبيق D8 على `dedupe.mjs:41`) — الجداول القديمة تعمل الآن وتُستهلك جيداً؛ كسر استقرارها مقابل "توحيد" تجميلي ليس له مستهلك ملموس.
3. **كل استهلاك مستقبلي (تقارير/لوحة صحة) يقدر يقرأ عبر JOIN على document_id** — الربط يحقق من قراءته "وحدة منطقية" بلا استنساخ فعلي.
4. **قابل للتوسع نحو الترحيل عند الحاجة:** إن ظهرت لاحقاً مشاكل بنية فعليّة في الجداول القديمة (دليل، لا افتراض)، قرار الترحيل يمكن اتخاذه وقتها بنفس المنطق ودون إلغاء الربط الحالي.

**النتائج:** ربط تعامدي (cross-linking) عبر `document_id`؛ تماسك القراءة؛ لا مخاطرة على البيانات القائمة؛ مسار ترقية صريح (مؤجل حتى وجود دليل).

**الآثار المترتبة:** تعديل بسيط في نقطة كتابة التخصصات الحالية لتمرير `document_id` عند التوفر (إن لم توجد point كتابة موحدة، تُضاف للواحدة القائمة)؛ لا تغيير في schema القراءة القديمة؛ توثيق العلاقة في قسم الجداول.

---

## 13. ADR-001 — التطبيع قبل الهاش (url_hash) — 2026-09-12

**الحالة:** معتمد (منفّذ ضمن ADR العملي أعلاه)

**القرار:** `hashUrl(url)` لم يعد sha256 للرابط الخام؛ بل يُمرَّر أولاً عبر `normalizeUrlForHash(url)` الذي يزيل fragment و`www.`، يوحّد الدومين lowercase وtrailing slash، يحذف معلمات التتبع والجلسة المتغيرة (`utm_*`, `fbclid`, `gclid`, `msclkid`, `igshid`, `sid`, `session`, `_ga`, `_gl`, `mc_cid`…)، ويرتّب المعلمات الباقية أبجدياً.

**السبب:** ديدوب `documents` يعتمد `url_hash UNIQUE` — أي رابط متغير الشكل (params جلسة/ترتيب search زائداً علامة تتبع) كان سيتكاثر كصفوف مكررة بصمت، فينهار الـ dedup الأساسي للجدول من لحظة أول تشغيل. `dedupe.mjs` الوراثي كان يمسح **كل** params (تفريط في إلغاء مفيد search) — التطبيع الجديد يزيل المتغير فقط.

**بالأثر:** متغيرات `https://site.com/item/42?utm_source=f&fbclid=x` / `H TTP+www` / `42#reviews` / `?sid=abc` تتجمع في هوية واحدة (اختبار مثبت بـ 4 متغيرات). رابط tree مختلف فعلاً يبقى مختلفاً.

**الكمملات:** اختبارات `tests/documents-db.test.mjs` تغطي 4 انهيارات + فصل params قيّمة + تمييز روابط مختلفة.

---

## 14. R2 — Gulf Classifieds (gulfclassifieds.org) — حالة التنفيذ — **مُغلق (منتج) 2026-09-13**

### 14.1 ما تحقق
- adapter مخصص كامل موجود منذ الاستطلاع: `config/sites/gulfclassifieds.org.json` (language en، search GET `/search/` param `keyword`، extraction GCC + selectors title/desc/phone/email/location/price/company، adIdPattern `/item/[^/]+-(\d+)\.html$`، excludeUrlPatterns).
- **تشغيل إنتاجي حي** (`runMission` على `https://gulfclassifieds.org/`، `fetch` وضع 1): `persisted.inserted = 10` وثائق `doc_type=classified` في جدول `documents` (same C4 قناة R1) — لا استطلاع تجريبي بعد الآن.
- توزيع الأصناف الحيّ (classifier): real_estate 4 / jobs 3 / tech 2 / automotive 1؛ الحصاد: 71,514 حرفاً، 568 رابطاً، 333 صورةً، 194 صف جدول.
- **جهات اتصال حقيقية مستخرَجة**: إعلان townhouse (`971542337500` / `marketing@empireinfratech.com`)، صفحات Services (6 هواتف + 2 إيميلات)، Property (2+2) — contacts_json فعلي وليس خاملاً.
- canned JSON فحص يدوي (4 عيّنات): العناوين مقروءة، الأوصاف مهيكلة (تاونهاوس: Rooms/مساحة/موقغ)، الوحيد الغائب حقل `price` المهيكل — لا يعيق نموذج الوثيقة الموحّد ولا تقريراً حقيقياً (تفويض R2.1 أدناه).

### 14.2 الحقائق المسجلة خلال R2 (لذكاء التشغيل)
- `runMission` يزحف عاماً (general-crawl `parseHtmlDocument`) ولا يقرأ selectors الخاص بـ adapter — **بوصفه آلية، لا عيب مقاس**: لا يوجد دليل أن الاستخراج العام ناقص لحاجة تقرير فعلي (انظر §14.3 المعيار). «لا يقرأ selectors» وصفُ آليةٍ لا وصفُ عيبِ نتيجة.
- الصفحتان `/admin/` و`/post/item/0/0/` التُقطتا في الزحف الأول — أُضيف `/admin/` إلى `excludeUrlPatterns` في adapter (impress لاحق؛ `/post/` كان موجوداً سلفاً).

### 14.3 R2.1 — بند مؤجل بمعيار (Trigger)، لا بموعد
**"ربط siteProfile بـ adapter selectors (قراءة selectors الخاصة للاستخراج الدقيق)" — يُنفَّذ فقط إذا تحقق أحد الشرطين:**
- **(أ) دليل عيب مقاس:** فحص عيّنة من canonical_json الفعلي يُظهر حقولاً ناقصة/غير دقيقة تمنع تقريراً حقيقياً (سعر مهيكل، عنوان مهيكل) — اليوم شُحصت 4 عيّنات ولم يظهر مانع.
- **(ب) طلب عميل:** مستهلك فعلي يطلب حقولاً مهيكلة محددة لا يوفرها general (مثل field price منفصل لإعلانات) — حتى الآن لا مستهلك.
- **العلة (لماذا لا يُنفَّذ الآن):** لا دليل أن الجهد يُنتج قيمة تتناسب مع المتغير (مبدأ القيمة/الجهد الثابت منذ R1 على ADR-002 «ربط لا نسخ»). لا تُبنى تحسينات بديهية بلا دليل قياس مباشر يبررها.