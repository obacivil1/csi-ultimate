import { JSDOM } from "jsdom";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const g = async (u) => await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });

const r = await g("https://gulfclassifieds.org/");
const d = new JSDOM(await r.text()).window.document;
const item = [...d.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "")
  .find((x) => /\/item\/[^/]+-\d+\.html$/.test(x.replace("https://gulfclassifieds.org", "")));
const j = await g(item);
const dd = new JSDOM(await j.text()).window.document;

const detailEl = dd.querySelector("[class*='details']");
console.log("details block tag:", detailEl?.tagName, "classes:", detailEl?.className?.slice(0, 80));
const titleCandidates = detailEl ? [...detailEl.querySelectorAll("h1,h2,h3,.title,[class*=title],span,strong,p,a")].slice(0, 12) : [];
titleCandidates.forEach((el, i) => console.log(`  [${i}] ${el.tagName}.${(el.className + "").slice(0, 30)} ${el.textContent.replace(/\s+/g, " ").trim().slice(0, 45)}`));

const priceEl = dd.querySelector("[class*='price']");
console.log("price tag/classes:", priceEl?.tagName, priceEl?.className?.slice(0, 60));

const catLinks = [...d.querySelectorAll("a[href]")].map((a) => ({ href: a.getAttribute("href"), txt: (a.textContent || "").trim().slice(0, 30) }))
  .filter((x) => x.href && !/item|post\/|page\/|yellow|login|register|/i.test(x.href.replace(x.href.split("#")[0], "")) && /\/(uae|dubai|saudi|jobs|cars|property)\b/i.test(x.href))
  .slice(0, 15);
console.log("\ncategory nav links:");
catLinks.forEach((c) => console.log("  ", c.href.slice(0, 70), "|", c.txt));