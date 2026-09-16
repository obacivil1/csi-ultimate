import { JSDOM } from "jsdom";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const BLOCK = /just a moment|attention required|checking your browser|access denied|enable javascript|challenge-platform|cf-chl/i;

async function getHtml(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    return { status: res.status, html: await res.text() };
  } catch (e) {
    return { status: 0, html: "", error: e.message };
  }
}

async function probe(name, base, listPaths) {
  console.log(`\n===== ${name} (${base}) =====`);
  const paths = listPaths || [""];
  let listing = null;
  for (const p of paths) {
    const r = await getHtml(base + p);
    if (r.status === 200 && !BLOCK.test(r.html)) { listing = r; console.log(`  listing ${p || "/"}: 200 (${(r.html.length / 1024).toFixed(0)}KB)`); break; }
    console.log(`  listing ${p || "/"}: ${r.status} blocked=${BLOCK.test(r.html || "")} ${r.error || ""}`);
  }
  if (!listing) { console.log("  -> no fetchable listing"); return; }
  const doc = new JSDOM(listing.html).window.document;
  console.log("  title:", doc.querySelector("title")?.textContent?.trim()?.slice(0, 60));
  const hrefs = [...doc.querySelectorAll("a[href]")].map((a) => new URL(a.getAttribute("href"), base).href)
    .filter((h) => h.startsWith("https://"))
    .filter((h) => /(?:^|\/)(?:ad|advertisement|classified|item|listing|details?)\//i.test(new URL(h).pathname) || /\d{4,}/.test(new URL(h).pathname));
  const uniq = [...new Set(hrefs)];
  console.log("  candidate detail urls:", uniq.length);
  uniq.slice(0, 3).forEach((u) => console.log("    -", u.replace(base, "").slice(0, 80)));
  const sample = uniq[0];
  if (!sample) { console.log("  -> no detail links found"); return; }
  const j = await getHtml(sample);
  if (j.status !== 200 || BLOCK.test(j.html)) { console.log(`  detail: ${j.status} blocked=${BLOCK.test(j.html || "")}`); return; }
  const d = new JSDOM(j.html).window.document;
  const tel = d.querySelector("a[href^='tel:']")?.getAttribute("href");
  const mail = d.querySelector("a[href^='mailto:']")?.getAttribute("href");
  console.log("  detail title:", d.querySelector("title")?.textContent?.trim()?.slice(0, 60));
  console.log("  h1:", d.querySelector("h1")?.textContent?.trim()?.slice(0, 50));
  console.log("  [class*='price']/salary:", (d.querySelector("[class*='price'],[class*='salary']")?.textContent || "").trim().slice(0, 50));
  console.log("  [class*='description']/details:", (d.querySelector("[class*='description'],[class*='details'],[class*='content']")?.textContent || "").trim().slice(0, 50));
  console.log("  tel:", tel, " mailto:", mail);
  const metaPub = d.querySelector("[class*='contact']");
  console.log("  contact block:", !!metaPub);
}

await probe("waseet.com (السعودية)", "https://waseet.com", ["", "/ar", "/en"]);
await probe("gulfclassifieds.org", "https://gulfclassifieds.org", ["", "/en"]);
await probe("qa.opensooq.com", "https://qa.opensooq.com", ["/en"]);
await probe("eg.opensooq.com", "https://eg.opensooq.com", ["/en"]);
await probe("bh.opensooq.com", "https://bh.opensooq.com", ["/en"]);
await probe("kw.opensooq.com", "https://kw.opensooq.com", ["/en"]);