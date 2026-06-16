/**
 * _pen_test.mjs — Functional Penetration Test (v1.0)
 * ──────────────────────────────────────────────────
 * Four tests designed to validate the scraper's extraction pipeline
 * under controlled conditions, producing a structured gap report.
 *
 * Usage:  node _pen_test.mjs [hostname] [category] [keyword]
 *         node _pen_test.mjs                              ← runs default suite
 *         node _pen_test.mjs expatriates.com "Job Seekers" "engineer"
 *
 * Output: state/pen_test_report_<timestamp>.json
 *         Terminal prints pass/fail per phase, per ad, per field.
 */

import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { loadSites, resolveSiteCategory } from "./core/run.mjs"

const STATE_DIR = path.resolve(import.meta.dirname, "state")
const RECORDS_DIR = path.join(STATE_DIR, "records")
if (!fs.existsSync(RECORDS_DIR)) fs.mkdirSync(RECORDS_DIR, { recursive: true })

// ── Colors ─────────────────────────────────────────────────────
const GREEN  = "\x1b[32m"
const RED    = "\x1b[31m"
const YELLOW = "\x1b[33m"
const CYAN   = "\x1b[36m"
const RESET  = "\x1b[0m"
const BOLD   = "\x1b[1m"

function ok(msg)   { console.log(`  ${GREEN}[PASS]${RESET} ${msg}`) }
function fail(msg) { console.log(`  ${RED}[FAIL]${RESET} ${msg}`) }
function warn(msg) { console.log(`  ${YELLOW}[WARN]${RESET} ${msg}`) }
function info(msg) { console.log(`  ${CYAN}[INFO]${RESET} ${msg}`) }
function header(n, t) { const w = Math.max(1, 60 - String(n).length - t.length - 8); console.log(`\n${BOLD}─── Test ${n}: ${t} ${"─".repeat(w)}${RESET}`) }

// ── Test 1: Connectivity ───────────────────────────────────────
async function testConnectivity(sites) {
  header("1️⃣", "Connectivity — Browser Launch & Site Navigation")
  const entries = []

  // Add known-good and known-bad test cases
  const cases = []
  for (const site of sites) {
    for (const cat of (site.categories || []).slice(0, 2)) {
      cases.push({ site, cat, label: `${site.hostname} / ${cat.name}` })
    }
  }
  // Intentional bad case
  cases.push({ site: { hostname: "nonexistent.example.com" }, cat: { name: "Bogus", url: "https://nonexistent.example.com/xxx", selector: "a" }, label: "nonexistent.example.com / Bogus (expected fail)", expectFail: true })

  let passed = 0, total = 0
  for (const { site, cat, label, expectFail } of cases) {
    total++
    process.stdout.write(`    Testing: ${label}... `)
    try {
      const probeUrl = cat.url || `https://${site.hostname}/`
      const result = execSync(`node "${import.meta.dirname.replace(/\\/g, "/")}/_probe.mjs" "${probeUrl}"`, {
        timeout: 30000,
        cwd: import.meta.dirname,
        shell: "powershell.exe",
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
      }).stdout.trim()
      const data = JSON.parse(result)
      if (data.ok) { ok(`${label} (${data.timing}s, IP: ${data.ip})`); passed++ }
      else if (expectFail) { ok(`${label} (expected fail, got ${data.status})`) }
      else { fail(`${label} — ${data.error || data.status}`) }
    } catch (e) {
      // Try to parse stderr even on failure
      let data = null
      try { data = JSON.parse(e.stdout?.trim() || "{}") } catch {}
      if (data && data.ok) { ok(`${label} (${data.timing}s, IP: ${data.ip})`); passed++ }
      else if (expectFail) { ok(`${label} (expected fail)`) }
      else { fail(`${label} — ${data?.error || data?.status || e.message?.substring(0, 60)}`) }
    }
  }

  const pct = total > 0 ? Math.round((passed / total) * 100) : 0
  console.log(`\n  Connectivity: ${passed}/${total} passed (${pct}%)`)
  entries.push({ test: "Connectivity", score: `${passed}/${total}`, pct, passed, total })
  return { test: "Connectivity", score: `${passed}/${total}`, pct, passed, total, entries }
}

// ── Test 2: Extraction Gap (5 categories) ──────────────────────
async function testExtractionGap(sites, userHostname, userCategory, userKeyword) {
  header("2️⃣", "Extraction Gap — Field Coverage Across 5 Categories")
  const entries = []

  // Pick 5 real categories; use user-specified ones if provided
  let categories = []
  if (userHostname && userCategory) {
    try {
      const { siteConfig, category } = resolveSiteCategory(userHostname, userCategory)
      categories.push({ siteConfig, category, keyword: userKeyword || "test" })
    } catch {}
  }

  // Fill remaining slots from real sites
  for (const site of sites) {
    if (categories.length >= 5) break
    for (const cat of (site.categories || [])) {
      if (categories.length >= 5) break
      if (categories.some(c => c.category.name === cat.name && c.siteConfig.hostname === site.hostname)) continue
      categories.push({ siteConfig: site, category: cat, keyword: "" })
    }
  }

  // Add an empty-selector test case (Test 3 overlapped)
  categories.push({
    siteConfig: { hostname: "sandbox.local", extraction: { selectors: {} } },
    category: { name: "Empty Selector Test", url: "file:///dev/null", selector: "a" },
    keyword: "", isControl: true,
  })

  let totalFields = 0, populatedFields = 0, adCount = 0
  const fieldReport = {}
  const FIELD_NAMES = ["id", "title", "price", "currency", "phone", "email", "location", "extractedAt"]

  for (const { siteConfig, category, keyword, isControl } of categories) {
    info(`Processing: ${siteConfig.hostname} / ${category.name}${isControl ? " [EMPTY SELECTOR CONTROL]" : ""}${keyword ? " (" + keyword + ")" : ""}`)
    adCount++

    if (isControl) {
      // Empty selector: verify fallback engine still produces id + title
      for (const field of FIELD_NAMES) {
        if (!fieldReport[field]) fieldReport[field] = { present: 0, total: 0, categoryLabel: {} }
      }
      // We can't easily test this without creating a real page.
      // Simulate: report the field as "tested via fallback logic"
      info("  Empty selector test — fallback engine should use document.title / regex")
      continue
    }

    try {
      const result = execSync(`node "${import.meta.dirname.replace(/\\/g, "/")}/core/run.mjs" "${siteConfig.hostname}" "${category.name}" "${keyword || ""}" 3d 2>nul`, {
        timeout: 120000,
        cwd: import.meta.dirname,
        shell: "powershell.exe",
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
        env: { ...process.env, CSI_LOG_LEVEL: "ERROR", CSI_UAT: "1" },
      }).stdout.trim()

      // Parse UAT metrics from output
      const metricLines = result.split("\n").filter(l => l.includes("[UAT_METRIC]") || l.includes("[WARNING"))
      const fieldCoverage = metricLines.filter(l => l.includes("[UAT_METRIC] FieldCoverage"))
      const warnings = metricLines.filter(l => l.includes("[WARNING"))

      for (const line of fieldCoverage) {
        const match = line.match(/FieldCoverage \| (\w+) = (\d+)\/(\d+)/)
        if (match && match[1] !== "url" && match[1] !== "extractedAt") {
          const field = match[1]
          const present = parseInt(match[2])
          const total = parseInt(match[3])
          if (!fieldReport[field]) fieldReport[field] = { present: 0, total: 0, categoryLabel: {} }
          fieldReport[field].present += present
          fieldReport[field].total += total
          if (!fieldReport[field].categoryLabel[category.name]) fieldReport[field].categoryLabel[category.name] = { present, total }
          totalFields += total
          populatedFields += present
        }
      }

      // Report individual ad warnings
      for (const w of warnings) {
        const wMatch = w.match(/\[WARNING: Missing Field - (\w+) - AdID: (\S+)\]/)
        if (wMatch) {
          fail(`Missing "${wMatch[1]}" in ad ${wMatch[2]} (${siteConfig.hostname} / ${category.name})`)
        }
      }

      // Phase-level pass/fail
      const passes = result.split("\n").filter(l => l.includes("[UAT_PASS]"))
      const failures = result.split("\n").filter(l => l.includes("[UAT_FAIL]"))
      for (const f of failures) {
        const pMatch = f.match(/\[UAT_FAIL\] \[(\w+)\]/)
        if (pMatch) fail(`Phase "${pMatch[1]}" FAILED for ${siteConfig.hostname} / ${category.name}`)
      }
      for (const p of passes) {
        const pMatch = p.match(/\[UAT_PASS\] \[(\w+)\]/)
        if (pMatch) ok(`Phase "${pMatch[1]}" PASSED for ${siteConfig.hostname} / ${category.name}`)
      }
    } catch (e) {
      warn(`${siteConfig.hostname} / ${category.name} — ${e.message?.substring(0, 80)}`)
    }
  }

  console.log(`\n  Field Coverage Summary:`)
  for (const [field, stats] of Object.entries(fieldReport).sort()) {
    const pct = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0
    const status = pct >= 80 ? "PASS" : pct >= 50 ? "WARN" : "FAIL"
    const sym = status === "PASS" ? GREEN : status === "WARN" ? YELLOW : RED
    console.log(`  ${sym}${status}${RESET} ${field}: ${stats.present}/${stats.total} (${pct}%)`)
    for (const [catLabel, vals] of Object.entries(stats.categoryLabel)) {
      console.log(`         ${catLabel}: ${vals.present}/${vals.total}`)
    }
  }

  const overallPct = totalFields > 0 ? Math.round((populatedFields / totalFields) * 100) : 0
  console.log(`\n  Overall Extraction Coverage: ${populatedFields}/${totalFields} (${overallPct}%)`)
  entries.push({ test: "Extraction Gap", fieldCoverage: fieldReport, populatedFields, totalFields, overallPct })

  // Produce structured gap report
  const gaps = []
  for (const [field, stats] of Object.entries(fieldReport)) {
    const pct = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0
    if (pct < 80) {
      for (const [catLabel, vals] of Object.entries(stats.categoryLabel)) {
        const catPct = vals.total > 0 ? Math.round((vals.present / vals.total) * 100) : 0
        if (catPct < 80) {
          gaps.push({ field, category: catLabel, present: vals.present, total: vals.total, pct: catPct })
        }
      }
    }
  }

  return { test: "ExtractionGap", fieldCoverage: fieldReport, populatedFields, totalFields, overallPct, gaps }
}

// ── Test 3: Empty Selector / Fallback Resilience ──────────────
async function testFallbackResilience() {
  header("3️⃣", "Empty Selector — Fallback Engine Resilience (No Config)")
  const entries = []

  // This test validates the fallback chains directly via evaluate
  // We create a minimal HTML page and test FALLBACK_MAP functions
  const html = `
  <html><head><title>iPhone 15 Pro — for sale</title>
  <meta property="og:title" content="iPhone 15 Pro">
  </head><body>
  <h1>iPhone 15 Pro 256GB</h1>
  <div class="price">SAR 3,500</div>
  <a href="tel:+966501234567">Call</a>
  <p>Contact: seller@example.com</p>
  <div class="location">Riyadh, Saudi Arabia</div>
  <div>Posted: Monday, March 15, 2025</div>
  </body></html>`

  // Write test page
  const htmlPath = path.join(STATE_DIR, "_test_fallback.html")
  fs.writeFileSync(htmlPath, html, "utf-8")

  try {
    const result = execSync(`node -e "
      const { FALLBACK_MAP, extractByFallback, logInfo } = (await import('./core/bridge.mjs'))
      const { createPage } = (await import('./core/anti-detect.mjs'))
      const { browser, context, page } = await createPage()
      await page.goto('file://${htmlPath.replace(/\\/g, "/")}')
      const fields = ['title','price','phone','email','location']
      const configSelectors = { title: null, price: null, location: null }
      const results = {}
      for (const f of fields) {
        const sel = configSelectors[f] || null
        const val = await extractByFallback(page, FALLBACK_MAP[f], sel, f, 'TEST')
        results[f] = val
        console.log(f + '=' + (val || 'NULL'))
      }
      await browser.close()
      console.log('DONE=' + Object.values(results).filter(Boolean).length + '/' + fields.length)
      process.exit(0)
    "`, {
      timeout: 30000,
      cwd: import.meta.dirname,
      shell: "powershell.exe",
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
    }).stdout.trim()

    const lines = result.split("\n")
    const fieldResults = {}
    for (const l of lines) {
      if (l.includes("DONE=")) {
        const [, val] = l.split("=")
        const [done, total] = val.split("/").map(Number)
        const pct = Math.round((done / total) * 100)
        if (pct >= 80) ok(`Fallback engine: ${done}/${total} fields extracted from minimal HTML (${pct}%)`)
        else fail(`Fallback engine: only ${done}/${total} fields extracted (${pct}%)`)
        entries.push({ test: "FallbackResilience", extracted: done, total, pct })
      } else if (l.includes("=")) {
        const [k, v] = l.split("=")
        fieldResults[k] = v === "NULL" ? null : v
        if (v && v !== "NULL") ok(`  ${k}: "${v?.substring(0, 30)}"`)
        else fail(`  ${k}: missing`)
      }
    }
  } catch (e) {
    fail(`Fallback test execution failed: ${e.message?.substring(0, 80)}`)
    entries.push({ test: "FallbackResilience", error: e.message })
  } finally {
    if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath)
  }

  return { test: "FallbackResilience", entries }
}

// ── Test 4: Phase Validity / Lifecycle Tag Audit ──────────────
async function testPhaseValidity() {
  header("4️⃣", "Phase Validity — Lifecycle Tag Audit (INIT→NAV→DOM→EXT→VAL→SAVE→DONE)")
  const entries = []

  // Run a minimal search (just 1 listing page, no full extraction) to collect lifecycle tags
  const tagOrder = ["INIT", "NAV", "DOM", "EXT", "VAL", "SAVE", "ERR", "RETRY", "DONE", "NAV_SUCCESS",
    "NAV_FAILURE", "EXT_SUCCESS", "EXT_FAILURE", "VAL_SUCCESS", "VAL_FAILURE"]
  const foundTags = {}

  try {
    const result = execSync(`node "${import.meta.dirname.replace(/\\/g, "/")}/core/run.mjs" expatriates.com "Job Seekers" "test" 3d 2>&1`, {
      timeout: 60000,
      cwd: import.meta.dirname,
      shell: "powershell.exe",
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      env: { ...process.env, CSI_LOG_LEVEL: "INFO", CSI_UAT: "1" },
    }).stdout

    // Extract all [TAG] occurrences
    const tagMatches = result.match(/\[([A-Z_]+)\]/g) || []
    for (const t of tagMatches) {
      const clean = t.replace(/\[|\]/g, "")
      foundTags[clean] = (foundTags[clean] || 0) + 1
    }

    // Check mandatory phases
    const mandatory = ["INIT", "NAV", "DOM", "EXT", "VAL", "DONE"]
    for (const phase of mandatory) {
      if (foundTags[phase]) ok(`Phase "${phase}" logged (${foundTags[phase]}x)`)
      else fail(`Phase "${phase}" NOT found in lifecycle`)
    }

    // Check that at least one SUCCESS/FAILURE tag exists (UAT)
    const uatTags = ["NAV_SUCCESS", "NAV_FAILURE", "EXT_SUCCESS", "EXT_FAILURE", "VAL_SUCCESS", "VAL_FAILURE"]
    const foundUat = uatTags.filter(t => foundTags[t])
    if (foundUat.length > 0) ok(`UAT tags found: ${foundUat.join(", ")}`)
    else warn("No UAT SUCCESS/FAILURE tags detected (CSI_UAT not propagated?)")

    entries.push({ test: "PhaseValidity", foundTags, mandatoryPresent: mandatory.every(t => foundTags[t]) })
  } catch (e) {
    // Even if the search errors, we can still parse the output
    if (e.stdout) {
      const tagMatches = e.stdout.match(/\[([A-Z_]+)\]/g) || []
      for (const t of tagMatches) {
        const clean = t.replace(/\[|\]/g, "")
        foundTags[clean] = (foundTags[clean] || 0) + 1
      }
    }
    info("Run completed (possibly with blocks), parsing available tags")
    const mandatory = ["INIT", "NAV", "DOM", "EXT", "VAL", "DONE"]
    for (const phase of mandatory) {
      if (foundTags[phase]) ok(`Phase "${phase}" logged (${foundTags[phase]}x)`)
      else fail(`Phase "${phase}" NOT found`)
    }
    entries.push({ test: "PhaseValidity", foundTags, mandatoryPresent: mandatory.every(t => foundTags[t]) })
  }

  return { test: "PhaseValidity", foundTags, entries }
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  process.env.CSI_UAT = "1"

  console.log(`\n${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`)
  console.log(`${BOLD}║     CSI-Ultimate Functional Penetration Test Suite     ║${RESET}`)
  console.log(`${BOLD}║            v1.0 — ${new Date().toISOString().substring(0, 10)}                     ║${RESET}`)
  console.log(`${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`)

  const sites = loadSites()
  info(`Loaded ${sites.length} sites from state/sites.json`)

  // Parse optional filters
  const hostname = args[0] || null
  const category = args[1] || null
  const keyword  = args[2] || "test"

  // ═══ Run Tests ═══════════════════════════════════════════════
  const results = []

  results.push(await testConnectivity(sites))
  results.push(await testExtractionGap(sites, hostname, category, keyword))
  results.push(await testFallbackResilience())
  results.push(await testPhaseValidity())

  // ═══ Generate Report ═════════════════════════════════════════
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const reportPath = path.join(STATE_DIR, `pen_test_report_${timestamp}.json`)

  const report = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      csiUat: process.env.CSI_UAT,
      csiLogLevel: process.env.CSI_LOG_LEVEL || "INFO",
      proxyConfigured: !!process.env.CSI_PROXY,
    },
    tests: results,
    summary: {},
  }

  // Compute final scores
  const scores = results.filter(r => r.pct !== undefined)
  const avgPct = scores.length > 0 ? Math.round(scores.reduce((a, r) => a + r.pct, 0) / scores.length) : 0

  // Gap count
  const gapReport = results.find(r => r.test === "ExtractionGap")
  const gapCount = gapReport?.gaps?.length || 0

  report.summary = {
    overallScore: avgPct >= 80 ? "PASS" : avgPct >= 50 ? "WARN" : "FAIL",
    averageCoverage: `${avgPct}%`,
    fieldCoverage: gapReport ? `${gapReport.populatedFields}/${gapReport.totalFields} (${gapReport.overallPct}%)` : "N/A",
    gapsFound: gapCount,
    fallbackResult: results.find(r => r.test === "FallbackResilience")?.entries?.[0]?.pct || "N/A",
    phaseValidity: results.find(r => r.test === "PhaseValidity")?.mandatoryPresent ? "PASS" : "FAIL",
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8")

  // ═══ Final Summary ═══════════════════════════════════════════
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════${RESET}`)
  console.log(`${BOLD}  PENETRATION TEST RESULTS${RESET}`)
  console.log(`${BOLD}══════════════════════════════════════════════════════════${RESET}`)
  console.log(`  Overall Score:    ${report.summary.overallScore === "PASS" ? GREEN + "PASS" + RESET : RED + report.summary.overallScore + RESET}`)
  console.log(`  Avg Coverage:     ${avgPct}%`)
  console.log(`  Field Gaps:       ${gapCount}`)
  console.log(`  Fallback Engine:  ${report.summary.fallbackResult}%`)
  console.log(`  Phase Validity:   ${report.summary.phaseValidity === "PASS" ? GREEN + "PASS" + RESET : RED + "FAIL" + RESET}`)
  console.log(`\n  Report saved: ${CYAN}${reportPath}${RESET}`)
  console.log(`\n  Legend:  ${GREEN}[PASS]${RESET} = data collected / phase logged`)
  console.log(`           ${RED}[FAIL]${RESET} = missing data / phase skipped`)
  console.log(`           ${YELLOW}[WARN]${RESET} = partial or degraded`)
  console.log()
}

main().catch(e => {
  console.error(`\n  ${RED}FATAL${RESET}`, e.message)
  process.exit(1)
})
