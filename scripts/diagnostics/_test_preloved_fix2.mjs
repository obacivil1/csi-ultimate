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

console.time("preloved_test")
const records = await CE.runCrawl("test_preloved_v3", config, category, 10)
console.timeEnd("preloved_test")
console.log(`Records: ${records?.length ?? 0}`)
if (records?.length > 0) {
  records.slice(0, 3).forEach((r, i) => {
    console.log(`  [${i}] id=${r.id} title=${r.title?.substring(0, 30)} price=${r.price} loc=${r.location?.substring(0, 25)} phone=${r.phone || "N/A"}`)
  })
}
