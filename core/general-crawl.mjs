/**
 * general-crawl.mjs — وضع الاستقصاء العام
 * يأخذ أي رابط/قائمة روابط/مجموعة مواقع ويسحب "وثيقة منظمة": نص كامل، عناوين،
 * روابط (داخلية/خارجية)، صور، جداول، وصف. الاستخراج من HTML صافي (parseHtmlDocument)
 * قابل للاختبار حتمياً عبر jsdom؛ التنفيذ الحي بالمتصفح (crawlUrls) يُحمَّل عند الطلب.
 */
import { JSDOM } from "jsdom";

export function normalizeUrl(raw, base) {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

export function internalLink(url, baseHost) {
  try {
    const u = new URL(url);
    return u.hostname === baseHost;
  } catch {
    return false;
  }
}

export function stripHashtag(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

export function parseHtmlDocument(html, baseUrl, opts = {}) {
  const collect = { text: true, links: true, images: true, tables: true, ...opts };
  const dom = new JSDOM(html);
  const d = dom.window.document;
  const host = (() => { try { return new URL(baseUrl).hostname; } catch { return ""; } })();

  const title = (d.querySelector("title")?.textContent || "")
    .replace(/\s+/g, " ").trim();

  const metaDescription = (d.querySelector('meta[name="description"]')?.getAttribute("content") || "")
    .trim();

  const headings = Array.from(d.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) =>
    (h.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);

  const text = (d.body?.textContent || "").replace(/\s+/g, " ").trim();

  const links = [];
  const linkSet = new Set();
  if (collect.links) {
    for (const a of d.querySelectorAll("a[href]")) {
      const href = normalizeUrl(a.getAttribute("href"), baseUrl);
      if (!href) continue;
      const clean = stripHashtag(href);
      if (linkSet.has(clean)) continue;
      linkSet.add(clean);
      links.push({
        url: clean,
        internal: internalLink(clean, host),
        text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200),
      });
    }
  }

  const images = [];
  if (collect.images) {
    for (const img of d.querySelectorAll("img[src]")) {
      const src = normalizeUrl(img.getAttribute("src"), baseUrl);
      if (src) images.push({ url: src, alt: img.getAttribute("alt") || "" });
    }
  }

  const tables = [];
  if (collect.tables) {
    for (const table of d.querySelectorAll("table")) {
      const rows = [];
      for (const tr of table.querySelectorAll("tr")) {
        const cells = Array.from(tr.querySelectorAll("th,td"))
          .map((c) => (c.textContent || "").replace(/\s+/g, " ").trim());
        if (cells.length) rows.push(cells);
      }
      if (rows.length) tables.push({ rows });
    }
  }

  return {
    url: baseUrl,
    host,
    fetchedAt: new Date().toISOString(),
    title,
    metaDescription,
    headings,
    text,
    chars: text.length,
    links,
    externalLinks: links.filter((l) => !l.internal).length,
    internalLinks: links.filter((l) => l.internal).length,
    images: images.length,
    tables,
    tableRows: tables.reduce((acc, t) => acc + t.rows.length, 0),
  };
}

export function summarizeDocuments(docs, classify = null) {
  const byHost = {};
  for (const doc of docs) {
    byHost[doc.host] = (byHost[doc.host] || 0) + 1;
  }

  const topicDist = {};
  if (classify && docs.length) {
    for (const doc of docs) {
      const sample = `${doc.title}\n${(doc.metaDescription || "")}\n${(doc.text || "").slice(0, 1500)}`;
      const res = classify(sample);
      const t = res.dominant?.topic || "general";
      topicDist[t] = (topicDist[t] || 0) + 1;
    }
  }

  return {
    totalDocs: docs.length,
    hosts: Object.entries(byHost).map(([host, pages]) => ({ host, pages })),
    topicDistribution: Object.entries(topicDist)
      .map(([topic, count]) => ({ topic, count, pct: docs.length ? Math.round((count / docs.length) * 100) : 0 }))
      .sort((a, b) => b.count - a.count),
    totals: {
      chars: docs.reduce((a, d) => a + d.chars, 0),
      links: docs.reduce((a, d) => a + d.links.length, 0),
      images: docs.reduce((a, d) => a + d.images, 0),
      tableRows: docs.reduce((a, d) => a + d.tableRows, 0),
    },
  };
}

/**
 * تنفيذ حي عبر المتصفح — يُحمَّل عند الطلب لتجنب وزن Playwright في الاختبارات.
 * { urls: [], depth, maxPages, maxPerHost, delayMs, classify }
 */
export async function crawlUrls(urls, opts = {}) {
  const { depth = 0, maxPages = 20, maxPerHost = 10, delayMs = 1200, fetchMode = "fetch" } = opts;
  if (!Array.isArray(urls) || !urls.length) throw new TypeError("crawlUrls: urls must be a non-empty array");

  const seen = new Set();
  const docs = [];
  const queue = urls.map((u) => ({ url: u, level: 0 }));

  const httpFetch = async (url) => {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en,ar;q=0.8",
      },
      redirect: "follow",
    });
    return await res.text();
  };

  const browserFetch = async (url) => {
    const { createPage } = await import("./anti-detect.mjs");
    const { page, browser } = await createPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(600);
      return await page.content();
    } finally {
      await browser.close();
    }
  };

  const perHost = {};
  for (let i = 0; i < queue.length && docs.length < maxPages; i++) {
    const { url, level } = queue[i];
    const host = (() => { try { return new URL(url).hostname; } catch { return "?"; } })();
    if (perHost[host] >= maxPerHost) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    let html;
    try {
      html = fetchMode === "browser" ? await browserFetch(url) : await httpFetch(url);
      await new Promise((r) => setTimeout(r, delayMs));
    } catch (e) {
      continue;
    }

    const doc = parseHtmlDocument(html, url, opts.extract || {});
    docs.push(doc);
    perHost[host] = (perHost[host] || 0) + 1;

    if (level < depth) {
      for (const l of doc.links.filter((x) => x.internal).slice(0, 25)) {
        if (!seen.has(l.url) && docs.length < maxPages) queue.push({ url: l.url, level: level + 1 });
      }
    }
  }

  return docs;
}