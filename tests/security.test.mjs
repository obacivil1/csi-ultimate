import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { assertPublicUrl, safeFetch, installPlaywrightSsrfGuard } from "../core/ssrf-guard.mjs";
import { isSafeRecordId, loadCrawlRecords } from "../core/validation-engine.mjs";
import { exportAll } from "../core/canonical-extractor.mjs";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("ssrf-guard: يرفض المسارات الداخلية والخاصة", async () => {
  for (const url of [
    "http://127.0.0.1/private",
    "http://127.0.0.1:3000/x",
    "http://localhost/admin",
    "http://0.0.0.0/x",
    "http://10.0.0.1/x",
    "http://172.16.0.5/x",
    "http://192.168.1.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/x",
    "http://[::1]/x",
    "http://[fe80::1]/x",
    "http://metadata.google.internal/computeMetadata/v1/",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "gopher://x",
    "not-a-url",
    "http://",
  ]) {
    await assert.rejects(assertPublicUrl(url), /Blocked|Invalid|Only|DNS/i, `expected ${url} to be rejected`);
  }
});

test("ssrf-guard: يقبل الروابط العامة http/https فقط", async () => {
  const u = await assertPublicUrl("https://www.example.com/path?q=1");
  assert.equal(u.hostname, "www.example.com");
  const u2 = await assertPublicUrl("http://example.com/");
  assert.equal(u2.protocol, "http:");
});

test("ssrf-guard: allowPrivate يتجاوز الفحص (للاختبارات الداخلية)", async () => {
  const u = await assertPublicUrl("http://127.0.0.1:5342/x", { allowPrivate: true });
  assert.equal(u.hostname, "127.0.0.1");
});

test("safeFetch: يرفض نقطة بداية داخلية عند التراجع عن allowPrivate", async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body>ok</body></html>");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  try {
    // بدون allowPrivate: 127.0.0.1 يُحظر قبل حتى إجراء أي اتصال
    await assert.rejects(
      safeFetch(`http://127.0.0.1:${port}/x`),
      /Blocked/i
    );
    // مع allowPrivate: يمر (للاستخدامات الداخلية المصرّح بها)
    const res = await safeFetch(`http://127.0.0.1:${port}/x`, {}, { allowPrivate: true });
    assert.equal(res.status, 200);
  } finally {
    srv.close();
  }
});

test("validation-engine: isSafeRecordId يرفض تجاوز المسارات", () => {
  assert.equal(isSafeRecordId("abc-123_def"), true);
  assert.equal(isSafeRecordId("../../../web/data/users"), false);
  assert.equal(isSafeRecordId("..%2F..%2Fweb"), false);
  assert.equal(isSafeRecordId(""), false);
  assert.equal(isSafeRecordId("a b"), false);
  assert.equal(isSafeRecordId("a\tb"), false);
  assert.equal(isSafeRecordId(null), false);
  assert.equal(isSafeRecordId(undefined), false);
  assert.equal(isSafeRecordId("x".repeat(200)), false);
});

test("validation-engine: loadCrawlRecords بمعرّف خبيث يعيد null", () => {
  const evil = "../web/data/users";
  assert.equal(loadCrawlRecords(evil), null);
  assert.equal(loadCrawlRecords("../../state/sites"), null);
});

test("canonical-extractor: exportAll يعقّم التسمية ويمنع الكتابة خارج مجلد الهدف", () => {
  const dir = mkdtempSync(join(tmpdir(), "csi-canonical-"));
  try {
    const records = [{ site: "gumtree.com", title: "A", url: "http://x.test/a" }];
    const evilLabel = "../../../../evil_file";
    const files = exportAll(records, evilLabel, dir);
    assert.equal(existsSync(files.json), true);
    // بغض النظر عن الاسم، الملفات يجب أن تكون داخل dir
    const dirNorm = dir.replace(/\\/g, "/");
    for (const f of Object.values(files)) {
      assert.equal(f.replace(/\\/g, "/").startsWith(dirNorm), true, `خرج عن المجلد: ${f}`);
    }
    // لا يوجد ملف مسرب خارج المجلد
    assert.equal(existsSync(join(dir, "..", "..", "..", "..", "evil_file.json")), false);
    const parsed = JSON.parse(readFileSync(files.json, "utf8"));
    assert.equal(parsed.total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});