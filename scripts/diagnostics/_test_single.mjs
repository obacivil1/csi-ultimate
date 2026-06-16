import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"
const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)

// Test single gumtree crawl
const siteConfig = {
  hostname: "gumtree.com",
  selectors: {
    title: "h1",
    phone: ["a[href^='tel:']"],
    email: ["a[href^='mailto:']"],
    location: ["[class*='location']", ".vip-location"],
    price: [".price", '[class*="price"]'],
  },
  extraction: {
    phoneRegion: "GB",
    countryCodes: [44],
    currencies: ["GBP"],
  },
}
const category = {
  name: "Jobs",
  url: "https://www.gumtree.com/jobs",
  selector: "a[href*='/p/']",
}

console.log("Starting single gumtree crawl...")
const records = await CE.runCrawl("test_gumtree_1", siteConfig, category, 5)
console.log("Records:", records?.length || 0)
if (records && records.length > 0) {
  console.log("First record:", JSON.stringify(records[0], null, 2).substring(0, 300))
}
