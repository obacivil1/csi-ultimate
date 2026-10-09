/* local-lab/target/static/app.js — حزمة الواجهة الرئيسية (سند اختبار).
   ضعيفة عمدًا بطريقتين حقيقيتين شائعتين:
     1) مسار إداري مثبّت في النص ثم يُستدعى عند press زر.
     2) مفتاح API مُضمَّن في الحزمة — يُكتشف بتحليل ثابت دون خادم.
   لا شيء هنا يمسّ DOM via innerHTML عدا نص ثابت: analyze_js يجب أن
   يعيد [] لهذا الملف، والضعف المراد في vuln.js وحده. */

(function () {
  "use strict";

  // ── إعداد Melted intentionally ──────────────────────────────
  var API_BASE = "/api/v1";
  var API_KEY = "LABKEY-9f2c4e7a1b3d";   // ← ضعف: مفتاح داخل الحزمة

  var ENDPOINTS = {
    login: API_BASE + "/login",
    profile: API_BASE + "/users/me",
    admin: "/api/admin",                // ← مسار إداري مكشوف في النص
    audit: "/api/admin/audit",
    settings: API_BASE + "/settings"
  };

  function withKey(url) {
    return url + "?api_key=" + encodeURIComponent(API_KEY);
  }

  async function loadProfile() {
    var res = await fetch(withKey(ENDPOINTS.profile), {
      headers: { "X-Client": "web" }
    });
    return res.json();
  }

  async function openAdmin() {
    // نداءات مباشرة بمسار إداري — harvest يستخرجها نصيًا.
    var res = await fetch(withKey(ENDPOINTS.admin));
    if (!res.ok) { return null; }
    return res.json();
  }

  async function openAudit() {
    var res = await fetch(withKey(ENDPOINTS.audit), { method: "GET" });
    return res.ok ? res.json() : null;
  }

  function boot() {
    var btn = document.getElementById("admin-btn");
    if (btn) { btn.addEventListener("click", openAdmin); }
    var out = document.getElementById("profile-box");
    if (out) {
      loadProfile().then(function (u) {
        // كتابة نصية آمنة: textContent لا innerHTML.
        out.textContent = (u && u.name) || "زائر";
      }).catch(function () { out.textContent = "تعذّر التحميل"; });
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
  window.LAB = { ENDPOINTS: ENDPOINTS, openAdmin: openAdmin };
})();