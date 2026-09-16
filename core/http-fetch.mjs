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

const ROTATED_UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
];
let uaIndex = 0;

/**
 * جلب صفحة بمسار HTTP خفيف.
 * @param {string} url
 * @param {object} [opts]
 * @returns {Promise<{ok:boolean, blocked:boolean, status:number, text:string, kind:string|null, error?:string, elapsed:number}>}
 */
export async function httpFetch(url, opts = {}) {
  const { timeout = 12000, userAgent = null } = opts;
  const hostname = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const breaker = getCircuitBreaker();

  // قاطع الدائرة: مضيف مفتوح لا يمر حتى بربط HTTP
  if (breaker.status(hostname) !== "closed" && !breaker.canRequestNow(hostname)) {
    return { ok: false, blocked: true, status: 0, text: "", kind: "breaker_open", error: "circuit breaker open", elapsed: 0 };
  }

  await waitForHost(hostname); // حدّاد مؤخّر المضيف (عزل زمني)

  const ua = userAgent || ROTATED_UAS[uaIndex++ % ROTATED_UAS.length];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = Date.now();

  try {
    const res = await globalThis.fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "max-age=0",
      },
    });
    const text = await res.text();
    const elapsed = Date.now() - started;

    const block = classifyBan({
      statusCode: res.status,
      html: text.slice(0, 3000),
      title: "",
      bodyText: text.slice(0, 1000),
      url,
    });

    return {
      ok: !block.banned,
      blocked: block.banned,
      status: res.status,
      text,
      kind: block.kind,
      confidence: block.confidence,
      elapsed,
    };
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