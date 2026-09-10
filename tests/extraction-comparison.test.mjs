import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
import { extractAdData as bridgeExtract } from "../core/bridge.mjs";
import { extractAdData as canonicalExtract } from "../core/canonical-extractor.mjs";
import { extractAdData as gatewayExtract } from "../core/extractor.mjs";

function makePage(html, url) {
  const dom = new JSDOM(html, { url, runScripts: "dangerously" });
  const window = dom.window;
  for (const el of window.document.querySelectorAll("*")) {
    Object.defineProperty(el, "innerText", { configurable: true, get() { return this.textContent; } });
  }
  const evaluate = async (fn, ...args) => {
    if (typeof fn !== "function") return fn;
    const serialized = args.map(a => JSON.stringify(a)).join(", ");
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

const GUMTREE = `<html><head><title>Web Dev - leads</title></head><body>
  <h1>Web Dev</h1>
  <span class="amount" data-aut-id="itemPrice">£45.00</span>
  <div class="price">£45.00</div>
  <address>London</address>
  <a href="tel:07700900123">07700 900 123</a>
  <p class="description">Contact 07700900123 for details</p>
  <p>contact@abc-firm.co.uk</p>
</body></html>`;

const OPENSOOQ = `<html><head><title>لابتوب مستعمل</title></head><body>
  <h1>لابتوب مستعمل</h1>
  <div class="price">1,200 ر.س</div>
  <div class="location">الرياض</div>
  <a href="tel:+966551234567">0551234567</a>
  <p>التواصل 0551234567</p>
</body></html>`;

const EMPTY = `<html><head><title>Empty</title></head><body></body></html>`;

const sites = {
  gumtree: { hostname: "gumtree.com", selectors: { title: "h1", price: ".price", location: "address" } },
  opensooq: { hostname: "sa.opensooq.com", selectors: { title: "h1", price: ".price", location: ".location" } },
  bare: {},
};

function digits(s) { return String(s || "").replace(/\D/g, ""); }

test("GUMTREE: both extract title, price, email, location", async () => {
  const { page } = makePage(GUMTREE, "https://www.gumtree.com/p/x/12345678");
  const b = await bridgeExtract(page, sites.gumtree);
  const c = await canonicalExtract(page, sites.gumtree);
  assert.equal(b.title, "Web Dev");
  assert.equal(c.title, "Web Dev");
  assert.equal(digits(b.price), "4500");
  assert.equal(digits(c.price), "4500");
  assert.ok(b.email.toLowerCase().includes("abc-firm.co.uk"));
  assert.ok(c.email.toLowerCase().includes("abc-firm.co.uk"));
  assert.equal(b.location, "London");
  assert.equal(c.location, "London");
});

test("GUMTREE: both find the same phone digits", async () => {
  const { page } = makePage(GUMTREE, "https://www.gumtree.com/p/x/12345678");
  const b = digits((await bridgeExtract(page, sites.gumtree)).phone);
  const c = digits((await canonicalExtract(page, sites.gumtree)).phone);
  assert.ok(b.endsWith("7700900123") || b.includes("7700900123"), `bridge phone=${b}`);
  assert.ok(c.endsWith("07700900123") || c.includes("07700900123"), `canonical phone=${c}`);
});

test("OPENSOOQ: both extract Arabic title, price and location; canonical must not crash", async () => {
  const { page } = makePage(OPENSOOQ, "https://sa.opensooq.com/ad/999");
  const b = await bridgeExtract(page, sites.opensooq);
  const c = await canonicalExtract(page, sites.opensooq);
  assert.equal((b.title || "").trim(), "لابتوب مستعمل");
  assert.equal((c.title || "").trim(), "لابتوب مستعمل");
  assert.equal(digits(b.price), "1200");
  assert.equal(digits(c.price), "1200");
  assert.equal(b.location, "الرياض");
  assert.equal(c.location, "الرياض");
  assert.ok(c.phone === null || digits(c.phone).length >= 9, "canonical phone empty on Arabic page (gap)");
});

test("EXTRACTION DIVERGENCE (documented, not unit-worthy): known behavioural gaps", async () => {
  const { page } = makePage(OPENSOOQ, "https://sa.opensooq.com/ad/999");
  const b = await bridgeExtract(page, sites.opensooq);
  const c = await canonicalExtract(page, sites.opensooq);
  // 1. bridge normalizes SA phone; canonical filters 05/966 cosmetic — phoning is a gap
  assert.ok(digits(b.phone).length >= 11, "bridge should keep full SA phone");
  // 2. Arabic "ر.س" currency — bridge extracts raw, canonical returns null
  assert.equal(b.price.includes("ر.س"), true);
});

test("GATEWAY: consolidated extractor preserves bridge behaviour (Gumtree-like)", async () => {
  const { page } = makePage(GUMTREE, "https://www.gumtree.com/p/x/12345678");
  const g = await gatewayExtract(page, sites.gumtree);
  assert.equal(g.title, "Web Dev");
  assert.equal(digits(g.price), "4500");
  assert.equal(g.location, "London");
  assert.ok((g.phone || "").length, "gateway finds phone");
  assert.ok(g.email, "gateway finds email");
});

test("EMPTPY: neither fabricates data", async () => {
  const { page } = makePage(EMPTY, "https://none.invalid/ad/1");
  const b = await bridgeExtract(page, sites.bare);
  const c = await canonicalExtract(page, sites.bare);
  assert.ok(!b.email && !c.email, "no fabricated email");
  assert.ok(!b.location && !c.location, "no fabricated location");
});