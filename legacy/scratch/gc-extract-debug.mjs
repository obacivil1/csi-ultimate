import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
import { extractAdData as extractor } from "../../core/extractor.mjs";
import { getSiteConfig } from "../../core/site-adapter.mjs";

const url = "https://gulfclassifieds.org/item/human-resources-manager-required-in-dubai-225599.html";
const html = `<html><head><title>Human Resources Manager Required in Dubai - Dubai - Gulf Classifieds</title></head><body>
  <div class="item_details"><h1>Human Resources Manager Required in Dubai</h1>
    <span class="small_text">Dubai</span>
    <p class="description">We are hiring an experienced HR manager for our Dubai office.</p></div>
  <span class="price">AED 8,900</span>
  <a href="tel:+971501234567">050 123 4567</a>
  <a href="mailto:hr@firm.ae">contact</a>
</body></html>`;

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
const page = { evaluate, url: () => url, $$eval: async () => [], waitForFunction: async () => { throw new Error("X"); }, waitForTimeout: async () => {} };

const tel = dom.window.document.querySelector("a[href^='tel:']");
console.log("tel href attr:", tel.getAttribute("href"));
console.log("tel .href:", tel.href);
console.log("tel hrefScheme? :", JSON.stringify(tel.href));

const cfg = getSiteConfig("https://gulfclassifieds.org/x");
cfg.hostname = "gulfclassifieds.org";
const rec = await extractor(page, cfg);
console.log("record:", JSON.stringify(rec, null, 1));