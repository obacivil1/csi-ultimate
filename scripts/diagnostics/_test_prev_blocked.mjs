import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"
const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)

const SITES = [
  {
    name: "bayt.com",
    config: {
      hostname: "bayt.com",
      selectors: { title: ["h1", ".job-title"], phone: ["a[href^='tel:']"], email: ["a[href^='mailto:']"], location: ["[class*='location']", ".job-location"], price: ["[class*='salary']", ".job-salary"] },
      extraction: { adIdPattern: "/(\\d+)", phoneRegion: "AE", countryCodes: [971], currencies: ["AED"] },
    },
    category: { name: "Jobs", url: "https://www.bayt.com/en/jobs/", selector: "a[href*='/job/']" },
  },
  {
    name: "olx.com.pk",
    config: {
      hostname: "olx.com.pk",
      selectors: { title: ["h1"], phone: ["a[href^='tel:']"], email: ["a[href^='mailto:']"], location: ["[class*='location']", "[class*='_95eae']"], price: ["[class*='price']", "[class*='_95eae']"] },
      extraction: { phoneRegion: "PK", countryCodes: [92], currencies: ["PKR"] },
    },
    category: { name: "All", url: "https://www.olx.com.pk/", selector: "a[href*='olx.com.pk/item']" },
  },
  {
    name: "expatriates.com",
    config: {
      hostname: "expatriates.com",
      selectors: { title: ["h1", ".ptitle"], phone: ["a[href^='tel:']"], email: ["a[href^='mailto:']"], location: ["[class*='location']"], price: ["[class*='price']"] },
      extraction: { phoneRegion: "US", countryCodes: [1], currencies: ["USD"] },
    },
    category: { name: "Jobs", url: "https://www.expatriates.com/", selector: "a[href*='expatriates.com']" },
  },
  {
    name: "sa.opensooq.com",
    config: {
      hostname: "sa.opensooq.com",
      selectors: { title: ["h1", ".post-title"], phone: ["a[href^='tel:']", "[class*='phone']"], email: ["a[href^='mailto:']"], location: ["[class*='location']", ".post-address"], price: ["[class*='price']", ".post-price"] },
      extraction: { phoneRegion: "SA", countryCodes: [966], currencies: ["SAR"] },
    },
    category: { name: "All", url: "https://sa.opensooq.com/en", selector: "a[href*='/en/']" },
  },
]

for (const site of SITES) {
  console.log("\n" + "=".repeat(60))
  console.log("  TESTING: " + site.name)
  console.log("  URL: " + site.category.url)
  console.log("=".repeat(60))

  try {
    const records = await CE.runCrawl("test_" + site.name.replace(/\./g, "_"), site.config, site.category, 5)
    if (records && records.length > 0) {
      console.log("  RESULT: " + records.length + " records")
      records.slice(0, 3).forEach((r, i) => {
        console.log("    [" + (i + 1) + "] id=" + (r.id || "?") + " title=" + (r.title || "?").substring(0, 40) + " price=" + (r.price || "N/A"))
      })
    } else {
      console.log("  RESULT: 0 records (no ads found)")
    }
  } catch (e) {
    console.log("  ERROR: " + (e.message || "").substring(0, 200))
  }
}

console.log("\nDONE")
