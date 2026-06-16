#!/usr/bin/env node
/**
 * run.mjs — CSI Ultimate Sales Automation Engine
 * ─────────────────────────────────────────────
 * Scrapes Muqawil.org company directory,
 * generates executive PowerPoint proposals,
 * and saves them to /proposals/ automatically.
 *
 * Usage:
 *   node run.mjs
 *
 * Architecture:
 *   1. Crawl Muqawil.org → extract companies
 *   2. Filter duplicates via log/history.json
 *   3. Generate PPTX proposal per company
 *   4. Save to /proposals/ + log to console
 *   5. Loop until all companies are processed
 */

import fs from 'fs'
import path from 'path'
import { generateProposal } from './engine/presentation-engine.mjs'

const __dirname = import.meta.dirname
const HISTORY_FILE = path.join(__dirname, 'log', 'history.json')
const PROPOSALS_DIR = path.join(__dirname, 'proposals')
const CONFIG_FILE = path.join(__dirname, 'config', 'sites', 'muqawil.org.json')

// ── Ensure directories ──
if (!fs.existsSync(path.dirname(HISTORY_FILE))) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true })
}
if (!fs.existsSync(PROPOSALS_DIR)) {
  fs.mkdirSync(PROPOSALS_DIR, { recursive: true })
}

// ── Helpers ──

function randomDelay(minSec = 3, maxSec = 8) {
  const ms = (Math.random() * (maxSec - minSec) + minSec) * 1000
  console.log(`  ⏳ Waiting ${(ms / 1000).toFixed(1)}s (random delay) ...`)
  return new Promise(r => setTimeout(r, ms))
}

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf-8')
      return JSON.parse(raw)
    }
  } catch (e) {
    console.error(`[WARN] Could not read history.json: ${e.message}`)
  }
  return { processed: [], failed: [], lastRun: null }
}

function saveHistory(history) {
  try {
    history.lastRun = new Date().toISOString()
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8')
  } catch (e) {
    console.error(`[ERROR] Could not save history.json: ${e.message}`)
  }
}

function isProcessed(history, companyName) {
  const normalized = companyName.trim().toLowerCase()
  return history.processed.some(p => p.toLowerCase() === normalized) ||
         history.failed.some(f => f.toLowerCase() === normalized)
}

function slugify(text) {
  return text.replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').substring(0, 40)
}

// ── Muqawil.org Scraper (Playwright-based) ──

async function scrapeMuqawilCompanies() {
  let browser
  try {
    const { chromium } = await import('playwright-extra')
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default
    chromium.use(StealthPlugin())

    console.log('\n  [CRAWL] Launching stealth browser...')
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-webgl',
        '--disable-webrtc',
        '--window-size=1920,1080',
      ],
    })

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      geolocation: { latitude: 24.7136, longitude: 46.6753 },
      permissions: [],
    })

    const page = await context.newPage()
    const companies = new Map() // key = normalized name

    // ── Try multiple search entry points ──
    const urls = [
      { url: 'https://www.muqawil.org/ar/contractors', label: 'Contractors Directory' },
      { url: 'https://www.muqawil.org/ar/companies', label: 'Companies Directory' },
      { url: 'https://www.muqawil.org/ar/', label: 'Homepage' },
    ]

    for (const { url, label } of urls) {
      if (companies.size >= 15) break
      console.log(`\n  [CRAWL] Visiting: ${label} — ${url}`)

      try {
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
        if (!response || !response.ok()) {
          console.error(`  [WARN] HTTP ${response?.status()} for ${url}`)
          continue
        }

        await page.waitForTimeout(2000 + Math.random() * 3000)

        // Try to find company listing elements
        const companySelectors = [
          'a[href*="contractor"]', 'a[href*="company"]',
          '.company-card', '.contractor-card',
          'tr[class*="company"]', 'tr[class*="contractor"]',
          '.list-item', '.item', 'article',
          '[class*="company"]', '[class*="contractor"]', '[class*="supplier"]',
          'h2 a', 'h3 a', 'h4 a',
          'a[href*="profile"]', 'a[href*="details"]',
          'table a',
        ]

        let found = false
        for (const sel of companySelectors) {
          const elements = await page.$$(sel).catch(() => [])
          if (elements.length > 0) {
            console.log(`  [CRAWL] Found ${elements.length} elements using selector: ${sel}`)
            for (const el of elements.slice(0, 25)) {
              try {
                const href = await el.getAttribute('href').catch(() => null)
                const text = (await el.textContent().catch(() => '')).trim()
                if (text && text.length > 2 && text.length < 200) {
                  const fullUrl = href ? new URL(href, url).href : url
                  const key = text.trim().toLowerCase()
                  if (!companies.has(key)) {
                    companies.set(key, {
                      name: text.trim(),
                      url: fullUrl,
                      specialty: guessSpecialty(text),
                      website: fullUrl,
                    })
                  }
                }
              } catch { }
            }
            if (companies.size > 5) { found = true; break }
          }
        }

        if (!found) {
          // Fallback: extract all visible text and try to find structured data
          const bodyText = await page.evaluate(() => document.body?.innerText || '')
          const lines = bodyText.split('\n').filter(l => l.trim().length > 5)
          let nameCandidates = lines.filter(l =>
            /(شركة|مؤسسة|مجموعة|company|contractor|building|construction|general|est\.)/i.test(l) &&
            !/\d{8,}/.test(l) &&
            l.length < 120
          )
          nameCandidates = [...new Set(nameCandidates)].slice(0, 15)
          for (const nc of nameCandidates) {
            const key = nc.trim().toLowerCase()
            if (!companies.has(key)) {
              companies.set(key, {
                name: nc.trim(),
                url: url,
                specialty: guessSpecialty(nc),
                website: url,
              })
            }
          }
          console.log(`  [CRAWL] Fallback text extraction: ${nameCandidates.length} candidates found`)
        }

        // Try pagination
        if (companies.size < 10) {
          const nextSelectors = [
            'a[rel="next"]', 'a.next', '[class*="next"] a',
            'a:has-text("التالي")', 'a:has-text("Next")',
            'a[aria-label="Next"]',
          ]
          for (const ns of nextSelectors) {
            try {
              const nextBtn = await page.$(ns)
              if (nextBtn) {
                const disabled = await nextBtn.getAttribute('disabled').catch(() => null)
                if (!disabled) {
                  console.log('  [CRAWL] Clicking next page...')
                  await nextBtn.click()
                  await page.waitForTimeout(3000 + Math.random() * 2000)
                  // Re-extract
                  for (const sel of companySelectors) {
                    const elements = await page.$$(sel).catch(() => [])
                    for (const el of elements.slice(0, 15)) {
                      try {
                        const text = (await el.textContent().catch(() => '')).trim()
                        if (text && text.length > 2) {
                          const key = text.trim().toLowerCase()
                          if (!companies.has(key)) {
                            companies.set(key, {
                              name: text.trim(),
                              url: url,
                              specialty: guessSpecialty(text),
                              website: url,
                            })
                          }
                        }
                      } catch { }
                    }
                  }
                  break
                }
              }
            } catch { }
          }
        }
      } catch (err) {
        console.error(`  [WARN] Error scraping ${url}: ${err.message}`)
      }
    }

    const result = [...companies.values()]
    console.log(`\n  [CRAWL] Total unique companies found: ${result.length}`)
    return result

  } catch (err) {
    console.error(`\n  [CRAWL] Fatal error: ${err.message}`)
    return []
  } finally {
    if (browser) {
      try { await browser.close() } catch { }
    }
  }
}

function guessSpecialty(text) {
  const lower = text.toLowerCase()
  if (/مقاولات|contractor|construction|building|مباني/.test(lower)) return 'General Contracting'
  if (/طرق|roads|highway|جسور|bridges|infrastructure|بنية/.test(lower)) return 'Infrastructure'
  if (/كهرباء|electrical|energy|طاقة|power/.test(lower)) return 'Electrical & Energy'
  if (/مياه|water|صرف|sanitary|sewage|plumbing/.test(lower)) return 'Water & Sanitary'
  if (/تكييف|hvac|mechanical|ميكانيكا/.test(lower)) return 'Mechanical & HVAC'
  if (/مكتب|engineering|consult|استشارات|design|تصميم/.test(lower)) return 'Engineering & Design'
  if (/معدات|equipment|تأجير|rental/.test(lower)) return 'Equipment & Machinery'
  if (/ديكور|finishing|تشطيب|interior|interior/.test(lower)) return 'Interior Finishing'
  return 'Construction & Engineering'
}

// ── Generate a demo company list if scraping fails ──

function getDemoCompanies() {
  return [
    { name: 'شركة أبناء عبدالله القحطاني للمقاولات', specialty: 'General Contracting', website: 'https://www.muqawil.org/ar/contractors/1' },
    { name: 'مؤسسة محمد الرشيد للمقاولات', specialty: 'Building Construction', website: 'https://www.muqawil.org/ar/contractors/2' },
    { name: 'شركة الخليج للإنشاءات', specialty: 'Infrastructure', website: 'https://www.muqawil.org/ar/contractors/3' },
    { name: 'مجموعة العليان للمقاولات', specialty: 'EPC Services', website: 'https://www.muqawil.org/ar/contractors/4' },
    { name: 'شركة الصقر للهندسة والمقاولات', specialty: 'Engineering & Design', website: 'https://www.muqawil.org/ar/contractors/5' },
    { name: 'مؤسسة البناء المتطور', specialty: 'General Contracting', website: 'https://www.muqawil.org/ar/contractors/6' },
    { name: 'شركة الأساس المتين للمقاولات', specialty: 'Foundation & Structure', website: 'https://www.muqawil.org/ar/contractors/7' },
    { name: 'مجموعة الفهد للمشاريع', specialty: 'Project Management', website: 'https://www.muqawil.org/ar/contractors/8' },
    { name: 'شركة الربوة للإنشاءات', specialty: 'Building Construction', website: 'https://www.muqawil.org/ar/contractors/9' },
    { name: 'مؤسسة النهضة العمرانية', specialty: 'Urban Development', website: 'https://www.muqawil.org/ar/contractors/10' },
  ]
}

// ── Main Pipeline ──

async function main() {
  console.log('══════════════════════════════════════════════════════════')
  console.log('  CSI Ultimate  |  Sales Automation Engine')
  console.log('  Muqawil.org → Executive Proposal Generator')
  console.log('══════════════════════════════════════════════════════════\n')

  // Phase 1: Crawl
  console.log('[PHASE 1] Crawling Muqawil.org for company data...')
  let companies = await scrapeMuqawilCompanies()

  // Fallback to demo data if scraping returned nothing
  if (companies.length === 0) {
    console.log('\n  [CRAWL] Scraping returned no results. Using demo company list...')
    companies = getDemoCompanies()
  }

  console.log(`\n  Total companies loaded: ${companies.length}`)

  // Phase 2: Filter
  console.log('\n[PHASE 2] Filtering previously processed companies...')
  const history = loadHistory()
  const newCompanies = companies.filter(c => !isProcessed(history, c.name))
  console.log(`  Already processed: ${companies.length - newCompanies.length}`)
  console.log(`  New companies to process: ${newCompanies.length}`)

  if (newCompanies.length === 0) {
    console.log('\n  ✅ All companies have been processed. Nothing to do.')
    console.log(`  Total processed to date: ${history.processed.length}`)
    console.log(`  Total failed: ${history.failed.length}`)
    return
  }

  // Phase 3: Generate Proposals
  console.log('\n[PHASE 3] Generating executive proposals...\n')

  let successCount = 0
  let failCount = 0

  for (let i = 0; i < newCompanies.length; i++) {
    const company = newCompanies[i]
    const prefix = `  [${i + 1}/${newCompanies.length}]`

    console.log(`${'─'.repeat(60)}`)
    console.log(`${prefix} Processing: ${company.name}`)
    console.log(`${'─'.repeat(60)}`)

    try {
      const result = await generateProposal(company)
      console.log(`  ✅ SUCCESS: ${company.name}`)
      console.log(`     📁 File: ${result.filename}`)
      console.log(`     📍 Path: ${result.filepath}`)
      history.processed.push(company.name)
      successCount++
    } catch (err) {
      console.error(`  ❌ FAILED: ${company.name}`)
      console.error(`     Error: ${err.message}`)
      history.failed.push(company.name)
      failCount++
    }

    // Save history after each company
    saveHistory(history)

    // Random delay between companies (not after the last one)
    if (i < newCompanies.length - 1) {
      await randomDelay(2, 6)
    }
  }

  // Phase 4: Final Report
  console.log('\n' + '═'.repeat(60))
  console.log('  FINAL EXECUTION REPORT')
  console.log('═'.repeat(60))
  console.log(`  Total companies found:     ${companies.length}`)
  console.log(`  Already processed:         ${companies.length - newCompanies.length}`)
  console.log(`  Successfully generated:    ${successCount}`)
  console.log(`  Failed:                   ${failCount}`)
  console.log('─'.repeat(60))
  console.log(`  Runtime:                  ${new Date().toISOString()}`)
  console.log(`  Proposals directory:      ${PROPOSALS_DIR}`)
  console.log('═'.repeat(60))

  // List generated files
  console.log('\n  Generated files:')
  try {
    const files = fs.readdirSync(PROPOSALS_DIR)
      .filter(f => f.endsWith('.pptx'))
      .sort((a, b) => fs.statSync(path.join(PROPOSALS_DIR, b)).mtimeMs - fs.statSync(path.join(PROPOSALS_DIR, a)).mtimeMs)
    files.slice(0, 20).forEach(f => {
      const stats = fs.statSync(path.join(PROPOSALS_DIR, f))
      console.log(`    📄 ${f}  (${(stats.size / 1024).toFixed(0)} KB)`)
    })
    if (files.length > 20) console.log(`    ... and ${files.length - 20} more files`)
  } catch { }

  console.log('\n  ✅ Pipeline complete.')
}

main().catch(err => {
  console.error('\n  ❌ Pipeline crashed:', err.message)
  process.exit(1)
})
