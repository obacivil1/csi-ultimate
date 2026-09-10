/**
 * proxy-pool.mjs — حمام سباحة بروكسيات بفحوصات صحة
 * يسجّل البروكسيات، يختارها بالتناوب من السليمة فقط، يراقب حالتها الصحية
 * (فحص استباقي TCP + تغذية راجعة من الزحف)، ويضع حدّاً للكسر عند تكرار الفشل
 * ثم يعيد فحصها بعد فترة تهدئة (cooldown). قابل للاختبار: المُختبِر يُحقن.
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
  }));
}

export function healthyCount() {
  return [...PROXIES.values()].filter((p) => p.ok).length;
}

/** اختيار التناوب على السليمة فقط؛ يعيد null إذا لا يوجد أي بروكسي. */
export function getProxy(_hostname) {
  const healthy = [...PROXIES.values()].filter((p) => p.ok);
  if (!healthy.length) return null;
  const p = healthy[rr % healthy.length];
  rr += 1;
  return p.url;
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
 * فحص شامل: يجري على كل بروكسي ويكثر حالة الصحة. force يتجاوز فترة التهدئة.
 * @param {Function} [tester] - (url, timeoutMs) => Promise<boolean>
 */
export async function checkProxies(tester = tcpProbe, opts = {}) {
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

export function startHealthChecks(tester = tcpProbe, intervalMs = 60000) {
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