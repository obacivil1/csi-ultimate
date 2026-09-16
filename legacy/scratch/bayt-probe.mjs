import { JSDOM } from "jsdom";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

async function getHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow" });
  return { status: res.status, html: await res.text() };
}

const blocked = (html) => /just a moment|attention required|checking your browser|access denied|enable javascript|challenge-platform/i.test(html);

const listing = await getHtml("https://www.bayt.com/en/saudi-arabia/jobs/");
const dom = new JSDOM(listing.html);
const doc = dom.window.document;
console.log("listing status:", listing.status, "blocked:", blocked(listing.html));
console.log("listing title:", doc.querySelector("title")?.textContent?.trim());
const adLinks = [...doc.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "")
  .filter((h) => /^https:\/\/www\.bayt\.com\/en\/[a-z-]+\/jobs\/[^/]+-\d+\/$/.test(h));
console.log("matching ad links:", adLinks.length);
console.log("first 4:", JSON.stringify(adLinks.slice(0, 4), null, 1));
const anyJob = [...doc.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "")
  .find((h) => /^https:\/\/www\.bayt\.com\/en\/[a-z-]+\/jobs\/[^/]+-\d+\/$/.test(h));
if (anyJob) {
  const j = await getHtml(anyJob);
  const jd = new JSDOM(j.html);
  const jdoc = jd.window.document;
  console.log("\njob status:", j.status, "blocked:", blocked(j.html), "len:", j.html.length);
  console.log("job title:", jdoc.querySelector("title")?.textContent?.trim());
  const probe = {
    "h1": jdoc.querySelector("h1")?.textContent?.trim()?.slice(0, 60),
    "h2#job_title": jdoc.querySelector("h2#job_title")?.textContent?.trim()?.slice(0, 60),
    "[class*='job-title']": jdoc.querySelector("[class*='job-title']")?.textContent?.trim()?.slice(0, 60),
    "[class*='job-description']": !!jdoc.querySelector("[class*='job-description']"),
    ".t-regular": jdoc.querySelector(".t-regular")?.textContent?.trim()?.slice(0, 60),
    "[class*='location']": jdoc.querySelector("[class*='location']")?.textContent?.trim()?.slice(0, 60),
    "[class*='salary']": jdoc.querySelector("[class*='salary']")?.textContent?.trim()?.slice(0, 60),
    "time": jdoc.querySelector("time")?.textContent?.trim()?.slice(0, 40),
    "mailto": !!jdoc.querySelector("a[href^='mailto:']"),
    "tel": jdoc.querySelector("a[href^='tel:']")?.getAttribute("href"),
    "company": jdoc.querySelector("[class*='company']")?.textContent?.trim()?.slice(0, 60),
  };
  console.log("job DOM:"); console.log(JSON.stringify(probe, null, 1));
}