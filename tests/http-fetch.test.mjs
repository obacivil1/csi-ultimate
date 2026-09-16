import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { httpFetch, httpFetchDocument } from "../core/http-fetch.mjs";
import { getCircuitBreaker } from "../core/rate-limiter.mjs";

const HOST = "127.0.0.1";
const breaker = getCircuitBreaker();

function startServer(handler) {
  const srv = http.createServer(handler);
  return new Promise((resolve) => {
    srv.listen(0, HOST, () => resolve({ srv, port: srv.address().port }));
  });
}

function urlOf(port, path) { return `http://${HOST}:${port}${path}`; }

const HTML_PAGE = `<!doctype html><html><head><title>ACME Motors - Listings</title>
<meta name="description" content="Used cars in Riyadh">
</head><body>
<h1>Used Cars</h1>
<p>Fresh start 2000 dirham</p>
<p>Contact: seller@acme.test · 05 55 123 456</p>
<a href="/cars/1">Toyota Camry</a>
<a href="https://other.test/x">External</a>
<table><tr><th>Name</th></tr><tr><td>Camry</td></tr></table>
</body></html>`;

test("http-fetch: استخراج وثيقة كاملة من صفحة سيرفر-ريندر", async () => {
  const { srv, port } = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML_PAGE);
  });
  try {
    const out = await httpFetchDocument(urlOf(port, "/listing"), { collect: { images: false } });
    assert.equal(out.ok, true);
    assert.equal(out.source, "http");
    assert.equal(out.doc.title, "ACME Motors - Listings");
    assert.equal(out.doc.chars > 50, true);
    assert.ok(out.doc.headings.includes("Used Cars"));
    assert.equal(out.doc.internalLinks, 1);
    assert.equal(out.doc.externalLinks, 1);
    assert.equal(out.doc.tableRows, 2);
  } finally { srv.close(); }
});

test("http-fetch: تحدّي Cloudflare (200 + just a moment) → حظر hتى HTTP", async () => {
  const { srv, port } = await startServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body>Checking your browser before accessing. Please wait.</body></html>");
  });
  try {
    const out = await httpFetch(urlOf(port, "/"));
    assert.equal(out.ok, false);
    assert.equal(out.blocked, true);
    assert.ok(["cf_challenge", "cf_error", "waf_block"].includes(out.kind));
  } finally { srv.close(); }
});

test("http-fetch: 429 يٌشعّر حجباً ويعود بلا نجاح", async () => {
  const { srv, port } = await startServer((req, res) => {
    res.writeHead(429, { "Content-Type": "text/html" });
    res.end("Too Many Requests");
  });
  try {
    const out = await httpFetch(urlOf(port, "/"));
    assert.equal(out.ok, false);
    assert.equal(out.status, 429);
    assert.equal(out.kind, "http_429");
  } finally { srv.close(); }
});

test("http-fetch: قاطع الدائرة المفتوح يعزله فوراً دون طلب", async () => {
  let hits = 0;
  const { srv, port } = await startServer((req, res) => {
    hits++;
    res.writeHead(200);
    res.end("<html><body>ok</body></html>");
  });
  try {
    const breaker2 = getCircuitBreaker();
    breaker2.onFailure(HOST, "captcha");
    breaker2.onFailure(HOST, "captcha");
    breaker2.onFailure(HOST, "captcha"); // افتح
    assert.equal(breaker2.status(HOST), "open");
    const out = await httpFetch(urlOf(port, "/"));
    assert.equal(out.ok, false);
    assert.equal(out.kind, "breaker_open");
    assert.equal(hits, 0, "لم يصل أي طلب فعلي إلى الخادم");
    breaker2.onSuccess(HOST); // شفاء الحالة للاختبارات اللاحقة
  } finally { srv.close(); }
});

test("http-fetch: httpFetchDocument يُفشل بهدوء عند الحجب (مصدره http)", async () => {
  const { srv, port } = await startServer((req, res) => {
    res.writeHead(403);
    res.end("Access denied");
  });
  try {
    const out = await httpFetchDocument(urlOf(port, "/"));
    assert.equal(out.ok, false);
    assert.equal(out.source, "http");
    assert.equal(out.reason, "http_403");
  } finally { srv.close(); }
});