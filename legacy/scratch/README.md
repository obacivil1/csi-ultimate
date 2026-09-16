# أرشيف سكربتات الاستكشاف (R3)

سكربتات مرحلة الاستكشاف السابقة أُرشفت هنا بعيداً عن مسار التنفيذ
حتى لا تلوّث `scripts/` بمناطق بلا أملاك. كلها تُشغَّل يدوياً عند الحاجة فقط.

## فهارس سريعة

| مجموعة | الملفات | الغرض |
|---|---|---|
| **etimad** | `analyze-etimad*.mjs`, `check-etimad*.mjs`, `debug-etimad*.mjs`, `explore-etimad.mjs`, `final_stats.mjs`, `finish-etimad*.mjs`, `intercept-etimad.mjs`, `test-etimad*.mjs` | استكشاف بوابة اعتماد الحكومية |
| **Creative Center (TikTok)** | `cc-*.mjs` | قيادة واجهة Top Ads SPA (بحث/فلاتر/منتجات) |
| **GulfClassifieds** | `gc-*.mjs`, `gulfclassifieds-probe.mjs`, `run-r2-gulfclassifieds.mjs`, `check-extraction.mjs`, `probe-selectors.mjs` | محول R2 والفحص الحي |
| **جهات اتصال** | `contact-*.mjs`, `live-contact.mjs` | فحص استخراج جهات الاتصال حياً |
| **وكلاء/مواقع جديدة** | `new-sites-probe.mjs`, `probe-engines.mjs`, `probe-expat-2d.mjs`, `probe-expat-trace.mjs`, `probe-olx2.mjs`, `bayt-probe.mjs` | تشخيص مواقع محمية/جديدة |
| **أخرى** | `mp*.mjs`, `hawkers-page.mjs`, `check-jobs.mjs`, `hardening-test.mjs`, `test-failure-recovery.mjs`, `test-rss-extraction.mjs`, `test-scheduler*.mjs`, `rx-check.mjs` | تجارب تخصصية متفرقة |

## سياسة
- كل ملف هنا **قيد الأرشفة ولا يُعتمد عليه** إلا بعد امتلاكه وترقيته باختبارات.
- من يُعاد تفعيله ينتقل إلى `scripts/ops/` (أو `core/`) مع اختبار مرافق.