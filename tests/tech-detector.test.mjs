import test from "node:test";
import assert from "node:assert/strict";
import { detectTechnologies, analyzeSecurityHeaders, TECH_SIGNATURES, SECURITY_HEADERS } from "../core/tech-detector.mjs";

test("tech-detector: يكشف WordPress من HTML", () => {
  const res = detectTechnologies({
    html: '<script src="/wp-content/themes/x/js/main.js"></script><link rel="stylesheet" href="/wp-includes/css/x.css">',
  });
  assert.ok(res.some((t) => t.tech === "WordPress"));
});

test("tech-detector: يكشف Cloudflare من الرؤوس", () => {
  const res = detectTechnologies({
    headers: { "cf-ray": "abc123", "server": "cloudflare" },
    html: "",
  });
  assert.ok(res.some((t) => t.tech === "Cloudflare"));
});

test("tech-detector: HTML بلا بصمات يعيد قائمة فارغة", () => {
  const res = detectTechnologies({ html: "<html><body><p>مرحبا</p></body></html>" });
  assert.deepEqual(res, []);
});

test("tech-detector: يقبل raw headers string", () => {
  const res = detectTechnologies({
    headers: "HTTP/1.1 200 OK\r\nServer: nginx\r\nX-Powered-By: PHP/8.1",
    html: "",
  });
  assert.ok(res.some((t) => t.tech === "Nginx"));
  assert.ok(res.some((t) => t.tech === "PHP"));
});

test("tech-detector: فحص الرؤوس الأمنية — كامل/ناقص/فارغ", () => {
  const full = analyzeSecurityHeaders({
    "Strict-Transport-Security": "max-age=31536000",
    "Content-Security-Policy": "default-src 'self'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=()",
  });
  assert.equal(full.score, 100);
  assert.equal(full.missing.length, 0);

  const none = analyzeSecurityHeaders({});
  assert.equal(none.score, 0);
  assert.equal(none.missing.length, SECURITY_HEADERS.length);

  const partial = analyzeSecurityHeaders({ "X-Frame-Options": "DENY" });
  assert.equal(partial.present.length, 1);
  assert.equal(partial.score, Math.round((1 / SECURITY_HEADERS.length) * 100));
});

test("tech-detector: قائمة البصمات معرَّفة وغير فارغة", () => {
  assert.ok(TECH_SIGNATURES.length > 15);
  assert.ok(SECURITY_HEADERS.length >= 6);
  assert.ok(SECURITY_HEADERS.includes("Content-Security-Policy"));
});