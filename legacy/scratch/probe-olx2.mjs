import { createPool } from "../core/browser-pool.mjs";

const { browser, pool } = await createPool({ maxBrowsers: 1 });

async function probeOlxProduct() {
  console.log("\n=== PROBE: OLX product listing ===\n");
  
  // Try a product that actually has a price - a car for sale
  const urls = [
    "https://www.olx.com.pk/item/honda-city-2021-total-genuine-iid-1114395639",
    "https://www.olx.com.pk/item/toyota-corolla-altis-2014-iid-1115457597",
    "https://www.olx.com.pk/item/electric-heated-travel-mug-for-cars-iid-ev270837-1",
  ];
  
  for (const url of urls) {
    console.log(`\n--- URL: ${url} ---`);
    try {
      const info = await pool.withPage(async (page) => {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(2000);
        
        // Check for Cloudflare/error
        const title = await page.title();
        const bodyText = await page.evaluate(() => document.body.innerText?.slice(0, 500) || "");
        
        if (title.includes("Access denied") || title.includes("Error") || bodyText.includes("Access denied")) {
          return {
            pageTitle: title,
            status: "BLOCKED",
            bodyPreview: bodyText.slice(0, 300)
          };
        }
        
        return await page.evaluate(() => {
          // Price: text search first
          const bt = document.body.innerText || "";
          const anyPrice = bt.match(/Rs\s*[0-9,]+\s*/);
          const priceAround = anyPrice ? bt.slice(Math.max(0, anyPrice.index - 40), anyPrice.index + 60) : "no prices";
          
          // Check ALL elements for price-like content
          const allWithPrice = [];
          const allEls = document.querySelectorAll("*");
          for (const el of allEls) {
            if (el.children.length === 0 && el.textContent) {
              const t = el.textContent.trim();
              if (/Rs\s*[0-9,]/.test(t)) {
                allWithPrice.push({
                  tag: el.tagName, cls: el.className, id: el.id,
                  text: t.slice(0, 100),
                  parentCls: el.parentElement?.className?.slice(0, 60)
                });
                if (allWithPrice.length >= 10) break;
              }
            }
          }
          
          // Find description area - look for main content
          const descCandidates = [];
          for (const sel of ["[class*=description]", "[class*=content]", "article", "main", ".content", "#content", "[class*=detail]", "[class*=body]"]) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
              const t = (el.textContent || "").trim();
              if (t.length > 100) {
                descCandidates.push({
                  selector: sel,
                  tag: el.tagName, cls: el.className,
                  text: t.slice(0, 200)
                });
                if (descCandidates.length >= 5) break;
              }
            }
            if (descCandidates.length >= 5) break;
          }
          
          // Look for h1 title
          const h1 = document.querySelector("h1");
          
          return {
            pageTitle: document.title,
            status: "OK",
            h1: h1?.textContent?.trim()?.slice(0, 100),
            priceElements: allWithPrice,
            descCandidates,
            textPriceAround: priceAround,
            bodyClasses: document.body.className,
            url: window.location.href,
          };
        });
      });
      console.log(JSON.stringify(info, null, 2));
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
  }
}

try {
  await probeOlxProduct();
} finally {
  await pool.drain();
  await browser.close();
}
