import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import * as pool from "../core/proxy-pool.mjs";
import { tcpProbe, parseProxyEndpoint, httpConnectProbe, socks5Probe, protocolProbe } from "../core/proxy-pool.mjs";

function reset() { pool.resetPool(); }

test("بركة فارغة تعيد null للاختيار", () => {
  reset();
  assert.equal(pool.getProxy("x.com"), null);
  assert.equal(pool.healthyCount(), 0);
});

test("تسجيل قائمة من نص والتناوب على السليمة فقط", () => {
  reset();
  pool.addProxies(["http://p1.test:8080", "http://p2.test:8080", "socks5://p3.test:1080"]);
  const seen = new Set();
  for (let i = 0; i < 6; i++) seen.add(pool.getProxy("host"));
  assert.equal(seen.size, 3);
  assert.ok(seen.has("http://p1.test:8080"));
  assert.equal(pool.healthyCount(), 3);
});

test("حدّ الكسر بعد 3 فشل متتالٍ يستبعد البروكسي", () => {
  reset();
  pool.addProxies(["http://bad.test:1", "http://good.test:1"]);
  for (let i = 0; i < 3; i++) pool.reportResult("http://bad.test:1", false);
  assert.equal(pool.listProxies().find((p) => p.url === "http://bad.test:1").ok, false);
  const out = new Set();
  for (let i = 0; i < 4; i++) out.add(pool.getProxy("host"));
  assert.ok(!out.has("http://bad.test:1"), "رجاءً لا تختار الوكيل المكسور");
});

test("نجاح واحد يشفّي البروكسي بعد الكسر", () => {
  reset();
  pool.addProxies(["http://r.test:1"]);
  pool.reportResult("http://r.test:1", false);
  pool.reportResult("http://r.test:1", false);
  assert.equal(pool.listProxies()[0].ok, true, "فشلان فقط تحت الحد");
  for (let i = 0; i < 3; i++) pool.reportResult("http://r.test:1", false);
  assert.equal(pool.listProxies()[0].ok, false);
  pool.reportResult("http://r.test:1", true);
  assert.equal(pool.listProxies()[0].ok, true);
  assert.equal(pool.listProxies()[0].consecutiveFailures, 0);
});

test("فحص صحة بالمختبِر المحقون يميّز الواصل من غير الواصل", async () => {
  reset();
  pool.addProxies(["http://up.test:8", "http://down.test:8"]);
  const fakeTester = async (url) => url.includes("up");
  const results = await pool.checkProxies(fakeTester, { force: true });
  assert.equal(results.length, 2);
  const up = results.find((r) => r.url.includes("up"));
  const down = results.find((r) => r.url.includes("down"));
  assert.equal(up.ok, true);
  assert.equal(down.ok, false);
  assert.ok(down.error, "has error reason");
  assert.equal(pool.healthyCount(), 1);
});

test("فحص غير قسري يتجاوز البروكسي غير السليم ضمن فترة التهدئة", async () => {
  reset();
  pool.addProxies(["http://slow.test:1"]);
  for (let i = 0; i < 3; i++) pool.reportResult("http://slow.test:1", false);
  assert.equal(pool.listProxies()[0].ok, false);
  const res = await pool.checkProxies(async () => true, { force: false });
  assert.equal(res[0].skipped, true, "يُتخطى أثناء التهدئة");
});

test("فحص قسري يتجاوز التهدئة ويعيد الفحص", async () => {
  reset();
  pool.addProxies(["http://cooldown.test:1"]);
  for (let i = 0; i < 3; i++) pool.reportResult("http://cooldown.test:1", false);
  const res = await pool.checkProxies(async () => true, { force: true });
  assert.equal(res[0].ok, true, "عاود التعافي بعد الفحص القسري");
});

test("parseProxyEndpoint يستخرج المضيف والمنفذ الافتراضي", () => {
  assert.deepEqual(parseProxyEndpoint("http://h.test:3128"), { host: "h.test", port: 3128 });
  assert.deepEqual(parseProxyEndpoint("https://h.test"), { host: "h.test", port: 443 });
  assert.equal(parseProxyEndpoint("not-a-url"), null);
});

// ── أدوات اختبار محلية للسيرفرات (CONNECT / SOCKS5) ─────────────

function startProxyServer(replyBuffer) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.once("data", () => socket.write(replyBuffer));
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

test("httpConnectProbe: CONNECT ناجح (200) يعيد true", async () => {
  const { server, port } = await startProxyServer(Buffer.from("HTTP/1.1 200 Connection established\r\n\r\n"));
  try {
    const ok = await httpConnectProbe(`http://127.0.0.1:${port}`, "www.gstatic.com", 443, 2000);
    assert.equal(ok, true);
  } finally { server.close(); }
});

test("httpConnectProbe: رفض البروكسي (403) يعيد false", async () => {
  const { server, port } = await startProxyServer(Buffer.from("HTTP/1.1 403 Forbidden\r\n\r\n"));
  try {
    const ok = await httpConnectProbe(`http://127.0.0.1:${port}`, "www.gstatic.com", 443, 2000);
    assert.equal(ok, false);
  } finally { server.close(); }
});

test("socks5Probe: greeting ناجح (05 00) يعيد true", async () => {
  const { server, port } = await startProxyServer(Buffer.from([0x05, 0x00]));
  try {
    const ok = await socks5Probe(`socks5://127.0.0.1:${port}`, 2000);
    assert.equal(ok, true);
  } finally { server.close(); }
});

test("protocolProbe يوجّه برقياً حسب بروتوكول URL", async () => {
  const { server, port } = await startProxyServer(Buffer.from("HTTP/1.1 200 Connection established\r\n\r\n"));
  try {
    assert.equal(await protocolProbe(`http://127.0.0.1:${port}`, 2000), true, "http → CONNECT");
    assert.equal(await protocolProbe(`https://127.0.0.1:${port}`, 2000), true, "https → CONNECT");
  } finally { server.close(); }
  const { server: s2, port: p2 } = await startProxyServer(Buffer.from([0x05, 0x00]));
  try {
    assert.equal(await protocolProbe(`socks5://127.0.0.1:${p2}`, 2000), true, "socks5 → SOCKS5");
  } finally { s2.close(); }
});

test("checkProxies بالبروتوكول المحقون يرصد سلامتة حقيقية", async () => {
  reset();
  const { server, port } = await startProxyServer(Buffer.from("HTTP/1.1 200 Connection established\r\n\r\n"));
  const good = `http://127.0.0.1:${port}`;
  pool.addProxies([good, "http://127.0.0.1:9"]); // منفذ مغلق
  const results = await pool.checkProxies(protocolProbe, { force: true });
  assert.equal(results.find((r) => r.url === good).ok, true);
  assert.equal(results.find((r) => r.url.includes(":9")).ok, false);
  server.close();
});