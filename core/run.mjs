/**
 * run.mjs — Execution Pipeline Entry Point (Production)
 * ──────────────────────────────────────────────────────
 * API-First Hybrid + Stealth-First Architecture:
 *   1) If CSI_INDEED_PUBLISHER_ID is set for Indeed sites,
 *      bypass browser entirely → Indeed Publisher API.
 *   2) If --stealth-first (-sf) flag is set, use local-only
 *      stealth strategies (fingerprint masking, warm-up
 *      sequences, randomized jitter, UA pool cycling,
 *      session locking with user-data-dir persistence).
 *   3) Default fallback: Bridge stealth scraper.
 *
 * UAT mode:  set CSI_UAT=1  or CLI --uat
 */
import fs from "fs"
import path from "path"
import { runSearch, saveResults, logInfo, logWarn, logError, logDebug, extractAdData, deepExtraction } from "./bridge.mjs"
import { exportAll } from "./canonical-extractor.mjs"
import { fetchIndeedJobs } from "./indeed-api.mjs"
import { recordCheck } from "./strategy-ledger.mjs"
import { collectAdLinks, extractAd } from "./crawler-core.mjs"
import { createPage } from "./anti-detect.mjs"
import {
  runStealthPipeline, randomizedJitter, createStealthBrowser,
  stealthNavigate, runWarmupSequence, lockSession,
  hasSessionLock, closeStealthBrowser, closeAllStealthBrowsers,
} from "./stealth-engine.mjs"
import { simulateHumanBehavior, waitForStabilization, humanScroll, randomDelay } from "./behavior-engine.mjs"
import { Jitter } from "./strategy-engine.mjs"
import { discoverLinks, collectVerifiedLinks } from "./discovery-engine.mjs"
import { runSustainableCli } from "./sustainable-agent.mjs"
import {
  runInteractionPipeline, professionalClick, extractHiddenData,
  detectCaptcha, injectSessionCookies, enableNetworkCapture,
} from "./interaction-engine.mjs"

const STATE_DIR = path.resolve(import.meta.dirname, "..", "state")
const OUTPUT_DIR = path.resolve(import.meta.dirname, "..", "output")
const DATA_DIR   = path.resolve(import.meta.dirname, "..", "data")
const SITES_PATH = path.join(STATE_DIR, "sites.json")

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

// ── Archiving ──────────────────────────────────────────────────

export function saveArchivedResults(results, siteHostname, categoryName, keyword, jobId) {
  const now = new Date()
  const datePart = now.toISOString().substring(0, 10)
  const timePart = now.toTimeString().substring(0, 5).replace(":", "")
  const siteSlug = siteHostname.replace(/[^a-z0-9]+/gi, "_").replace(/_+$/, "").toLowerCase().substring(0, 30)
  const catSlug = categoryName.replace(/[^a-z0-9\u0600-\u06FF]+/gi, "_").replace(/_+$/, "").toLowerCase().substring(0, 20)

  const filename = keyword
    ? `${siteSlug}_${catSlug}_${datePart}_${timePart}_${keyword.replace(/[^a-z0-9]/gi, "_").substring(0, 15)}.json`
    : `${siteSlug}_${catSlug}_${datePart}_${timePart}.json`

  const filePath = path.join(DATA_DIR, filename)

  const archive = {
    meta: {
      jobId,
      site: siteHostname,
      category: categoryName,
      keyword: keyword || null,
      generatedAt: now.toISOString(),
      totalAds: results.length,
    },
    results,
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(archive, null, 2), "utf-8")
    logInfo("[ARCHIVE]", `Saved to ${filename}`, { ads: results.length, file: filePath })
    return filePath
  } catch (e) {
    logError("[ARCHIVE_FAIL]", `Write failed: ${e.message}`, { file: filePath })
    return null
  }
}

export function listArchives(limit = 20) {
  if (!fs.existsSync(DATA_DIR)) return []
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit)
    .map(f => {
      const p = path.join(DATA_DIR, f)
      const stat = fs.statSync(p)
      return { filename: f, size: stat.size, modified: stat.mtime.toISOString() }
    })
}

// ── Site config loader ─────────────────────────────────────────

export function loadSites() {
  try {
    const raw = fs.readFileSync(SITES_PATH, "utf-8")
    const sites = JSON.parse(raw)
    if (!Array.isArray(sites)) throw new Error("sites.json is not an array")
    return sites
  } catch (e) {
    logError("[ERR]", `Failed to load sites: ${e.message}`)
    return []
  }
}

export function resolveSiteCategory(hostname, categoryName) {
  const sites = loadSites()
  const site = sites.find(s => s.hostname === hostname)
  if (!site) throw new Error(`Site "${hostname}" not found`)
  const cat = site.categories?.find(c => c.name === categoryName)
  if (!cat) throw new Error(`Category "${categoryName}" not found for "${hostname}"`)
  return { siteConfig: site, category: cat }
}

// ── API-First Indeed handler ───────────────────────────────────

function isIndeedSite(hostname) {
  return hostname && (hostname.includes("indeed") || hostname.endsWith("indeed.com"))
}

function getIndeedLocation(siteConfig) {
  return siteConfig?.extraction?.location || "Riyadh"
}

async function runIndeedApiMode(jobId, siteHostname, categoryName, keyword, timePeriod, hardMode, extremeMode) {
  const startTime = Date.now()
  const publisherId = process.env.CSI_INDEED_PUBLISHER_ID
  logInfo("[INIT]", "Indeed API-First mode activated", { jobId, publisherId: publisherId ? "***" : "MISSING" })

  const { siteConfig } = resolveSiteCategory(siteHostname, categoryName)
  const location = getIndeedLocation(siteConfig)
  const query = keyword?.trim() || categoryName

  logInfo("[INDEED-API]", `Fetching via Publisher API`, { query, location })
  const apiResults = await fetchIndeedJobs(query, location, publisherId)

  if (apiResults && apiResults.length > 0) {
    recordCheck(siteHostname, "A-Standard", "SUCCESS", {
      source: "Indeed Publisher API",
      count: apiResults.length,
      mode: "api-first",
      bypass: "browser-free",
    })
    logInfo("[API_SUCCESS]", `Indeed Publisher API returned ${apiResults.length} jobs`, { query, location })

    const elapsed = Math.round((Date.now() - startTime) / 1000)

    const resultData = {
      results: apiResults,
      stats: {
        totalAds: apiResults.length,
        checked: apiResults.length,
        skippedKeyword: 0,
        skippedDate: 0,
        errors: 0,
        elapsed,
        linksFound: apiResults.length,
      },
      jobId,
      generatedAt: new Date().toISOString(),
    }

    const archivePath = saveArchivedResults(apiResults, siteHostname, categoryName, keyword || "", jobId)
    const filePath = saveResults(jobId, apiResults)

    let exports = null
    if (apiResults.length > 0) {
      try {
        exports = exportAll(apiResults, `search_${jobId}`, path.join(OUTPUT_DIR, "search"))
        logInfo("[SAVE]", "Exports generated", { json: !!exports?.json, csv: !!exports?.csv, xlsx: !!exports?.xlsx })
      } catch (e) {
        logWarn("[WARN]", "Export generation failed", { error: e.message })
      }
    }

    logInfo("[DONE]", "Indeed API pipeline complete", { elapsed: `${elapsed}s`, ads: apiResults.length })
    return { ...resultData, archivePath, filePath, exports, elapsed }
  }

  recordCheck(siteHostname, "A-Standard", "BLOCKED", {
    source: "Indeed Publisher API",
    error: "API returned no results or Publisher ID invalid",
    fallback: "stealth-scraper",
  })
  logInfo("[API_FAILURE_FALLBACK]", "Indeed Publisher API returned no data — falling back to stealth scraper", { query, location })
  return null
}

// ── Stealth-First search ────────────────────────────────────────

async function runStealthSearch(siteHostname, categoryName, keyword, maxResults = 25, onProgress) {
  const { siteConfig, category } = resolveSiteCategory(siteHostname, categoryName)
  const allMode = !keyword
  const maxAgeMs = Infinity
  const results = []
  let checked = 0, skippedKeyword = 0, skippedDate = 0, errors = 0

  const startTime = Date.now()

  await runStealthPipeline(siteHostname, async (browser, context, page) => {
    // Navigate to listing page with full stealth
    const listingUrl = category.url
    logInfo("[STEALTH]", `Navigating to listing: ${listingUrl}`)
    await stealthNavigate(page, listingUrl, { jitterMin: 5000, jitterMax: 15000 })

    // Collect listing links via page evaluate
    await randomizedJitter(5000, 10000)
    const selector = category.selector || "a[href]"
    const links = await page.evaluate((sel) => {
      return Array.from(document.querySelectorAll(sel))
        .map(a => a.href)
        .filter(h => h && h.startsWith("http"))
        .slice(0, 50)
    }, selector).catch(() => [])

    logInfo("[STEALTH]", `Found ${links.length} listing links`, { selector })

    if (links.length === 0) {
      logWarn("[STEALTH]", "No links found — site may be blocking")
      return
    }

    // Process each ad link
    for (const link of links) {
      if (results.length >= maxResults) break
      checked++

      try {
        // Open ad in a new page with full stealth
        await randomizedJitter(8000, 15000)
        const adPage = await context.newPage()
        try {
          await stealthNavigate(adPage, link, { jitterMin: 5000, jitterMax: 10000 })
          await randomizedJitter(3000, 8000)

          // Extract data using bridge's extractAdData
          const data = await extractAdData(adPage, siteConfig)

          // Enrich with URL
          data.url = link

          // Keyword filter
          if (!allMode && keyword) {
            const text = (data.title || "") + " " + (data.description || "")
            if (!text.toLowerCase().includes(keyword.toLowerCase())) {
              skippedKeyword++
              if (onProgress) onProgress({ type: "skip", reason: "keyword", link, checked, total: links.length, adIndex: checked })
              continue
            }
          }

          results.push(data)
          logInfo("[STEALTH]", `Extracted ad #${results.length}`, { title: (data.title || "N/A").substring(0, 40) })
          if (onProgress) onProgress({ type: "ad", index: results.length, data, checked, total: links.length, adIndex: checked })
        } finally {
          await adPage.close().catch(() => {})
        }
      } catch (e) {
        errors++
        logWarn("[STEALTH]", `Failed to extract: ${link?.substring(0, 50)}`, { error: e.message?.substring(0, 60) })
      }
    }
  })

  const elapsed = Math.round((Date.now() - startTime) / 1000)

  return {
    results,
    stats: { totalAds: results.length, checked, skippedKeyword, skippedDate, errors, elapsed, linksFound: checked },
    elapsed,
  }
}

// ── Search executor ────────────────────────────────────────────

export async function executeSearch(jobId, siteHostname, categoryName, keyword, timePeriod, onProgress, hardMode, extremeMode, stealthFirst, discoveryMode = false, interactiveMode = false, verifyLinks = false) {
  const startTime = Date.now()
  hardMode = hardMode || process.env.CSI_HARD_MODE === "1"
  extremeMode = extremeMode || process.env.CSI_EXTREME_MODE === "1"

  const publisherId = process.env.CSI_INDEED_PUBLISHER_ID
  if (isIndeedSite(siteHostname) && publisherId) {
    logInfo("[INIT]", "API-First Hybrid: trying Indeed Publisher API before browser launch", {
      site: siteHostname, publisherId: "***",
    })
    const apiResult = await runIndeedApiMode(jobId, siteHostname, categoryName, keyword, timePeriod, hardMode, extremeMode)
    if (apiResult) return apiResult
    logInfo("[INIT]", "API returned empty — falling through", { site: siteHostname })
  }

  // ── Stealth-First path (zero paid APIs) ───────────────────
  if (stealthFirst) {
    logInfo("[STEALTH]", "Stealth-First mode activated (zero paid APIs)", {
      site: siteHostname, category: categoryName, keyword: keyword || "(all)",
    })
    const result = await runStealthSearch(siteHostname, categoryName, keyword, 25, onProgress)

    const archivePath = saveArchivedResults(result.results, siteHostname, categoryName, keyword || "", jobId)
    const filePath = saveResults(jobId, result.results)

    let exports = null
    if (result.results.length > 0) {
      try {
        exports = exportAll(result.results, `search_${jobId}`, path.join(OUTPUT_DIR, "search"))
        logInfo("[SAVE]", "Exports generated", { json: !!exports?.json, csv: !!exports?.csv, xlsx: !!exports?.xlsx })
      } catch (e) {
        logWarn("[WARN]", "Export generation failed", { error: e.message })
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000)
    logInfo("[DONE]", "Stealth-First pipeline complete", { elapsed: `${elapsed}s`, ads: result.results.length })

    return { ...result, archivePath, filePath, exports, elapsed }
  }

  // ── Dual-Thread Mode (Discovery + Interaction) ────────────
  if (discoveryMode || interactiveMode) {
    logInfo("[DUAL_THREAD]", `Dual-Thread mode activated`, {
      discovery: discoveryMode, interactive: interactiveMode, verifyEach: verifyLinks,
    })

    const { siteConfig, category } = resolveSiteCategory(siteHostname, categoryName)
    const { browser, context, page } = await createPage({ hardMode, extremeMode })
    const startTs = Date.now()

    try {
      // Phase 1 = Discovery (Thread A): scan pages, collect & verify links
      const verifiedLinks = []
      if (discoveryMode) {
        logInfo("[THREAD_A]", "Discovery phase starting — scanning pages for links")
        const linkIterator = discoverLinks(browser, page, category, siteConfig, {
          maxPages: keyword?.trim() ? 10 : 5,
          hardMode,
          verifyEach: verifyLinks,
          keyword: keyword || "",
          maxResults: 25,
          hostname: siteHostname,
          timePeriod: timePeriod || "2w",
        })

        for await (const link of linkIterator) {
          verifiedLinks.push(link)
          if (onProgress) {
            onProgress({
              type: "discovery",
              link: link.url,
              index: link.index,
              total: link.total,
            })
          }
        }
        logInfo("[THREAD_A]", `Discovery complete — ${verifiedLinks.length} verified links collected`)
      }

      // Phase 2 = Interaction (Thread B): process each verified link
      const results = []
      let checked = 0, errors = 0

      if (interactiveMode && verifiedLinks.length > 0) {
        logInfo("[THREAD_B]", `Interaction phase starting — ${verifiedLinks.length} links to process`)

        for (const link of verifiedLinks) {
          if (results.length >= 25) break
          checked++

          try {
            // Navigate to ad page
            const adPage = await context.newPage()
            try {
              await Jitter.delay(3000, 8000)
              await adPage.goto(link.url, { waitUntil: "domcontentloaded", timeout: 60000 })

              // Wait for real content (keeps waiting if Cloudflare/CAPTCHA challenge)
              try {
                await adPage.waitForFunction(() => {
                  const body = document.body?.innerText?.trim()
                  const isAntiBot = /just a moment|checking your browser|verify (you are|your)|captcha|press & hold/i.test(document.title)
                  if (isAntiBot) return false
                  const h1 = document.querySelector("h1")
                  const title = document.querySelector("[class*='job-title'], [itemprop='title'], [class*='title'] h1")
                  return (h1 || title) && body && body.length > 200
                }, { timeout: 30000, polling: 1000 })
              } catch {}

              // Run interaction pipeline (professionalClick, reveals, network capture)
              const interaction = await runInteractionPipeline(adPage, context, siteHostname, siteConfig)

              // Extract ad data
              const data = await extractAdData(adPage, siteConfig)

              // Enrich with URL and interaction results
              data.url = link.url
              if (interaction.hiddenData.phone) data.phone = interaction.hiddenData.phone
              if (interaction.hiddenData.email) data.email = interaction.hiddenData.email
              if (interaction.apiPhone) data.phone = interaction.apiPhone
              if (interaction.apiEmail) data.email = interaction.apiEmail
              if (interaction.hiddenData.applied) data.applied = true

              results.push(data)
              logInfo("[THREAD_B]", `Processed ad #${results.length}`, {
                title: (data.title || "N/A").substring(0, 40),
                phone: !!data.phone,
                email: !!data.email,
              })
              if (onProgress) {
                onProgress({ type: "ad", index: results.length, data, checked, total: verifiedLinks.length, adIndex: checked })
              }
            } finally {
              await adPage.close().catch(() => {})
            }
          } catch (e) {
            errors++
            logWarn("[THREAD_B]", `Failed to process link`, { url: link.url?.substring(0, 50), error: e.message?.substring(0, 60) })
          }
        }
      } else if (discoveryMode && !interactiveMode) {
        // Discovery-only mode: save links as results
        for (const link of verifiedLinks) {
          results.push({
            id: `link_${link.index}`,
            url: link.url,
            title: link.url?.split("/").filter(Boolean).pop()?.replace(/[-_]/g, " ") || "N/A",
            source: "discovery-only",
            extractedAt: new Date().toISOString(),
          })
        }
      }

      const elapsed = Math.round((Date.now() - startTs) / 1000)
      logInfo("[DONE]", "Dual-Thread pipeline complete", {
        totalAds: results.length, checked, errors, elapsed: `${elapsed}s`,
      })

      const dataForReturn = {
        results,
        stats: { totalAds: results.length, checked, skippedKeyword: 0, skippedDate: 0, errors, elapsed, linksFound: verifiedLinks.length },
        jobId,
        generatedAt: new Date().toISOString(),
      }

      const archivePath = saveArchivedResults(results, siteHostname, categoryName, keyword || "", jobId)
      const filePath = saveResults(jobId, results)

      let exports = null
      if (results.length > 0) {
        try {
          exports = exportAll(results, `search_${jobId}`, path.join(OUTPUT_DIR, "search"))
          logInfo("[SAVE]", "Exports generated", { json: !!exports?.json, csv: !!exports?.csv, xlsx: !!exports?.xlsx })
        } catch (e) {
          logWarn("[WARN]", "Export generation failed", { error: e.message })
        }
      }

      return { ...dataForReturn, archivePath, filePath, exports, elapsed }
    } finally {
      await browser.close()
      logInfo("[DONE]", "Browser closed")
    }
  }

  // ── Standard / Fallback: browser-based stealth scraper ─────
  logInfo("[INIT]", "executeSearch called (stealth-scraper mode)", { jobId, site: siteHostname, category: categoryName, keyword, timePeriod, hardMode, extremeMode })

  const { siteConfig, category } = resolveSiteCategory(siteHostname, categoryName)

  const result = await runSearch({
    jobId,
    siteConfig,
    category,
    keyword: keyword || "",
    timePeriod: timePeriod || "2w",
    maxResults: 25,
    hardMode,
    extremeMode,
  }, (event) => {
    if (onProgress) onProgress(event)
  })

  const archivePath = saveArchivedResults(result.results, siteHostname, categoryName, keyword || "", jobId)
  const filePath = saveResults(jobId, result.results)

  let exports = null
  if (result.results.length > 0) {
    try {
      exports = exportAll(result.results, `search_${jobId}`, path.join(OUTPUT_DIR, "search"))
      logInfo("[SAVE]", "Exports generated", { json: !!exports?.json, csv: !!exports?.csv, xlsx: !!exports?.xlsx })
    } catch (e) {
      logWarn("[WARN]", "Export generation failed", { error: e.message })
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000)
  logInfo("[DONE]", "executeSearch complete", { elapsed: `${elapsed}s`, ads: result.results.length, archive: path.basename(archivePath || "") })

  return {
    ...result,
    archivePath,
    filePath,
    exports,
    elapsed,
  }
}

// ── Standalone CLI entry ───────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const uatMode = args.includes("--uat") || process.env.CSI_UAT === "1"
  const hardMode = args.includes("--hard") || process.env.CSI_HARD_MODE === "1"
  const extremeMode = args.includes("--extreme") || process.env.CSI_EXTREME_MODE === "1"
  const allMode = args.includes("--all") || args.includes("--no-filter")
  const stealthFirst = args.includes("--stealth-first") || args.includes("-sf")
  const discoveryMode = args.includes("--discovery") || args.includes("-d")
  const interactiveMode = args.includes("--interactive") || args.includes("-ia")
  const verifyLinks = args.includes("--verify") || args.includes("-v")
  const sustainableMode = args.includes("--sustainable") || args.includes("-sus")
  const filtered = args.filter(a => !a.startsWith("--"))
  if (uatMode) process.env.CSI_UAT = "1"
  if (hardMode) process.env.CSI_HARD_MODE = "1"
  if (extremeMode) { process.env.CSI_EXTREME_MODE = "1"; process.env.CSI_HARD_MODE = "1" }

  const publisherId = process.env.CSI_INDEED_PUBLISHER_ID
  const hasApiKey = publisherId && publisherId.length > 0

  const help = `
  Usage:  node run.mjs <hostname> <category> [keyword] [timePeriod] [flags]

  Pipeline priority:
    1) API-FIRST  — if CSI_INDEED_PUBLISHER_ID is set for Indeed
    2) STEALTH-FIRST — if --stealth-first (-sf) flag (zero paid APIs)
    3) DUAL-THREAD — if --discovery (-d) + --interactive (-ia) (parallel)
    4) STANDARD  — Bridge stealth scraper (default)

  Dual-Thread Architecture (Thread A → Thread B):
    Thread-A (Discovery): Collect + verify links → strategy_ledger.json
    Thread-B (Interaction): professionalClick() → reveal hidden data → extract
    Use: --discovery (-d) --interactive (-ia) [--verify (-v)]

  Stealth-First strategies (local-only, no paid APIs):
    - Fingerprint Masking via playwright-extra + user-data-dir
    - randomizedJitter(5000,15000) on every action
    - Warm-up sequences (2-3 non-target pages)
    - Rotating User-Agent pool per context
    - Session Locking with local cookie persistence

  Example:
    node run.mjs expatriates.com Jobs --all --stealth-first
    node run.mjs expatriates.com Jobs "planning engineer" 1m --hard
    node run.mjs sa.indeed.com Jobs engineer 1w -sf         (stealth-first)
    node run.mjs www.bayt.com Jobs --all -d -ia -v          (dual-thread)
    node run.mjs www.bayt.com Jobs --all --discovery        (links only)

  timePeriod: 24h | 3d | 1w | 2w | 1m | 3m | all  (default: 2w)
  --uat, --hard, --extreme, --all, --stealth-first (-sf)
  --discovery (-d), --interactive (-ia), --verify (-v)
  --sustainable (-sus)   Auto-heal + verify + rotate across all sites

  Environment:
    CSI_INDEED_PUBLISHER_ID  Free Indeed Publisher API key (publish.indeed.com)
    CSI_PROXY                Comma-separated proxy list
    CSI_HARD_MODE=1, CSI_EXTREME_MODE=1
  `
  if (sustainableMode) {
    // Sustainable mode doesn't require hostname/category args — auto-discovers all sites
  } else if (filtered.length < 2 || filtered[0] === "--help") {
    console.log(help)
    process.exit(0)
  }

  // In sustainable mode, positional args are optional (agent finds targets automatically)
  const [hostname, categoryName, keywordArg, timePeriodArg] = sustainableMode ? [filtered[0] || "auto", filtered[1] || "auto", filtered[2], filtered[3]] : filtered
  const keyword = allMode ? "" : (keywordArg || "")
  const timePeriod = timePeriodArg || "2w"
  const jobId = `cli_${hostname.replace(/[^a-z0-9]/g, "_")}_${Date.now()}`

  const isIndeed = isIndeedSite(hostname)
  const apiMode = isIndeed && hasApiKey

  console.log(`\n  ╔${"═".repeat(38)}╗`)
  console.log(`  ║  CSI-Ultimate Multi-Layer Strategy Pipeline ${uatMode ? "(UAT)" : ""}║`)
  console.log(`  ╚${"═".repeat(38)}╝`)
  console.log(`  Site:     ${hostname}`)
  console.log(`  Category: ${categoryName}`)
  console.log(`  Keyword:  ${keyword || "(all)"}`)
  console.log(`  Period:   ${timePeriod || "2w"}   Job: ${jobId}`)

  let modeLabel
  if (sustainableMode) {
    modeLabel = "SUSTAINABLE (auto-heal + verify + rotate)"
  } else if (apiMode) {
    modeLabel = "API-FIRST (Publisher API)"
  } else if (stealthFirst) {
    modeLabel = "STEALTH-FIRST (zero-API, local-only)"
  } else if (discoveryMode && interactiveMode) {
    modeLabel = "DUAL-THREAD (Discovery + Interaction)"
  } else if (discoveryMode) {
    modeLabel = "DISCOVERY (links only)"
  } else if (interactiveMode) {
    modeLabel = "INTERACTIVE (hidden data reveal)"
  } else if (extremeMode) {
    modeLabel = "EXTREME (AI stealth + fingerprint rotation)"
  } else if (hardMode) {
    modeLabel = "HARD (headed + stealth)"
  } else {
    modeLabel = "NORMAL (headless)"
  }
  console.log(`  Mode:     ${modeLabel}`)

  if (stealthFirst) {
    console.log(`  Pipeline: Warmup[2-3 pages] → Jitter[5-15s] → Navigate → Extract → LockSession`)
    console.log(`  Strategies: FingerprintMask | UA Pool(10) | user-data-dir | randomizedJitter | SessionLock`)
  } else if (apiMode) {
    console.log(`  Pipeline: API[Indeed Publisher] → (fallback) Bridge[Stealth→ABC→Jitter→Backoff]`)
  } else if (sustainableMode) {
    console.log(`  Pipeline: TargetQueue → DiscoverLinks → VerifyMatrix[Quality≥50] → EscalateOnFail → HealOn10Fails → RotateTarget → SilentSave`)
    console.log(`  Components: 1[IntelligentRetryLoop] 2[VerificationMatrix] 3[SelfHealingSystem] 4[SilentMode]`)
  } else if (discoveryMode && interactiveMode) {
    console.log(`  Pipeline: Thread-A[Scan→Verify→Yield] → Thread-B[professionalClick→Reveal→Extract]`)
    console.log(`  Layers:   1[Stealth] 2[ABC→D(Session)→E(Network)] 3[Jitter] 4[Backoff] 5[DeepExtract]`)
    if (verifyLinks) console.log(`  Verify:   Each link pre-verified before interaction`)
  } else if (discoveryMode) {
    console.log(`  Pipeline: Thread-A[Scan→Verify→Collect] (links only, no extraction)`)
  } else if (interactiveMode) {
    console.log(`  Pipeline: Thread-B[professionalClick→Reveal→Extract] (interaction only)`)
  } else {
    console.log(`  Layers:   1[Stealth] 2[ABC→D(Session)→E(Network)] 3[Jitter] 4[Backoff] 5[DeepExtract]`)
  }
  console.log(`  ${"=".repeat(40)}\n`)

  // ── Sustainable Mode: autonomous multi-target agent ──────────
  if (sustainableMode) {
    const targets = []
    // If hostname + category provided, resolve full category object from sites.json
    if (filtered[0] && filtered[0] !== "auto") {
      try {
        const sites = JSON.parse(fs.readFileSync(SITES_PATH, "utf-8"))
        const site = sites.find(s => s.hostname === filtered[0])
        if (site) {
          const catName = filtered[1] || (site.categories?.[0]?.name)
          const cat = site.categories?.find(c => c.name === catName) || site.categories?.[0]
          if (cat) targets.push({ hostname: filtered[0], category: cat, siteConfig: site })
        }
      } catch {}
      // Fallback if sites.json lookup failed
      if (targets.length === 0) {
        targets.push({ hostname: filtered[0] })
      }
    }
    console.log(`[${new Date().toISOString()}] [[SUSTAINABLE]] Starting sustainable agent...\n`)

    const startTs = Date.now()
    const result = await runSustainableCli(targets)

    const elapsed = Math.round((Date.now() - startTs) / 1000)
    console.log(`\n  ${"=".repeat(40)}`)
    console.log(`  Sustainable Agent Complete`)
    console.log(`  Extracted: ${result.totalExtracted} ads from ${result.totalAttempts} attempts`)
    console.log(`  Time:      ${elapsed}s`)
    if (result.failedHostnames?.length > 0) {
      console.log(`  Failed:    ${result.failedHostnames.join(", ")}`)
    }
    console.log(`  Files:     data/*_sustainable.json`)
    console.log()
    return
  }

  const result = await executeSearch(jobId, hostname, categoryName, keyword, timePeriod || "2w", (event) => {
    if (event.type === "ad") {
      console.log(`  [${event.checked}/${event.total}] #${event.index} ${event.data?.title?.substring(0, 50) || "N/A"}`)
    } else if (event.type === "skip") {
      if (event.adIndex % 10 === 0) process.stdout.write(".")
    } else if (event.type === "discovery") {
      process.stdout.write(`\r  [Discovery] Link ${event.index}/${event.total}`)
    }
  }, hardMode, extremeMode, stealthFirst, discoveryMode, interactiveMode, verifyLinks)

  console.log(`\n  ${"=".repeat(40)}`)
  console.log(`  Complete: ${result.stats.totalAds} ads extracted`)
  console.log(`  Checked:  ${result.stats.checked} | Errors: ${result.stats.errors}`)
  console.log(`  Skipped:  ${result.stats.skippedKeyword} (keyword) + ${result.stats.skippedDate} (date)`)
  console.log(`  Time:     ${result.elapsed}s`)
  if (result.archivePath) console.log(`  Archive:  ${result.archivePath}`)
  if (result.filePath) console.log(`  Records:  ${result.filePath}`)
  if (result.exports) console.log(`  XLSX:     ${result.exports.xlsx}`)
  console.log()
}

if (process.argv[1] === import.meta.filename || process.argv[1]?.endsWith("run.mjs")) {
  main().catch(e => {
    console.error("\n  FATAL:", e.message)
    process.exit(1)
  })
}