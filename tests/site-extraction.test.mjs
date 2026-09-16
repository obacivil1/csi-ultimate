import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
import { extractAdData as extractor } from "../core/extractor.mjs";
import { getSiteConfig } from "../core/site-adapter.mjs";
import { toCanonical, CANONICAL_KEYS } from "../core/canonical-extractor.mjs";

function makePage(html, url) {
  const dom = new JSDOM(html, { url, runScripts: "dangerously" });
  const window = dom.window;
  for (const el of window.document.querySelectorAll("*")) {
    Object.defineProperty(el, "innerText", { configurable: true, get() { return this.textContent; } });
  }
  const evaluate = async (fn, ...args) => {
    if (typeof fn !== "function") return fn;
    const serialized = args.map((a) => JSON.stringify(a)).join(", ");
    return window.eval("(" + fn.toString() + ")(" + serialized + ")");
  };
  const page = {
    evaluate,
    url: () => url,
    $$eval: async () => [],
    waitForFunction: async () => { throw new Error("NOT_IMPLEMENTED"); },
    waitForTimeout: async () => {},
  };
  return { page, document: window.document, window };
}

function digits(s) { return String(s || "").replace(/\D/g, ""); }

test("D9: canonical extractor does not gluing a 10-digit phone with a trailing standalone digit", async () => {
  const html = `<html><head><title>Web Dev - leads</title></head><body>
    <h1 data-q="vip-title">Web Dev</h1>
    <span data-q="ad-price">£45.00</span>
    <div data-q="ad-location">London</div>
    <p>07700 900123 8 — near station</p>
  </body></html>`;
  const { page } = makePage(html, "https://www.gumtree.com/p/x/12345678");
  const cfg = await getSiteConfig("www.gumtree.com");
  const rec = await extractor(page, cfg);
  assert.equal(digits(rec.phone), "07700900123", `D9: merged phone=${rec.phone}`);
});

// Realistic simplified ad-page fixtures, kept aligned with each adapter's selectors.
const FIXTURES = {
  "sa.opensooq.com": {
    url: "https://sa.opensooq.com/en/search/12345-laptop",
    html: `<html><head><title>لابتوب مستعمل</title></head><body>
      <h1>لابتوب مستعمل</h1>
      <div class="detail"><div class="price">1,200 ر.س</div></div>
      <div class="location">الرياض</div>
      <a href="tel:+966551234567">0551234567</a>
      <a href="mailto:seller@opensooq-mail.com">إرسال</a>
    </body></html>`,
    expect: { title: "لابتوب مستعمل", priceDigits: "1200", location: "الرياض", emailIncludes: "opensooq-mail.com", minPhoneDigits: 11 },
  },
  "gumtree.com": {
    url: "https://www.gumtree.com/p/x/12345678",
    html: `<html><head><title>Web Dev - leads</title></head><body>
      <h1 data-q="vip-title">Web Dev</h1>
      <span data-q="ad-price">£45.00</span>
      <div data-q="ad-location">London</div>
      <a href="tel:07700900123">07700 900 123</a>
      <p>contact@abc-firm.co.uk</p>
    </body></html>`,
    expect: { title: "Web Dev", priceDigits: "4500", location: "London", emailIncludes: "abc-firm.co.uk", phoneIncludes: "07700900123" },
  },
  "london.craigslist.org": {
    url: "https://london.craigslist.org/apa/d/1234.html",
    html: `<html><head><title>MacBook Pro 16</title></head><body>
      <h1>MacBook Pro 16</h1>
      <span class="price">£950</span>
      <div class="postinglocation">Kensington</div>
      <a href="tel:+447700900123">07700 900123</a>
    </body></html>`,
    expect: { title: "MacBook Pro 16", priceDigits: "950", location: "Kensington", phoneIncludes: "7700900123" },
  },
  "olx.com.pk": {
    url: "https://www.olx.com.pk/ad/honda-2015-ID1234.html",
    html: `<html><head><title>Honda City 2015</title></head><body>
      <h1>Honda City 2015</h1>
      <span class="_24469da7">PKR 1,750,000</span>
      <span class="_8206696c">Karachi</span>
      <a href="tel:+923001234567">0300 1234567</a>
    </body></html>`,
    expect: { title: "Honda City 2015", priceDigits: "1750000", location: "Karachi", phoneIncludes: "3001234567" },
  },
  "preloved.co.uk": {
    url: "https://www.preloved.co.uk/ads/9876543",
    html: `<html><head><title>Wooden Desk</title></head><body>
      <h1>Wooden Desk</h1>
      <span class="classified__price">£35</span>
      <div class="classified__location">Leeds</div>
      <a href="tel:+447700900000">07700 900000</a>
    </body></html>`,
    expect: { title: "Wooden Desk", priceDigits: "35", location: "Leeds", phoneDigitsEnd: "447700900000" },
  },
  "expatriates.com": {
    url: "https://www.expatriates.com/listing/77777",
    html: `<html><head><title>Planning Engineer job</title></head><body>
      <h1>Senior Planning Engineer</h1>
      <div class="salary">SAR 25,000</div>
      <div class="location">Riyadh</div>
      <a href="tel:+966512345678">0512345678</a>
    </body></html>`,
    expect: { title: "Senior Planning Engineer", priceDigits: "25000", location: "Riyadh", minPhoneDigits: 11 },
  },
  "gulfclassifieds.org": {
    url: "https://gulfclassifieds.org/item/human-resources-manager-required-in-dubai-225599.html",
    html: `<html><head><title>Human Resources Manager Required in Dubai - Dubai - Gulf Classifieds</title></head><body>
      <div class="item_details">
        <h1>Human Resources Manager Required in Dubai</h1>
        <span class="small_text">Dubai</span>
        <span class="label_text green small">Featured</span>
        <p class="description">We are hiring an experienced HR manager for our Dubai office.</p>
      </div>
      <span class="price">AED 8,900</span>
      <a href="tel:+971501234567">050 123 4567</a>
      <a href="mailto:hr@firm.ae">contact</a>
    </body></html>`,
    expect: { title: "Human Resources Manager Required in Dubai", priceDigits: "8900", location: "Dubai", emailIncludes: "firm.ae", phoneIncludes: "501234567" },
  },
};

for (const [hostname, fx] of Object.entries(FIXTURES)) {
  test(`per-site extraction: ${hostname} adapter extracts a realistic ad page`, async () => {
    const cfg = getSiteConfig("https://" + hostname + "/x");
    cfg.hostname = hostname;
    const { page } = makePage(fx.html, fx.url);
    const rec = await extractor(page, cfg);

    assert.ok(rec, `${hostname}: extraction returned a record`);
    assert.equal(rec.title, fx.expect.title, `${hostname}: title`);

    const priceDigits = digits(rec.price);
    assert.equal(priceDigits, fx.expect.priceDigits, `${hostname}: price "${rec.price}" -> ${priceDigits}`);

    if (fx.expect.location) assert.equal(rec.location, fx.expect.location, `${hostname}: location`);
    if (fx.expect.emailIncludes) assert.ok(rec.email && String(rec.email).includes(fx.expect.emailIncludes), `${hostname}: email ${rec.email}`);
    if (fx.expect.phoneIncludes) assert.ok(String(rec.phone || "").includes(fx.expect.phoneIncludes), `${hostname}: phone ${rec.phone}`);
    if (fx.expect.phoneDigitsEnd) assert.ok(digits(rec.phone).endsWith(fx.expect.phoneDigitsEnd), `${hostname}: ${rec.phone} ends with ${fx.expect.phoneDigitsEnd}`);
    if (fx.expect.minPhoneDigits) assert.ok(digits(rec.phone).length >= fx.expect.minPhoneDigits, `${hostname}: phone ${rec.phone} has enough digits`);

    assert.ok(rec.url || fx.url, `${hostname}: record carries url`);
  });

  test(`per-site canonical {hostname}: record maps into canonical shape`, async () => {
    const cfg = getSiteConfig("https://" + hostname + "/x");
    cfg.hostname = hostname;
    const { page } = makePage(fx.html, fx.url);
    const rec = await extractor(page, cfg);
    const canon = toCanonical(rec, hostname, "Jobs");
    for (const key of CANONICAL_KEYS) assert.ok(key in canon, `${hostname}: canonical has ${key}`);
    assert.equal(canon.title, fx.expect.title, `${hostname}: canonical title`);
  });
}

test("per-site extraction: empty page never fabricates contacts", async () => {
  for (const hostname of Object.keys(FIXTURES)) {
    const cfg = getSiteConfig("https://" + hostname + "/x");
    cfg.hostname = hostname;
    const { page } = makePage("<html><head><title>none</title></head><body></body></html>", "https://" + hostname + "/ad/0");
    const rec = await extractor(page, cfg);
    assert.ok(!rec.email || rec.email === "N/A", `${hostname}: no fabricated email (got ${rec.email})`);
    assert.ok(!rec.phone, `${hostname}: no fabricated phone (got ${rec.phone})`);
  }
});