import { resolve, dirname } from "path"
import { fileURLToPath, pathToFileURL } from "url"
const __dirname = dirname(fileURLToPath(import.meta.url))
const CE = await import(pathToFileURL(resolve(__dirname, "core", "canonical-extractor.mjs")).href)

const config = {
  hostname: "preloved.co.uk",
  selectors: {
    title: ["h1", "[class*='title']"],
    phone: ["a[href^='tel:']", "[class*='phone']"],
    email: ["a[href^='mailto:']"],
    location: ["[class*='location']", "[class*='city']", ".classified__location"],
    price: [".classified__price", "[class*='price']", ".price"],
  },
  extraction: {
    phoneRegion: "UK",
    countryCodes: [44],
    currencies: ["GBP", "EUR"],
    adIdPattern: "/(\\d+)/",
  },
}
const category = {
  name: "Pets",
  url: "https://www.preloved.co.uk/adverts/list?sectionId=44",
  selector: "a[href*='/adverts/show/']",
}

console.log("=== Direct runCrawl for preloved ===")
try {
  const records = await CE.runCrawl("test_preloved", config, category, 10)
  console.log("Records returned:", records?.length ?? "null")
  if (records?.length > 0) {
    console.log("First:", JSON.stringify(records[0], null, 2).substring(0, 300))
    console.log("All IDs:", records.map(r => r.id))
  } else {
    console.log("No records - checking state/records for latest...")
  }
} catch (e) {
  console.log("runCrawl ERROR:", e.message?.substring(0, 500))
  console.log("Stack:", e.stack?.substring(0, 300))
}
