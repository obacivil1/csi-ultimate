import { JSDOM } from "jsdom";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const g = async (u) => await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });

const r = await g("https://gulfclassifieds.org/");
const d = new JSDOM(await r.text()).window.document;
const item = [...d.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "")
  .find((x) => /\/item\/[^/]+-\d+\.html$/.test(x.replace("https://gulfclassifieds.org", "")));
console.log("url:", item);
const j = await g(item);
const ht = await j.text();
console.log("status", j.status, "len", Math.round(ht.length / 1024), "KB");
const dd = new JSDOM(ht).window.document;
console.log("title:", (dd.querySelector("title")?.textContent || "").trim().slice(0, 60));
for (const s of ["h1", "[class*=price]", "[class*=salary]", "[class*=description]", "[class*=details]",
  "[class*=location]", "[class*=contact]", "[class*=posted],[class*=date]", ".b-popup", "[class*=share]"]) {
  const e = dd.querySelector(s);
  if (e) console.log(" ", s, "=", e.textContent.replace(/\s+/g, " ").trim().slice(0, 60));
} 
console.log("tel:", dd.querySelector("a[href*='tel:']")?.getAttribute("href"));
console.log("mailto:", dd.querySelector("a[href*='mailto:']")?.getAttribute("href"));
console.log("breadcrumb:", (dd.querySelector(".breadcrumb, [class*=breadcrumb]")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60));