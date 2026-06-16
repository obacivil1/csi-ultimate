import { generateSiteVerification, generateAuditSamples, calculateFieldAccuracy, calculateDuplicateMetrics, calculateTrustScore, loadCrawlRecords } from "../core/validation-engine.mjs"

const records = loadCrawlRecords("d2753198-0bca-4330-aea4-3f17bdcb4673")

console.log("=== FIELD ACCURACY ===")
const fa = calculateFieldAccuracy(records)
console.log(JSON.stringify(fa, null, 2))

console.log("\n=== DUPLICATE METRICS ===")
const dm = calculateDuplicateMetrics(records)
console.log(JSON.stringify(dm, null, 2))

console.log("\n=== TRUST SCORE ===")
const ts = calculateTrustScore(fa, dm, generateAuditSamples(records, 20), { blockedPages: 0, linksAttempted: 25 })
console.log(JSON.stringify(ts, null, 2))

console.log("\n=== AUDIT SAMPLES (3 of 20) ===")
const audit = generateAuditSamples(records, 20)
console.log(JSON.stringify(audit.slice(0, 3), null, 2))

console.log("\n=== SITE VERIFICATION ===")
const sv = generateSiteVerification("gumtree.com", "Jobs", records, { blockedPages: 0, linksAttempted: 25 })
console.log(JSON.stringify(sv, null, 2))
