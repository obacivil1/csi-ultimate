import { createPool } from "../core/browser-pool.mjs";

const { browser, pool } = await createPool({ maxBrowsers: 1 });

async function probePreloved() {
  console.log("\n=== PROBE: preloved.co.uk detail page ===\n");
  const info = await pool.withPage(async (page) => {
    await page.goto("https://www.preloved.co.uk/adverts/show/123084238/happy-beds-orion-wooden-storage-bunk-bed-grey-white-inc?link=search", {
      waitUntil: "networkidle", timeout: 30000
    });
    await page.waitForTimeout(3000);
    return await page.evaluate(() => {
      const priceChecks = [
        { label: "[class*=price]", sel: "[class*='price']" },
        { label: "[class*=cost]", sel: "[class*='cost']" },
        { label: "[class*=amount]", sel: "[class*='amount']" },
        { label: "[itemprop=price]", sel: "[itemprop='price']" },
        { label: "[class*=ad-price]", sel: "[class*='ad-price']" },
        { label: ".price", sel: ".price" },
        { label: "[data-price]", sel: "[data-price]" },
        { label: "[class*=advert-price]", sel: "[class*='advert-price']" },
        { label: "[class*=listing-price]", sel: "[class*='listing-price']" },
      ];
      const priceResults = {};
      for (const c of priceChecks) {
        const els = document.querySelectorAll(c.sel);
        priceResults[c.label] = Array.from(els).slice(0, 5).map(el => ({
          tag: el.tagName, cls: el.className, id: el.id, text: (el.textContent || "").trim().slice(0, 120)
        }));
      }

      const descChecks = [
        { label: "#description", sel: "#description" },
        { label: "[class*=description]", sel: "[class*='description']" },
        { label: "[class*=advert]", sel: "[class*='advert']" },
        { label: "article", sel: "article" },
        { label: "[class*=content]", sel: "[class*='content']" },
        { label: "[class*=detail]", sel: "[class*='detail']" },
        { label: "[class*=body]", sel: "[class*='body']" },
        { label: "main", sel: "main" },
        { label: "[class*=ad-detail]", sel: "[class*='ad-detail']" },
        { label: "[class*=advert-detail]", sel: "[class*='advert-detail']" },
      ];
      const descResults = {};
      for (const c of descChecks) {
        const els = document.querySelectorAll(c.sel);
        descResults[c.label] = Array.from(els).slice(0, 5).map(el => ({
          tag: el.tagName, cls: el.className, id: el.id, text: (el.textContent || "").trim().slice(0, 150)
        }));
      }

      const bodyText = document.body.innerText || "";
      const priceMatch = bodyText.match(/£\d+[.,]?\d*/);
      const textAroundPrice = priceMatch ? bodyText.slice(Math.max(0, priceMatch.index - 30), priceMatch.index + 50) : "no £ price found";

      const cookieEls = document.querySelectorAll("#cookie-consent, .cookie, [class*=cookie], [class*=consent], [id*=cookie], .fc-consent-root, #consent-root, .ot-sdk-container, [class*=Cookie], [class*=Consent]");

      return {
        pageTitle: document.title,
        priceResults,
        descResults,
        cookieElements: cookieEls.length,
        textPriceSample: textAroundPrice,
        bodyClasses: document.body.className,
        allAdElements: Array.from(document.querySelectorAll("div, section, span")).filter(el => /£\s*\d/.test(el.textContent)).slice(0, 10).map(el => ({
          tag: el.tagName, cls: el.className, id: el.id, text: el.textContent.trim().slice(0, 150)
        })),
      };
    });
  });
  console.log(JSON.stringify(info, null, 2));
}

async function probeOlx() {
  console.log("\n=== PROBE: olx.com.pk detail page ===\n");
  const info = await pool.withPage(async (page) => {
    await page.goto("https://www.olx.com.pk/item/self-drive-with-driver-rent-a-car-pakistan-karachi-lahore-iid-1112651598", {
      waitUntil: "networkidle", timeout: 30000
    });
    await page.waitForTimeout(3000);
    return await page.evaluate(() => {
      const priceChecks = [
        { label: "[class*=price]", sel: "[class*='price']" },
        { label: "[class*=-price]", sel: "[class*='-price']" },
        { label: "[class*=amount]", sel: "[class*='amount']" },
        { label: "[data-price]", sel: "[data-price]" },
        { label: "[class*=cost]", sel: "[class*='cost']" },
        { label: "[class*=value]", sel: "[class*='value']" },
        { label: "[class*=rupee]", sel: "[class*='rupee']" },
        { label: "[class*=pkr]", sel: "[class*='pkr']" },
        { label: "[class*=currency]", sel: "[class*='currency']" },
        { label: ".price", sel: ".price" },
        { label: "meta[property*=price]", sel: "meta[property*='price']" },
        { label: "[class*=ad-price]", sel: "[class*='ad-price']" },
        { label: "[data-testid*=price]", sel: "[data-testid*='price']" },
        { label: "[class*=listing-price]", sel: "[class*='listing-price']" },
      ];
      const priceResults = {};
      for (const c of priceChecks) {
        const els = document.querySelectorAll(c.sel);
        priceResults[c.label] = Array.from(els).slice(0, 5).map(el => ({
          tag: el.tagName, cls: el.className, content: el.textContent?.trim().slice(0, 100) || el.content || ""
        }));
      }

      const descChecks = [
        { label: "[class*=description]", sel: "[class*='description']" },
        { label: "[class*=content]", sel: "[class*='content']" },
        { label: "[class*=detail]", sel: "[class*='detail']" },
        { label: "article", sel: "article" },
        { label: "[class*=body]", sel: "[class*='body']" },
        { label: "main", sel: "main" },
      ];
      const descResults = {};
      for (const c of descChecks) {
        const els = document.querySelectorAll(c.sel);
        descResults[c.label] = Array.from(els).slice(0, 5).map(el => ({
          tag: el.tagName, cls: el.className, text: (el.textContent || "").trim().slice(0, 150)
        }));
      }

      const bodyText = document.body.innerText || "";
      const priceMatch = bodyText.match(/Rs\s*[0-9,]+/);
      const textAroundPrice = priceMatch ? bodyText.slice(Math.max(0, priceMatch.index - 40), priceMatch.index + 40) : "no Rs price found";

      return {
        pageTitle: document.title,
        priceResults,
        descResults,
        textPriceSample: textAroundPrice,
        bodyClasses: document.body.className,
      };
    });
  });
  console.log(JSON.stringify(info, null, 2));
}

try {
  await probePreloved();
  console.log("\n\n========================================\n\n");
  await probeOlx();
} finally {
  await pool.drain();
  await browser.close();
}
