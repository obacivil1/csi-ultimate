/**
 * proxy-pool.mjs — حمام سباحة بروكسيات بفحوصات صحة
 * يسجّل البروكسيات، يختارها بالتناوب من السليمة فقط، يراقب حالتها الصحية
 * (فحص استباقي TCP + CONNECT/بروتوكول + تغذية راجعة من الزحف)، ويضع حدّاً للكسر
 * عند تكرار الفشل ثم يعيد فحصها بعد فترة تهدئة (cooldown).
 * قابل للاختبار: المُختبِر يُحقن.
 * ──────────────────────────────────────────────────────────────
 * الترقية V1: فحص بروتوكولي حقيقي (TCP + CONNECT أو SOCKS5)
 *             بدلاً من فحص TCP فقط (لا يثبت أن النفق يعمل فعلاً).
 */
import net from "node:net";

const PROXIES = new Map();
let rr = 0;
const healthTimer = { id: null };
const CONSECUTIVE_LIMIT = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

export function parseProxyList(str) {
  if (!str) return [];
  return String(str).split(",").map((s) => s.trim()).filter(Boolean);
}

export function addProxy(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  if (!PROXIES.has(u)) {
    PROXIES.set(u, {
      url: u, ok: true,
      consecutiveFailures: 0, totalFailures: 0, totalSuccesses: 0,
      lastChecked: null, lastOkAt: null, lastError: null,
      latencyMs: null, cooldownUntil: 0,
    });
  }
  return PROXIES.get(u);
}

export function addProxies(list) {
  (Array.isArray(list) ? list : []).forEach((x) => addProxy(x));
  return listProxies();
}

export function clearProxies() {
  PROXIES.clear();
  rr = 0;
}

export function seedFromEnv(envProxy) {
  clearProxies();
  addProxies(parseProxyList(envProxy));
}

export function listProxies() {
  return [...PROXIES.values()].map((p) => ({
    url: p.url,
    ok: p.ok,
    consecutiveFailures: p.consecutiveFailures,
    totalFailures: p.totalFailures,
    totalSuccesses: p.totalSuccesses,
    lastChecked: p.lastChecked,
    lastOkAt: p.lastOkAt,
    lastError: p.lastError,
    latencyMs: p.latencyMs,
    score: scoreOf(p),
  }));
}

export function healthyCount() {
  return [...PROXIES.values()].filter((p) => p.ok).length;
}

/** اختيار موزون: يُفضّل السليم الأعلى درجة (نسبة نجاح/كمون) بدل التناوب الأعمى،
 *  مع تناوب عادل ضمن نفس الدرجة. يعيد null إذا لا يوجد أي بروكسي سليم. */
export function getProxy(_hostname) {
  const healthy = [...PROXIES.values()].filter((p) => p.ok);
  if (!healthy.length) return null;
  const ordered = healthy.slice().sort((a, b) => scoreOf(b) - scoreOf(a));
  // الوجه الأعلى درجة أولاً مع تناوب بين المتساوين
  const top = ordered[0];
  const peers = ordered.filter((p) => scoreOf(p) === scoreOf(top));
  const p = peers[rr % peers.length];
  rr += 1;
  return p.url;
}

/** درجة لوجستية من بيانات الحالة: نسبة نجاح مرجحة لاحقاً + كلفة كمون. */
export function scoreOf(p) {
  const total = p.totalSuccesses + p.totalFailures;
  if (total === 0) return 100; // غير مختبَر بعد — فرصة عادلة
  const successRatio = p.totalSuccesses / total;
  const latencyPenalty = p.latencyMs && p.latencyMs > 0 ? Math.min(p.latencyMs / 2000, 1) : 0;
  return Math.round(100 * (successRatio * 0.7 + (1 - latencyPenalty) * 0.3));
}

/** تغذية راجعة من الزحف نفسه: نجاح/فشل فيبرمج حدّ الكسر. */
export function reportResult(url, ok) {
  const p = PROXIES.get(url);
  if (!p) return;
  if (ok) {
    p.consecutiveFailures = 0;
    p.totalSuccesses += 1;
    p.ok = true;
    p.lastOkAt = new Date().toISOString();
    p.cooldownUntil = 0;
  } else {
    p.consecutiveFailures += 1;
    p.totalFailures += 1;
    p.lastError = "scrape-failure";
    if (p.consecutiveFailures >= CONSECUTIVE_LIMIT) {
      p.ok = false;
      p.cooldownUntil = Date.now() + COOLDOWN_MS;
    }
  }
}

/** يستخرج عنوان البروكسي (host:port) للفحص. */
export function parseProxyEndpoint(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port || (u.protocol === "https:" ? 443 : 80)) };
  } catch {
    return null;
  }
}

export function tcpProbe(proxyUrl, timeoutMs = 4000) {
  const ep = parseProxyEndpoint(proxyUrl);
  if (!ep) return Promise.resolve(false);
  return new Promise((resolve) => {
    const sock = net.connect({ host: ep.host, port: ep.port, timeout: timeoutMs });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
    sock.once("error", () => { sock.destroy(); resolve(false); });
  });
}

/**
 * فحص CONNECT بروتوكولي: يثبت أن البروكسي يفتح نفقاً فعلاً (HTTP 200 من المستخدم).
 * المهمة: CONNECT www.gstatic.com:443 HTTP/1.1 → 200 Connection established.
 */
export function httpConnectProbe(proxyUrl, targetHost = "www.gstatic.com", targetPort = 443, timeoutMs = 4000) {
  const ep = parseProxyEndpoint(proxyUrl);
  if (!ep) return Promise.resolve(false);
  return new Promise((resolve) => {
    const sock = net.connect({ host: ep.host, port: ep.port, timeout: timeoutMs });
    let resolved = false;
    const finish = (ok) => { if (!resolved) { resolved = true; try { sock.destroy(); } catch {} resolve(ok); } };
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    sock.once("connect", () => {
      const req = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`;
      sock.write(req);
      // Wait for status line (first 14 bytes typical "HTTP/1.1 200 ..")
      let buf = Buffer.alloc(0);
      const onData = (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const line = buf.toString("ascii").split(/\r?\n/)[0] ?? "";
        if (line.includes("200")) finish(true);
        else if (line.length > 3) finish(false); // non-200
      };
      sock.on("data", onData);
      // Safety timeout fallback
      setTimeout(() => finish(false), timeoutMs - 100);
    });
  });
}

/**
 * فحص SOCKS5: greeting → اتفاق على عدم التوثيق فقط يثبت أن البروكسي SOCKS5 يعمل.
 * المهمة: 05 01 00 → 05 00.
 */
export function socks5Probe(proxyUrl, timeoutMs = 4000) {
  const ep = parseProxyEndpoint(proxyUrl);
  if (!ep) return Promise.resolve(false);
  return new Promise((resolve) => {
    const sock = net.connect({ host: ep.host, port: ep.port, timeout: timeoutMs });
    let resolved = false;
    const finish = (ok) => { if (!resolved) { resolved = true; try { sock.destroy(); } catch {} resolve(ok); } };
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    sock.once("connect", () => {
      // SOCKS5 greeting: version=5, 1 method, method=0 (no auth)
      sock.write(Buffer.from([0x05, 0x01, 0x00]));
      const onData = (chunk) => {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (b.length >= 2 && b[0] === 0x05 && b[1] === 0x00) finish(true);
        else finish(false);
      };
      sock.once("data", onData);
      setTimeout(() => finish(false), timeoutMs - 100);
    });
  });
}

/**
 * فحص بروتوكولي ذكي: يختار البروتوكول المناسب تلقائياً حسب نوع URL.
 * - socks5:// → SOCKS5 greeting
 * - http(s):// → HTTP CONNECT
 */
export function protocolProbe(proxyUrl, timeoutMs = 4000) {
  if (String(proxyUrl).startsWith("socks5://")) {
    return socks5Probe(proxyUrl, timeoutMs);
  }
  return httpConnectProbe(proxyUrl, "www.gstatic.com", 443, timeoutMs);
}

/**
 * فحص شامل: يجري على كل بروكسي ويكثر حالة الصحة. force يتجاوز فترة التهدئة.
 * الافتراضي البروتوكولي: فحص TCP أولاً، ثم CONNECT أو SOCKS5.
 * @param {Function} [tester] - (url, timeoutMs) => Promise<boolean>
 */
export async function checkProxies(tester = protocolProbe, opts = {}) {
  const { force = false, timeoutMs = 4000 } = opts;
  const results = [];
  for (const p of PROXIES.values()) {
    if (!force && !p.ok && p.cooldownUntil > Date.now()) {
      results.push({ url: p.url, ok: p.ok, skipped: true });
      continue;
    }
    const started = Date.now();
    let ok = false;
    let err = null;
    try {
      ok = Boolean(await tester(p.url, timeoutMs));
    } catch (e) {
      err = e && e.message ? e.message : String(e);
    }
    p.latencyMs = Date.now() - started;
    p.lastChecked = new Date().toISOString();
    if (ok) {
      p.ok = true;
      p.consecutiveFailures = 0;
      p.cooldownUntil = 0;
    } else {
      p.consecutiveFailures += 1;
      p.totalFailures += 1;
      p.lastError = err || "unreachable";
      p.ok = false;
      p.cooldownUntil = Date.now() + COOLDOWN_MS;
    }
    results.push({ url: p.url, ok: p.ok, latencyMs: p.latencyMs, checkedAt: p.lastChecked, error: p.lastError });
  }
  return results;
}

export function startHealthChecks(tester = protocolProbe, intervalMs = 60000) {
  if (healthTimer.id) return false;
  const id = setInterval(() => { checkProxies(tester).catch(() => {}); }, intervalMs);
  if (id && id.unref) id.unref();
  healthTimer.id = id;
  return true;
}

export function stopHealthChecks() {
  if (healthTimer.id) {
    clearInterval(healthTimer.id);
    healthTimer.id = null;
  }
}

export function resetPool() {
  clearProxies();
  stopHealthChecks();
}