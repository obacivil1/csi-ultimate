/* target/static/app2.js — حزمة هدف التعميم (app2 / app2_safe).
   منفصلة عن app.js عمدًا: ذلك سند اختبار للمختبر، ودمجهما يجعل
   تحسين أحدهما يمسح الآخر بصمت. */
(function () {
  "use strict";
  function boot() {
    var el = document.getElementById("js-flag");
    if (el) { el.textContent = "js-on"; }   // textContent: بلا innerHTML
  }
  document.addEventListener("DOMContentLoaded", boot);
})();