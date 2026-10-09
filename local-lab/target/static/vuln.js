/* local-lab/target/static/vuln.js — حزمة ضعيفة عمدًا (تدريب DOM-XSS).
   خطأ حقيقي من الواقع: hash الصفحة يُحقن في DOM بلا تنقية. */
(function () {
  function render() {
    var data = window.location.hash.slice(1);
    var box = document.getElementById("dom-box");
    if (box) {
      box.innerHTML = "بحثك: " + data;
    }
  }
  window.addEventListener("hashchange", render);
  document.addEventListener("DOMContentLoaded", render);
})();
