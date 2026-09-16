/**
 * scripts/scratch/hawkers-page.mjs — fetch a Hawkers product page and extract
 * the full design system: rendered HTML, all CSS, fonts, colors, layout.
 * Outputs to state/hawkers/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPage, navigateWithRetry } from "../../core/anti-detect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../state/hawkers");
fs.mkdirSync(OUT, { recursive: true });

const URL = process.argv[2] || "https://www.hawkersco.com/eu/blue-light/hawkers-x-paula-echevarria---jam-bb-HJAM24CBXE.html";

const { page, browser } = await createPage({ headless: true });
// don't block assets — we want fonts/images/css to load for real design capture
try { await page.unroute("**/*.{png,jpg,jpeg,gif,svg,ico,webp,avif,woff,woff2,ttf,eot}"); } catch {}

const assets = [];
page.on("response", async (res) => {
  const u = res.url();
  const ct = (res.headers()["content-type"] || "").toLowerCase();
  if (/\.(css|woff2?|ttf|otf|eot)(\?|$)/i.test(u) || ct.includes("css") || ct.includes("font")) {
    assets.push({ url: u, type: ct, status: res.status() });
  }
});

let html = "", cssText = "";
try {
  await navigateWithRetry(page, URL, 2, false);
  await page.waitForTimeout(4000);
  // scroll to trigger lazy sections
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(500); }
  await page.waitForTimeout(2500);

  html = await page.content();

  const report = await page.evaluate(() => {
    const uniq = (a) => [...new Set(a.filter(Boolean))];
    const all = [...document.querySelectorAll("body *")];
    const fonts = uniq(all.map(el => getComputedStyle(el).fontFamily)).slice(0, 40);
    const colors = uniq(all.map(el => getComputedStyle(el).color));
    const bgs = uniq(all.map(el => getComputedStyle(el).backgroundColor)).filter(c => c !== "rgba(0, 0, 0, 0)");
    const sizes = uniq(all.map(el => getComputedStyle(el).fontSize)).slice(0, 40);
    const weights = uniq(all.map(el => getComputedStyle(el).fontWeight)).sort();
    // representative elements
    const pick = {};
    const sel = {
      body: "body",
      header: "header",
      nav: "nav",
      h1: "h1",
      h2: "h2",
      productTitle: "[class*='product'] h1, h1[class*='title'], [class*='product-title']",
      price: "[class*='price']",
      button: "button, [class*='btn'], a[class*='button']",
      hero: "[class*='hero'], [class*='banner'], [class*='Hero']",
      img: "img",
      container: "[class*='container']",
    };
    for (const [k, s] of Object.entries(sel)) {
      const el = document.querySelector(s);
      if (!el) { pick[k] = null; continue; }
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      pick[k] = {
        tag: el.tagName,
        cls: (el.className || "").toString().slice(0, 120),
        fontFamily: c.fontFamily, fontSize: c.fontSize, fontWeight: c.fontWeight,
        lineHeight: c.lineHeight, letterSpacing: c.letterSpacing, textTransform: c.textTransform,
        color: c.color, background: c.backgroundColor, borderRadius: c.borderRadius,
        display: c.display, gridTemplateColumns: c.gridTemplateColumns, gap: c.gap,
        maxWidth: c.maxWidth, padding: c.padding, margin: c.margin,
        width: Math.round(r.width), height: Math.round(r.height),
      };
    }
    // inline <style>
    const inlineStyles = [...document.querySelectorAll("style")].map(s => s.textContent || "").join("\n/*---*/\n");
    // stylesheet hrefs
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href);
    // font-faces declared
    const ff = [];
    try { document.fonts.forEach(f => ff.push({ family: f.family, weight: f.weight, style: f.style, status: f.status })); } catch {}
    // section outline
    const outline = [...document.querySelectorAll("header, main > *, section, footer")].slice(0, 60).map(el => ({
      tag: el.tagName, cls: (el.className || "").toString().slice(0, 90),
      h: Math.round(el.getBoundingClientRect().height),
      text: (el.innerText || "").replace(/\s+/g, " ").slice(0, 80),
    }));
    return { title: document.title, fonts, colors, bgs, sizes, weights, pick, links, inlineStyles, fontFaces: ff, outline, bodyClass: document.body.className, htmlLang: document.documentElement.lang };
  });

  fs.writeFileSync(path.join(OUT, "hawkers-page.html"), html);
  cssText = report.inlineStyles || "";
  fs.writeFileSync(path.join(OUT, "hawkers-inline.css"), cssText);
  fs.writeFileSync(path.join(OUT, "hawkers-design.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, "hawkers-assets.json"), JSON.stringify(assets, null, 2));

  await page.screenshot({ path: path.join(OUT, "hawkers-full.png"), fullPage: true }).catch(() => {});
  await page.screenshot({ path: path.join(OUT, "hawkers-viewport.png"), fullPage: false }).catch(() => {});

  console.log("TITLE:", report.title);
  console.log("LANG:", report.htmlLang, "| BODY:", report.bodyClass);
  console.log("\nFONT FAMILIES:");
  for (const f of report.fonts) console.log("  " + f);
  console.log("\nFONT FACES:");
  for (const f of report.fontFaces) console.log("  " + JSON.stringify(f));
  console.log("\nSIZES:", report.sizes.join(", "));
  console.log("WEIGHTS:", report.weights.join(", "));
  console.log("\nCOLORS:", report.colors.slice(0, 25).join(" | "));
  console.log("\nBACKGROUNDS:", report.bgs.slice(0, 25).join(" | "));
  console.log("\nKEY ELEMENTS:");
  for (const [k, v] of Object.entries(report.pick)) console.log("  " + k + ": " + (v ? JSON.stringify(v) : "—"));
  console.log("\nSECTION OUTLINE:");
  report.outline.forEach((o, i) => console.log(`  ${i}: ${o.tag}.${o.cls} h=${o.h} :: ${o.text}`));
  console.log("\nASSETS:", assets.length);
  for (const a of assets.slice(0, 30)) console.log("  " + a.status + " " + a.type + " " + a.url.slice(0, 120));
} catch (e) {
  console.log("ERROR:", e.message);
} finally {
  await browser.close();
}
console.log("\nSaved to", OUT);
