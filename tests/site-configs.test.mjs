import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSiteConfig, getSearchUrl, validateSiteConfig, getAdIdPattern } from "../core/site-adapter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITES_DIR = path.resolve(__dirname, "..", "config", "sites");

const files = fs.readdirSync(SITES_DIR).filter((f) => f.endsWith(".json"));
assert.ok(files.length >= 5, `expected site configs, found ${files.length}: ${files.join(", ")}`);
const hostnames = files.map((f) => f.replace(/\.json$/, ""));

for (const hostname of hostnames) {
  test(`site config ${hostname}: loads, validates and merges defaults`, () => {
    const cfg = getSiteConfig("https://" + hostname + "/x");
    assert.ok(cfg, "config present");
    assert.ok(Array.isArray(cfg.extraction?.selectors?.title) && cfg.extraction.selectors.title.length, "merged title selectors");
    assert.ok(Array.isArray(cfg.extraction?.selectors?.phone) && cfg.extraction.selectors.phone.length, "merged phone selectors");
    assert.ok(Array.isArray(cfg.extraction?.selectors?.email), "merged email selectors");
    const warnings = validateSiteConfig(cfg, hostname);
    assert.deepEqual(warnings, [], `validateSiteConfig warnings: ${warnings.join("; ")}`);
  });

  test(`site config ${hostname}: search URL builder produces encoded query`, () => {
    const cfg = getSiteConfig("https://" + hostname + "/x");
    const url = getSearchUrl("https://" + hostname, "civil engineer", 1, cfg);
    assert.ok(url.startsWith("https://" + hostname), `url starts with base: ${url}`);
    assert.match(url, /civil%20engineer|engineer/, `keyword encoded in: ${url}`);
  });

  test(`site config ${hostname}: ad-id pattern compiles (if set)`, () => {
    const cfg = getSiteConfig("https://" + hostname + "/x");
    const re = getAdIdPattern(cfg);
    if (re) {
      assert.ok(re instanceof RegExp, "adIdPattern is a RegExp");
      const sample = { "sa.opensooq.com": "/en/search/123", "expatriates.com": "/cls/456" }[hostname];
      if (sample) assert.ok(re.test("https://" + hostname + sample), `pattern matches sample ${sample}`);
    }
  });

  test(`site config ${hostname}: region/currency/country fields coherent`, () => {
    const cfg = getSiteConfig("https://" + hostname + "/x");
    const region = cfg.extraction?.phoneRegion;
    const codes = cfg.extraction?.countryCodes || [];
    const currencies = cfg.extraction?.currencies || [];
    if (region) assert.ok(typeof region === "string" && region.length > 0, "phoneRegion non-empty string");
    if (codes.length) assert.ok(codes.every((n) => (typeof n === "string" ? /^\d+$/.test(n) : Number.isInteger(n) && n > 0)), "countryCodes are country-call codes");
    if (currencies.length) assert.ok(currencies.every((c) => typeof c === "string" && c.length === 3), "currencies are 3-letter ISO codes");
    const regionToCode = { SA: 966, GCC: 966, UK: 44, PK: 92 };
    if (region && regionToCode[region] && codes.length) {
      assert.ok(codes.map(Number).includes(regionToCode[region]), `${hostname}: region ${region} implies ${regionToCode[region]} in countryCodes`);
    }
  });
}

test("site config: every adapter defines search.param or search.urlTemplate", () => {
  for (const hostname of hostnames) {
    const cfg = getSiteConfig("https://" + hostname + "/x");
    assert.ok(cfg.search?.param || cfg.search?.urlTemplate, `${hostname}: has search.param or search.urlTemplate`);
  }
});