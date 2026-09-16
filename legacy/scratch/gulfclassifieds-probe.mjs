import { JSDOM } from "jsdom";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

async function getHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  return { status: res.status, html: await res.text(), finalUrl: res.url };
}

const listing = await getHtml("https://gulfclassifieds.org/");
if (listing.status !== 200) { console.log("listing:", listing.status); process.exit(1); }
const doc = new JSDOM(listing.html).window.document;
const hrefs = [...doc.querySelectorAll("a[href]")]
  .map((a) => a.getAttribute("href") || "")
  .filter((h) => /^\/item\/[^/]+-\d+\.html$/.test(h));
const ids = hrefs.map((h) => h.match(/(\d+)\.html$/)[1]);
console.log("detail links:", hrefs.length, "ids unique:", [...new Set(ids)].length);
console.log("samples:", hrefs.slice(0, 3).join("\n  "));
const pagination = [...doc.querySelectorAll("a[href]")]
  .map((a) => a.getAttribute("href") || "")
  .filter((h) => /page|search\[|\?|sortedby|p=\d|c=\d/.test(h)).slice(0, 6);
console.log("pagination-ish:", JSON.stringify(pagination, null, 1).slice(0, 400));

const one = hrefs[0] ? "https://gulfclassifieds.org" + hrefs[0] : "";
if (!one) { console.log("no detail link on homepage"); process.exit(1); }
const j = await getHtml(one);
console.log("\ndetail status:", j.status, "finalUrl:", j.finalUrl.replace("https://gulfclassifieds.org", "").slice(0, 60));
console.log("len:", (j.html.length / 1024).toFixed(1), "KB");
const d = new JSDOM(j.html).window.document;
const t = d.querySelector("title")?.textContent?.trim();
console.log("title tag:", t?.slice(0, 70));
console.log("h1:", d.querySelector("h1")?.textContent?.trim()?.slice(0, 70));
for (const sel of ["[class*='price']", ".price", "[class*='salary']", "[class*='description']", "[class*='details']", "[class*='content'] article", "article"]) {
  const el = d.querySelector(sel);
  if (el) console.log(`  ${sel}:`, el.textContent.replace(/\s+/g, " ").trim().slice(0, 60));
}
console.log("tel:", d.querySelector("a[href^='tel:']")?.getAttribute("href"));
console.log("mailto:", d.querySelector("a[href^='mailto:']")?.getAttribute("href"));
console.log("time:", d.querySelector("time")?.textContent?.trim()?.slice(0, 40));
console.log("[class*='location']:", d.querySelector("[class*='location']")?.textContent?.trim()?.slice(0, 40));
console.log("[class*='contact']:", d.querySelector("[class*='contact']")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 80));
const bodyWords = d.body.textContent.length;
console.log("body text chars:", bodyWords);
const bodySample = d.body.textContent.replace(/\s+/g, " ").trim().slice(0, 300);
console.log("body snippet:", bodySample);