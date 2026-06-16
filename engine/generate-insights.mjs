import { generateInsights, saveInsights, loadInsights } from "../core/insight-engine.mjs"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const RECORDS_DIR = resolve(__dirname, "..", "state", "records")

const recordsFiles = ["d2753198-0bca-4330-aea4-3f17bdcb4673.json"]

for (const f of recordsFiles) {
  const fp = resolve(RECORDS_DIR, f)
  if (!existsSync(fp)) { console.log(`File not found: ${fp}`); continue }
  const records = JSON.parse(readFileSync(fp, "utf8"))
  console.log(`Loaded ${records.length} records from ${f}`)
  
  const result = generateInsights(records, "gumtree.com", "Jobs")
  console.log(`Generated ${result.insights.length} insights`)
  
  for (const ins of result.insights) {
    console.log(`  [${ins.severity}] ${ins.title}`)
    console.log(`    ${ins.so_what}`)
  }
  
  saveInsights(result)
  console.log(`\nSaved to state/insights.json`)
}
