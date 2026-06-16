import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SITES_DIR = resolve(__dirname, "..", "config", "sites");

const DEFAULTS = {
  language: "en",
  search: {
    method: "GET",
    endpoint: "/search",
    param: "q",
    pageParam: "page",
    urlTemplate: null,
  },
  extraction: {
    adIdPattern: null,
    titleCleanup: [],
    phoneRegion: "GENERIC",
    countryCodes: [],
    currencies: [],
    selectors: {
      title: ["h1", "h2"],
      description: [".description", ".content", "article"],
      phone: ["a[href^='tel:']"],
      email: ["a[href^='mailto:']"],
      whatsapp: ["a[href*='wa.me']", "a[href*='whatsapp.com/send']"],
      location: ["[class*='location']", "[class*='city']"],
      price: ["[class*='price']"],
      company: ["[class*='company']"],
      breadcrumb: [".breadcrumb a"],
      date: ["time", "[class*='date']"],
    },
  },
  pagination: {
    nextSelector: "a[rel='next'], .next a, a.next",
  },
  categories: {
    autoDiscover: true,
  },
  excludeUrlPatterns: [],
};

function extractHostname(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function loadSiteConfig(hostname) {
  const filePath = resolve(SITES_DIR, `${hostname}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function mergeConfig(siteConfig) {
  if (!siteConfig) return { ...DEFAULTS };
  const merged = { ...DEFAULTS };
  for (const k of ["language", "excludeUrlPatterns"]) {
    if (siteConfig[k] !== undefined) merged[k] = siteConfig[k];
  }
  if (siteConfig.search) merged.search = { ...merged.search, ...siteConfig.search };
  if (siteConfig.extraction) {
    merged.extraction = { ...merged.extraction, ...siteConfig.extraction };
    if (siteConfig.extraction.selectors) {
      merged.extraction.selectors = { ...merged.extraction.selectors, ...siteConfig.extraction.selectors };
    }
  }
  if (siteConfig.pagination) merged.pagination = { ...merged.pagination, ...siteConfig.pagination };
  if (siteConfig.categories) merged.categories = { ...merged.categories, ...siteConfig.categories };
  return merged;
}

const configCache = new Map();

export function validateSiteConfig(siteConfig, hostname) {
  const warnings = [];
  if (!siteConfig) return warnings;
  if (!siteConfig.search?.param && !siteConfig.search?.paramName && !siteConfig.search?.urlTemplate) {
    warnings.push(`${hostname}: missing search.param / search.urlTemplate`);
  }
  if (!siteConfig.extraction?.selectors) {
    warnings.push(`${hostname}: missing extraction.selectors`);
  } else {
    const required = ["title", "description"];
    for (const f of required) {
      if (!siteConfig.extraction.selectors[f]?.length) {
        warnings.push(`${hostname}: missing extraction.selectors.${f}`);
      }
    }
  }
  if (siteConfig.excludeUrlPatterns && !Array.isArray(siteConfig.excludeUrlPatterns)) {
    warnings.push(`${hostname}: excludeUrlPatterns must be an array`);
  }
  return warnings;
}

export function getSiteConfig(url) {
  const hostname = extractHostname(url);
  if (!hostname) return { ...DEFAULTS };
  if (configCache.has(hostname)) return configCache.get(hostname);
  const raw = loadSiteConfig(hostname);
  const merged = mergeConfig(raw);
  configCache.set(hostname, merged);
  return merged;
}

export function getSearchUrl(baseUrl, keyword, page = 1, siteConfig) {
  const cfg = siteConfig || getSiteConfig(baseUrl);
  const { endpoint, param, pageParam, urlTemplate } = cfg.search;
  const kw = encodeURIComponent(keyword.trim());

  if (urlTemplate) {
    const base = urlTemplate
      .replace("{keyword}", kw)
      .replace("{baseUrl}", baseUrl.replace(/\/+$/, ""))
      .replace("{page}", String(page));
    return base;
  }

  const base = `${baseUrl.replace(/\/+$/, "")}${endpoint}?${param}=${kw}`;
  return page > 1 ? `${base}&${pageParam}=${page}` : base;
}

export function getAdIdPattern(siteConfig) {
  const pattern = siteConfig?.extraction?.adIdPattern;
  if (!pattern) return null;
  return new RegExp(pattern);
}

export function clearSiteConfigCache() {
  configCache.clear();
}
