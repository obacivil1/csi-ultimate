/**
 * scripts/scratch/cc-probe.mjs — TikTok Creative Center XHR-probe via anti-detect.
 * يفتح صفحة منتجات رائجة وألتقط طلبات الشبكة index للـ API الحقيقي وحفظ JSON خام.
 */
import { createPage, navigateWithRetry } from "../../core/anti-detect.mjs";

const targets = [
  "https://www.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en?period=30",
  "https://www.tiktok.com/business/creativecenter/trend/most-popular-products/pc/en?period=30",
];

const { page, browser } = await createPage({ headless: true });
const captured = [];

async function trackXhr() {
  await page.route("**/*", async (route) => {
    const req = route.request();
    const rt = req.resourceType();
    if (rt === "xhr" || rt === "fetch") {
      const u = req.url();
      try {
        const resp = await route.fetch();
        const body = await resp.text();
        let isJson = false;
        try { JSON.parse(body); isJson = true; } catch {}
        captured.push({ url: u, method: req.method(), status: resp.status(), len: body.length, json: isJson });
        const fsModule = await import("node:fs");
        if (isJson && body.length > 200 && body.length < 2_000_000) {
          fsModule.writeFileSync(`./state/cc-${Date.now()}-${captured.length}.json`, body);
        }
        await route.fulfill({ response: resp });
      } catch {
        await route.continue();
      }
    } else {
      await route.continue();
    }
  });
}

await trackXhr();
for (const url of targets) {
  console.log("→", url);
  try {
    await navigateWithRetry(page, url, 2);
    await page.waitForTimeout(6000);
    const links = await page.evaluate(() => Array.from(document.querySelectorAll("a")).map(a => a.href).filter(h => /product|hashtag/i.test(h)).slice(0, 20));
    console.log("   sample links:", links.slice(0, 8));
  } catch (e) {
    console.log("   ERR:", e.message);
  }
}
console.log("\n=== XHR CAPTURED:", captured.length);
for (const c of captured.slice(0, 40)) {
  console.log(`  ${c.method} ${c.status} json=${c.json} len=${c.len} ${c.url.slice(0, 140)}`);
}
await browser.close();