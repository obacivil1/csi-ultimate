/**
 * http-fetch.mjs — المسار الأخف HTTP-first (السكة C: الكفاءة)
 * ──────────────────────────────────────────────────────────────
 * أغلب صفحات التصنيفات سيرفر-ريندر: تُجلب بـ fetch خفيف (10× أسرع، دون
 * متصفح/ذاكرة) مع كامل حماية الحظر مركزي: حدّاد المضيف المعزول + قاطع
 * الدائرة + المعرّف الموحّد للحظر. عند الحجب يعود باعثاً السبب ليتراجع
 * المتصل إلى Playwright (fallback) — لا متصفح خامد مع كل صفحة.
 */
import { classifyBan } from "./ban-detector.mjs";
import { getCircuitBreaker, waitForHost } from "./rate-limiter.mjs";
import { parseHtmlDocument } from "./general-crawl.mjs";
import { detectTechnologies, analyzeSecurityHeaders } from "./tech-detector.mjs";
import { scoreResponse } from "./anomaly-scorer.mjs";
import { StreamingTrustHub } from "./streaming-trust.mjs";

const ROTATED_UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.16",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
];
let uaIndex = 0;

// Stealth UA rotation v3.25 — mimics real browser fingerprints, reduces detection
function stealthUa() {
  const uas = ROTATED_UAS;
  const idx = uaIndex++ % uas.length;
  return uas[idx];
}

// Protocol detection and normalization
const PROTOCOL_PATTERNS = {
  http: /^http:\/\//i,
  https: /^https:\/\//i,
  ftp: /^ftp:\/\//i,
  ws: /^ws:\/\//i,
  wss: /^wss:\/\//i,
};

// Normalize URL to ensure protocol presence and consistency
function normalizeUrl(url) {
  if (!url) return url;
  if (PROTOCOL_PATTERNS.http.test(url) || PROTOCOL_PATTERNS.https.test(url)) return url;
  if (!url.startsWith("http")) return "https://" + url;
  return url;
}

//	Caching system — opt-in only, keyed by hostname+path
const CACHE_TTL = 300000; // 5 minutes default TTL
const cache = new Map(); // hostname+path -> {text, headers, timestamp, etag}

function isCacheValid(entry) {
  return entry && (Date.now() - entry.timestamp) < CACHE_TTL;
}

function getCacheEtag(url) {
  const parsed = new URL(url);
  return parsed.hash || `w/"${parsed.hostname}-${parsed.pathname}"`;
}

function buildCacheKey(url) {
  try { return new URL(url).hostname + new URL(url).pathname; } catch { return url; }
}

//	header entropy counter — tracks UA rotation pattern for anti-fingerprinting
let headerEntropy = 0;

const HEADER_ORDERS = [
  ["User-Agent", "Accept", "Accept-Language", "Accept-Encoding", "Cache-Control"],
  ["User-Agent", "Accept-Language", "Accept", "Cache-Control", "Accept-Encoding"],
  ["Accept", "User-Agent", "Cache-Control", "Accept-Language", "Accept-Encoding"],
];
const ACCEPT_LANGS = [
  "en-US,en;q=0.9",
  "ar,en-US;q=0.9,en;q=0.8",
  "en-GB,en;q=0.9,ar;q=0.8",
  "en-US,en;q=0.9,ar-SA;q=0.8",
];
let headerOrderIndex = 0;
let langIndex = 0;

function baseHeaders(ua, opts = {}) {
  // Use rotated UA to reduce fingerprinting - inject entropy to break patterns
  const uaIdx = uaIndex++ % ROTATED_UAS.length;
  const selectedUa = ROTATED_UAS[uaIdx];
  headerEntropy += 1; // track rotation for anti-fingerprinting

  const noCache = opts?.noCache;
  const cacheControl = noCache ? "no-cache" : "max-age=0";

  const headers = {
    "User-Agent": selectedUa,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": ACCEPT_LANGS[langIndex++ % ACCEPT_LANGS.length],
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": cacheControl,
    "DNT": "1", // Do Not Track
    "Connection": "keep-alive",
    // Stealth: randomize accept-charset to reduce fingerprinting
    "Accept-Charset": "UTF-8,utf-16;q=0.1,*;q=0.1",
    // Stealth: reduce accept-language precision
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,video/webm,image/apng,*/*;q=0.8",
  };
  // إعادة ترتيب الرؤوس حسب قالب عشوائي (Fetch يرسلها بالترتيب المعطى)
  const order = HEADER_ORDERS[headerOrderIndex++ % HEADER_ORDERS.length];
  const ordered = {};
  for (const k of order) if (headers[k] !== undefined) ordered[k] = headers[k];
  for (const k of Object.keys(headers)) if (ordered[k] === undefined) ordered[k] = headers[k];
  return ordered;
}

// نبض الثقة المستمر لكل مضيف (نمط v3.23) — تغذية كل استجابة وتلقي الإجراء المقترح
const trustHub = new StreamingTrustHub();

/**
 * compositeTrust — درجة ثقة مركبة (v3.18 Zero-Trust Score Composition)
 * تدمج إشارات مستقلة إلى درجة واحدة 0..1:
 *   - anomaly (0.30): شذوذ السلوك من scoreResponse
 *   - techQuality (0.20): جودة fingerprint التقني (ثقة الكشف)
 *   - responseTime (0.20): زمن الاستجابة normalized (أسرع = أعلى درجة)
 *   - banPenalty (0.15): عقوبة الحجب/الحظر (0 إذا محجوب، 1 إذا OK)
 *   - temporal (0.15): عامل الوقت من trustHub (الاتجاه/الاستقرار)
 * @param {object} opts
 * @param {number} [opts.anomalyScore=0.5] - من scoreResponse (0..1)
 * @param {number} [opts.techQuality=0.5] - من detectTechnologies confidence (0..1)
 * @param {number} [opts.elapsed=1000] - زمن الاستجابة ms
 * @param {number} [opts.banPenalty=0] - 0 إذا محجوب، 1 إذا OK
 * @param {object} [opts.trustHubState] - ثقة المضيف من StreamingTrustHub
 * @returns {number} درجة الثقة المركبة 0..1
 */
function compositeTrust(opts = {}) {
  const {
    anomalyScore = 0.5,
    techQuality = 0.5,
    elapsed = 1000,
    banPenalty = 0,
    trustHubState,
  } = opts;

  // normalize response time: 0..1 where typical ~2000ms => 0.5, fast ~200ms => 0.8, slow >5000ms => 0.2
  const r = Math.max(0, Math.min(1, elapsed));
  const timeScore = Math.max(0, Math.min(1, 1 - Math.log10(Math.max(1, r)) / Math.log10(5000))) * 2;
  // simpler linear-normalize for robustness:
  const normalizedTime = Math.max(0, Math.min(1, 1 - (r - 200) / 3000)); // 200ms=>1, 3200ms=>0
  // ban penalty: 0 if banned (full penalty), 1 if OK
  const banScore = 1 - banPenalty; // if banPenalty=1 (banned) -> 0, if 0 (ok) -> 1

  // weights sum to 1.0
  const weights = { anomaly: 0.30, time: 0.20, tech: 0.20, ban: 0.15, temporal: 0.15 };

  let score = 0;
  score += anomalyScore * weights.anomaly;
  score += normalizedTime * weights.time;
  score += techQuality * weights.tech;
  score += banScore * weights.ban;
  // temporal: if trustHubState provided, use its decision direction as factor
  if (trustHubState && trustHubState.trust !== undefined) {
    // trust close to 1 = stable, close to 0 = decaying; we invert for penalty
    const t = Math.max(0, Math.min(1, trustHubState.trust));
    score += (1 - t) * weights.temporal; // decaying trust reduces composite
  } else {
    score += 0.5 * weights.temporal; // neutral default
  }

  return Math.max(0, Math.min(1, score));
}

export { compositeTrust };

/**
 * جلب صفحة بمسار HTTP خفيف.
 * @param {string} url
 * @param {object} [opts]
 * @returns {Promise<{ok:boolean, blocked:boolean, status:number, text:string, kind:string|null, error?:string, elapsed:number}>}
 */
export async function httpFetch(url, opts = {}) {
  // [FIX] تطبيع البروتوكل لضمان Beginnings consistent
  url = normalizeUrl(url);
  const { timeout = 12000, userAgent = null, maxRedirects = 5, cache = false, noCache = false } = opts;
  const hostname = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const breaker = getCircuitBreaker();

  // قاطع الدائرة: مضيف مفتوح لا يمر حتى بربط HTTP
  if (breaker.status(hostname) !== "closed" && !breaker.canRequestNow(hostname)) {
    return { ok: false, blocked: true, status: 0, text: "", kind: "breaker_open", error: "circuit breaker open", elapsed: 0 };
  }

  await waitForHost(hostname); // حدّاد مؤخّر المضيف (عزل زمني)

  const ua = userAgent || stealthUa();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = Date.now();
  let redirectCount = 0;

  // ----- caching block (opt-in, opt-out by setting cache=false or noCache=true) -----
  let cached = null;
  const useCache = cache !== false && !noCache;
  if (useCache) {
    const key = buildCacheKey(url);
    const entry = cache.get(key);
    if (isCacheValid(entry) && entry.etag) {
      // Return cached response with 304 Not Modified if headers match
      const ifNoneMatch = baseHeaders(ua, { noCache: true })["If-None-Match"];
      if (ifNoneMatch && entry.etag === ifNoneMatch) {
        cached = { ok: true, status: 304, kind: "not_modified", text: entry.text, elapsed: 0 };
      } else {
        cached = { ok: true, status: 200, kind: "cache_hit", text: entry.text, elapsed: 0 };
      }
    }
  }
  if (cached) {
    // Return cached data — minimal elapsed time
    const elapsed = Date.now() - started;
    const statusNum = cached.status;
    const block = classifyBan({
      statusCode: statusNum,
      html: cached.text.slice(0, 3000),
      title: "",
      bodyText: cached.text.slice(0, 1000),
      url,
    });
    const headersObj = {};
    // Note: cached entry has no headers stored by default; if needed, store them in cache block above
    const tech = detectTechnologies({ html: cached.text.slice(0, 20000), headers: headersObj });
    const security = analyzeSecurityHeaders(headersObj);
    const anomaly = scoreResponse({
      status: statusNum,
      kind: cached.kind,
      confidence: block.confidence,
      evidence: block.evidence,
      elapsed,
      breakerFails: "breaker_open" !== cached.kind ? 0 : 1,
    });
    const composite = compositeTrust({
      anomalyScore: anomaly.score,
      techQuality: tech ? (tech.confidence || 0.5) : 0.5,
      elapsed,
      banPenalty: statusNum !== 304 ? 1 : 0,
      trustHubState: trustHub.state(hostname),
    });
    trustHub.push(hostname, composite);
    const trust = trustHub.state(hostname);
    return {
      ok: !block.banned,
      blocked: block.banned,
      status: statusNum,
      text: cached.text,
      kind: cached.kind,
      confidence: block.confidence,
      elapsed,
      tech,
      security,
      anomaly,
      trust: {
        score: trust.trust,
        decision: trust.decision,
        forecast: trust.forecast.trend,
      },
      compositeTrust: {
        score: Math.round(composite * 1000) / 1000,
        decision: composite >= 0.6 ? "healthy" : composite >= 0.3 ? "caution" : "at-risk",
        factors: {
          anomaly: Number(anomaly.score.toFixed(2)),
          tech: Number((techQuality || 0.5).toFixed(2)),
          ban: Number((1 - (block.banned ? 1 : 0)).toFixed(2)),
        },
      },
    };
  }
  // ----- end caching block -----

  try {
    //_loop with redirect limit for performance & avoidance of redirect chains
    while (redirectCount <= maxRedirects) {
      const res = await globalThis.fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: baseHeaders(ua),
      });

      // أحبط دورات redirect اللانهائية
      if (res.status >= 300 && res.status < 400 && "location" in res.headers && redirectCount < maxRedirects) {
        url = res.headers.get("location");
        if (!url.startsWith("http")) url = new URL(url, new URL("https://example.com")).href;
        redirectCount++;
        continue;
      }

      const text = await res.text();
      const elapsed = Date.now() - started;

      // Store in cache if enabled (before ban classification, to preserve fresh headers)
      if (useCache) {
        const etag = res.headers.get("etag") || getCacheEtag(url);
        const cacheKey = buildCacheKey(url);
        cache.set(cacheKey, { text, headers: Object.fromEntries(res.headers.entries()), timestamp: Date.now(), etag });
      }

      const block = classifyBan({
        statusCode: res.status,
        html: text.slice(0, 3000),
        title: "",
        bodyText: text.slice(0, 1000),
        url,
      });

      // قراءة سلبية: كشف التقنيات + الرؤوس الأمنية مما أرسله الخادم أصلاً
      const headersObj = {};
      for (const [k, v] of res.headers.entries()) headersObj[k] = v;
      const tech = detectTechnologies({ html: text.slice(0, 20000), headers: headersObj });
      const security = analyzeSecurityHeaders(headersObj);

      // اقتراح شذوذ قابل للتفسير (أسلوب N0VA v3.21): essence تستشير،rules decide
      const breakerState = breaker.status(hostname);
      const anomaly = scoreResponse({
        status: res.status,
        kind: block.kind,
        confidence: block.confidence,
        evidence: block.evidence,
        elapsed,
        breakerFails: breakerState !== "closed" ? 1 : 0,
      });

      // درجة ثقة مركبة (v3.18) تجمع إشارات متعددة
      const composite = compositeTrust({
        anomalyScore: anomaly.score,
        techQuality: tech ? (tech.confidence || 0.5) : 0.5,
        elapsed,
        banPenalty: block.banned ? 1 : 0,
        trustHubState: trustHub.state(hostname),
      });

      //喂养 composite score إلى trust hub كمؤشر إضافي
      trustHub.push(hostname, composite);

      const trust = trustHub.state(hostname);

      return {
        ok: !block.banned,
        blocked: block.banned,
        status: res.status,
        text,
        kind: block.kind,
        confidence: block.confidence,
        elapsed,
        tech,
        security,
        anomaly,
        trust: {
          score: trust.trust,
          decision: trust.decision,
          forecast: trust.forecast.trend,
        },
        compositeTrust: {
          score: Math.round(composite * 1000) / 1000,
          decision: composite >= 0.6 ? "healthy" : composite >= 0.3 ? "caution" : "at-risk",
          factors: {
            anomaly: Number(anomaly.score.toFixed(2)),
            tech: Number((techQuality || 0.5).toFixed(2)),
            ban: Number((1 - (block.banned ? 1 : 0)).toFixed(2)),
          },
        },
      };
    }

    // exceeded max redirects
    return { ok: false, blocked: true, status: 0, text: "", kind: "too_many_redirects", error: "exceeded max redirects", elapsed: Date.now() - started };
  } catch (e) {
    return { ok: false, blocked: true, status: 0, text: "", kind: "network_error", error: e.message, elapsed: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * جلب + بنية كاملة (parseHtmlDocument): نفس عقد الوثيقة في general-crawl.
 * يعيد { source:'http', ..., ...doc } أو { ok:false, reason, ... } عند الحجب للإفلات للمتصفح.
 */
export async function httpFetchDocument(url, opts = {}) {
  const r = await httpFetch(url, opts);
  if (!r.ok) {
    return { ok: false, source: "http", reason: r.kind || r.error, status: r.status, url };
  }
  const doc = parseHtmlDocument(r.text, url, opts.collect);
  return { ok: true, source: "http", status: r.status, url, fetchedAt: doc.fetchedAt, doc };
}

export { ROTATED_UAS };