/**
 * ssrf-guard.mjs — حارس مركزي ضد SSRF (Server-Side Request Forgery)
 * ─────────────────────────────────────────────────────────────────
 * يمنع الخادم من توجيه طلباته إلى عناوين داخلية/محجوزة عبر مدخلات المستخدم:
 *   - loopback (127.0.0.0/8, ::1)
 *   - شبكات خاصة (10/8, 172.16/12, 192.168/16, fc00::/7, fd00::/8)
 *   - link-local وبيانات السحابة (169.254.0.0/16, fe80::/10)
 *   - CGNAT 100.64/10
 *   - multicast/reserved
 * يُطبَّق على كل نقطة يجري فيها "فتح رابط" من مدخلات المستخدم:
 *   engine.mjs (/crawl), general-crawl.mjs, flare-solver.mjs, app/server.mjs
 */
import { lookup } from "node:dns/promises";
import net from "node:net";

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];
const BLOCKED_HOSTNAMES = new Set([
  "localhost", "localhost.localdomain", "metadata", "metadata.google.internal",
  "metadata.google", "kubernetes.default.svc",
]);

// نطاقات IPv4 محجوزة/خاصة (CWE-918 hardening)
function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return true;
  if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b, c, d] = parts;
  // a.b.c.d: block default/loopback/private/link-local/CGNAT/reserved/multicast/broadcast
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && c === 0 && d === 0) return true; // 192.0.0.0/24 IETF
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET
  if (a >= 224) return true; // multicast + reserved + broadcast
  if (a === 255 && b === 255 && c === 255 && d === 255) return true; // limited broadcast
  return false;
}

function isPrivateIPv6(ip) {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1") return true; // loopback
  if (h === "::") return true; // unspecified
  if (h.startsWith("::ffff:")) {
    const mapped = h.slice(7);
    if (mapped.includes(".")) return isPrivateIPv4(mapped);
    return true;
  }
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // fe80::/10 link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 unique local
  if (h.startsWith("ff")) return true; // multicast
  return false;
}

function isBlockedAddress(ip) {
  if (net.isIP(ip) === 4) return isPrivateIPv4(ip);
  if (net.isIP(ip) === 6) return isPrivateIPv6(ip);
  return true; // غير رقمي → لا نعرف → نحظر في سياق عناوين
}

function isBlockedHostname(host) {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  for (const sfx of BLOCKED_SUFFIXES) {
    if (h.endsWith(sfx)) return true;
  }
  return false;
}

/**
 * assertPublicUrl — يرفع خطأً إذا لم يكن الرابط http(s) عامًا.
 * opts.allowPrivate=true يتجاوز الفحص (للاختبارات الداخلية).
 */
export async function assertPublicUrl(rawUrl, opts = {}) {
  const allowPrivate = !!(opts && opts.allowPrivate);
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("URL required");
  }
  let u;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http/https allowed");
  }
  const hostname = u.hostname;

  if (!allowPrivate) {
    if (isBlockedHostname(hostname)) throw new Error("Blocked host");
    if (net.isIP(hostname)) {
      if (isBlockedAddress(hostname)) throw new Error("Blocked address");
      return u;
    }
  }

  // اسم نطاق → اجلب جميع عناوينه وتحقق من كل عنوان.
  if (!allowPrivate) {
    let addrs = [];
    try {
      addrs = await lookup(hostname, { all: true });
    } catch {
      // لا يمكن حله DNS → حظر (لا نعرف وجهته).
      throw new Error("DNS resolution failed");
    }
    if (!addrs.length) throw new Error("DNS resolution failed");
    for (const a of addrs) {
      if (isBlockedAddress(a.address)) {
        throw new Error(`Blocked resolved address ${a.address}`);
      }
    }
  }

  return u;
}

/**
 * safeFetch — fetch() يتبع التحويلات يدويًا مع فحص كل قفزة.
 * يمنع الهبوط إلى عنوان داخلي عبر إعادة توجيه من موقع عام.
 */
export async function safeFetch(rawUrl, init = {}, opts = {}) {
  let u = await assertPublicUrl(rawUrl, opts);
  let current = u.href;
  let redirects = 0;
  const MAX_REDIRECTS = 5;

  for (;;) {
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (++redirects > MAX_REDIRECTS) throw new Error("Too many redirects");
      const next = new URL(res.headers.get("location"), current).href;
      await assertPublicUrl(next, opts);
      current = next;
      continue;
    }
    return res;
  }
}

/**
 * installPlaywrightSsrfGuard — يحقن طرق صفحة Playwright
 * لقطع أي طلب (أو إعادة توجيه/عامل) إلى عنوان داخلي/محجوز.
 * يعمل بالتوازي مع assertPublicUrl على كل طلب.
 */
export async function installPlaywrightSsrfGuard(page, opts = {}) {
  const allowPrivate = !!(opts && opts.allowPrivate);
  // قرار نطاق مخزَّن مؤقتًا لتقليل استعلامات DNS المتكررة.
  const decisionCache = new Map();

  const decide = async (url) => {
    if (/^(about|data|blob):/i.test(url)) return true; // موارد داخلية للمتصفح ذاتيّة
    let u;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (allowPrivate) return true;
    const hostname = u.hostname;
    if (decisionCache.has(hostname)) return decisionCache.get(hostname);
    let ok = false;
    try {
      await assertPublicUrl(url, opts);
      ok = true;
    } catch {
      ok = false;
    }
    decisionCache.set(hostname, ok);
    return ok;
  };

  await page.route("**/*", async (route) => {
    const allowed = await decide(route.request().url());
    if (allowed) await route.continue().catch(() => {});
    else await route.abort("blockedbyclient").catch(() => {});
  });
}