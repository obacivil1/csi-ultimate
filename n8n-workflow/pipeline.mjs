/**
 * pipeline.mjs — n8n workflow logic as pure JS module
 *
 * Replaces: Parse & Normalize → Tag Source → Dedup → Score →
 *           Extract Email → Filter CRM → Store Pending
 *
 * Usage:
 *   import { runPipeline } from './pipeline.mjs'
 *   const result = await runPipeline({ jobs, seenJobs, crm })
 */

import fs from 'fs'
import path from 'path'

/* ─── Constants ─── */

const BLOCKED_DOMAINS = new Set([
  'linkedin.com', 'indeed.com', 'bayt.com', 'gulftalent.com', 'naukrigulf.com',
  'tanqeeb.com', 'laimoon.com', 'monstergulf.com', 'wuzzuf.net', 'expatriates.com',
  'drjobs.com', 'akhtaboot.com', 'hirelebanese.com', 'ziprecruiter.com',
  'glassdoor.com', 'gulfjobseeker.com', 'jobs.com.sa', 'jadarat.com',
  'amazon.com', 'amazonaws.com', 'sentry.io', 'n8n.io', 'wixpress.com',
])
const BLOCKED_PREFIXES = [
  'noreply', 'no-reply', 'donotreply', 'notifications', 'alerts',
  'digest', 'mailer', 'bounce', 'postmaster', 'support',
  'info', 'careers', 'jobs', 'recruitment', 'hr', 'hiring',
  'apply', 'applications', 'talent',
]
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const SAUDI_PHONE_REGEX = /(?:\+9665|9665|05)\d{8}(?!\d)/g
const SCORE_THRESHOLD = 65

const ROLE_TIERS = [
  { keywords: ['project controls engineer', 'project controls lead', 'project controls manager'], pts: 100 },
  { keywords: ['planning & controls', 'planning and controls', 'planning & cost controls'],       pts: 100 },
  { keywords: ['senior planning engineer', 'planning lead', 'senior planner'],                   pts: 95 },
  { keywords: ['planning engineer', 'project planner'],                                          pts: 90 },
  { keywords: ['controls engineer', 'project control engineer', 'cost control engineer'],        pts: 85 },
  { keywords: ['scheduling engineer', 'senior scheduler', 'lead scheduler'],                     pts: 85 },
  { keywords: ['scheduler', 'cost controller'],                                                  pts: 75 },
  { keywords: ['construction planner', 'epc planner'],                                           pts: 72 },
  { keywords: ['planning'],                                                                      pts: 35 },
]
const TOOL_KEYWORDS = [
  { kw: 'primavera', pts: 25 }, { kw: ' p6', pts: 25 },
  { kw: 'earned value', pts: 18 }, { kw: 'evm', pts: 18 },
  { kw: 'baseline', pts: 12 }, { kw: 'wbs', pts: 10 },
  { kw: 'msp', pts: 8 }, { kw: 'microsoft project', pts: 8 },
]
const SECTOR_KEYWORDS = [
  { kw: 'epc', pts: 12 }, { kw: 'oil & gas', pts: 12 }, { kw: 'oil and gas', pts: 12 },
  { kw: 'aramco', pts: 15 }, { kw: 'sabic', pts: 12 }, { kw: 'neom', pts: 15 },
  { kw: 'vision 2030', pts: 15 }, { kw: 'mega project', pts: 10 },
  { kw: 'construction', pts: 8 }, { kw: 'infrastructure', pts: 6 },
  { kw: 'petrochemical', pts: 10 },
]
const SENIORITY_KEYWORDS = [
  { kw: 'senior', pts: 12 }, { kw: ' sr.', pts: 12 },
  { kw: 'lead', pts: 10 }, { kw: 'principal', pts: 10 },
  { kw: 'manager', pts: 6 }, { kw: 'head', pts: 6 },
]
const PENALTY_KEYWORDS = [
  'urban planning', 'city planning', 'event planning', 'media planning',
  'financial planning', 'it planning', 'strategic planning', 'supply chain planning',
  'demand planning', 'production planning', 'capacity planning',
  'hr planning', 'workforce planning', 'succession planning',
  'marketing', 'content writer', 'sales', 'software engineer',
  'data scientist', 'machine learning', 'devops', 'accountant',
]

/* ─── Helpers ─── */

function isValidEmail(e) {
  if (!e || typeof e !== 'string') return false
  const em = e.trim().toLowerCase()
  if (em.length < 6 || em.length > 254) return false
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(em)) return false
  const domain = em.split('@')[1]
  if (BLOCKED_DOMAINS.has(domain)) return false
  const local = em.split('@')[0]
  if (BLOCKED_PREFIXES.some(p => local.startsWith(p.replace('@', '')))) return false
  if (BLOCKED_PREFIXES.some(p => em.includes(p.replace('@', '') + '@'))) return false
  return true
}

function extractEmail(text) {
  if (!text) return ''
  const matches = String(text).match(EMAIL_REGEX) || []
  return matches.find(e => isValidEmail(e)) || ''
}

function extractPhones(text) {
  if (!text) return []
  return [...new Set([...String(text).matchAll(SAUDI_PHONE_REGEX)].map(m => m[0]))]
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim()
}

function normalizeLink(link) {
  try {
    const url = new URL(link.trim())
    ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref', 'referer', 'source', 'track'].forEach(p => url.searchParams.delete(p))
    return url.origin + url.pathname.replace(/\/$/, '').toLowerCase()
  } catch {
    return link.trim().replace(/\/$/, '').toLowerCase()
  }
}

/* ─── RSS Parser ─── */

function parseRss(xmlText, label) {
  const jobs = []
  if (!xmlText || typeof xmlText !== 'string') return jobs
  const items = xmlText.match(/<item[\s\S]*?<\/item>/gi) || []
  for (const item of items) {
    const get = (tag) => {
      const cdata = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?><!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, 'i'))
      if (cdata) return cdata[1].trim()
      const plain = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'i'))
      return plain ? plain[1].trim() : ''
    }
    const title = stripHtml(get('title'))
    const rawLink = get('link') || get('guid') || ''
    const link = rawLink.startsWith('http') ? rawLink : (get('link') || rawLink)
    const desc = get('description') || ''
    const company = stripHtml(get('author') || get('dc:creator') || get('source') || '')
    const email = extractEmail(item + desc)
    const pubDate = get('pubDate') || get('dc:date') || ''
    const loc = get('location') || 'Saudi Arabia'
    if (!title || !link) continue
    jobs.push({ title, link, company, email, location: loc, postedAt: pubDate, source: label, label, phones: extractPhones(desc) })
  }
  return jobs
}

/* ─── Apify LinkedIn Parser ─── */

function parseApifyLinkedIn(data, label) {
  if (!Array.isArray(data)) return []
  return data
    .filter(j => j && !j.error)
    .map(j => ({
      title: j.title || j.positionName || j.jobTitle || '',
      link: j.link || j.url || j.linkedinUrl || j.jobUrl || '',
      company: j.company || j.companyName || '',
      email: j.email || extractEmail(JSON.stringify(j)),
      location: j.location || 'Saudi Arabia',
      postedAt: j.postedAt || '',
      source: label, label,
      phones: extractPhones(JSON.stringify(j)),
    }))
    .filter(j => j.title && j.link)
}

/* ─── Direct JSON Parser (from local scrapers) ─── */

function parseDirectJson(data, label) {
  if (!Array.isArray(data)) return []
  return data
    .filter(j => j && typeof j === 'object')
    .map(j => ({
      title: j.title || j.اسم_الوظيفة || j['العنوان'] || '',
      link: j.link || j.url || j.الرابط || j['الرابط'] || '',
      company: j.company || j.شركة || j['الشركة'] || '—',
      email: j.email || j.الإيميل || j['الإيميل'] || '',
      location: j.location || j.مكان || j['المكان'] || 'Saudi Arabia',
      postedAt: j.date || j.postedAt || j.التاريخ || j['التاريخ'] || '',
      source: label, label,
      phone: j.phone || j.الجوال || '',
      phones: extractPhones((j.phone || j.الجوال || '') + ' ' + (j.desc || j.description || j.الوصف || '')),
      description: [j.desc, j.description, j.الوصف, j['النص']].filter(Boolean).join(' | '),
    }))
    .filter(j => j.title && j.link)
}

/* ─── Apify Indeed Parser ─── */

function parseApifyIndeed(data, label) {
  if (!Array.isArray(data)) return []
  return data
    .filter(j => j && !j.error)
    .map(j => ({
      title: j.positionName || j.title || '',
      link: j.jobUrl || j.url || '',
      company: j.companyName || j.company || '',
      email: j.email || extractEmail(JSON.stringify(j)),
      location: j.location || 'Saudi Arabia',
      postedAt: j.postedAt || j.date || '',
      source: label, label,
      phones: extractPhones(JSON.stringify(j)),
    }))
    .filter(j => j.title && j.link)
}

/* ─── Scoring Engine ─── */

function scoreJob(title, description) {
  const t = (title || '').toLowerCase()
  const d = (description || '').toLowerCase()
  const combined = t + ' ' + d.substring(0, 300)
  const breakdown = []
  let score = 0

  for (const wl of ['planning engineer', 'project controls engineer', 'scheduling engineer', 'project planner', 'controls engineer', 'primavera p6 engineer']) {
    if (t.includes(wl)) { score = Math.max(score, 80); breakdown.push(`whitelist:${wl}=80`); break }
  }

  let roleScore = 0
  for (const tier of ROLE_TIERS) {
    if (tier.keywords.some(kw => t.includes(kw))) {
      roleScore = tier.pts; breakdown.push(`role=${tier.pts}`); break
    }
  }
  score += roleScore

  let toolScore = 0
  for (const t2 of TOOL_KEYWORDS) {
    if (combined.includes(t2.kw)) { toolScore += t2.pts; breakdown.push(`tool:${t2.kw}=${t2.pts}`) }
  }
  score += Math.min(toolScore, 35)

  for (const s of SENIORITY_KEYWORDS) {
    if (t.includes(s.kw)) { score += s.pts; breakdown.push(`seniority:${s.kw}=${s.pts}`); break }
  }

  let sectorScore = 0
  for (const s of SECTOR_KEYWORDS) {
    if (combined.includes(s.kw)) { sectorScore += s.pts; breakdown.push(`sector:${s.kw}=${s.pts}`) }
  }
  score += Math.min(sectorScore, 30)

  for (const pen of PENALTY_KEYWORDS) {
    if (t.includes(pen)) { score -= 65; breakdown.push(`penalty:${pen}=-65`); break }
  }

  return { score, breakdown: breakdown.join('|') }
}

/* ─── Main Pipeline ─── */

export async function runPipeline({ rawJobs = [], seenJobs = [], crm = {}, config = {} }) {
  const dataDir = config.dataDir || path.resolve('data')
  const n8nDir = config.n8nDir || path.resolve('n8n-workflow')

  // 1. Parse rawJobs into unified format
  // rawJobs = [{ type: 'rss_xml', label: 'Indeed KSA', body: '<xml>' }]
  //          | [{ type: 'apify_linkedin', label: 'LinkedIn', body: [...] }]
  const allParsed = []
  for (const item of rawJobs) {
    try {
      let parsed = []
      if (item.type === 'rss_xml') parsed = parseRss(item.body, item.label)
      else if (item.type === 'direct_json') parsed = parseDirectJson(item.body, item.label)
      else if (item.type === 'apify_linkedin') parsed = parseApifyLinkedIn(item.body, item.label)
      else if (item.type === 'apify_indeed') parsed = parseApifyIndeed(item.body, item.label)
      allParsed.push(...parsed)
    } catch (e) {
      console.warn(`[Pipeline] Parse error for ${item.label}: ${e.message}`)
    }
  }

  // 2. Dedup by normalized link
  const seenSet = new Set(seenJobs.map(j => normalizeLink(j)))
  const uniqueMap = new Map()
  for (const job of allParsed) {
    const key = normalizeLink(job.link)
    if (key && !uniqueMap.has(key)) uniqueMap.set(key, job)
  }
  const deduped = [...uniqueMap.values()]

  // 3. Score
  const scored = deduped.map(j => {
    const { score, breakdown } = scoreJob(j.title, j.description || '')
    return { ...j, score, scoreBreakdown: breakdown, approved: score >= SCORE_THRESHOLD }
  }).filter(j => j.approved)
  scored.sort((a, b) => b.score - a.score)

  // 4. Extract valid emails
  const emailSet = new Set()
  const withEmail = []
  const withoutEmail = []
  for (const j of scored) {
    const email = (j.email || '').trim().toLowerCase()
    if (isValidEmail(email) && !emailSet.has(email)) {
      emailSet.add(email)
      withEmail.push({ ...j, email, hasEmail: true })
    } else {
      withoutEmail.push({ ...j, email: '', hasEmail: false })
    }
  }
  // 5. Filter against CRM — only filter if email was ALREADY SENT (not just exists)
  const crmSentEmails = new Set(Object.entries(crm.emails || {}).filter(([, v]) => v?.sent === true).map(([k]) => k.toLowerCase()))
  const crmSentLinks = new Set(Object.entries(crm.links || {}).filter(([, v]) => v?.sent === true).map(([k]) => k))
  const newWithEmail = withEmail.filter(j => {
    const em = (j.email || '').toLowerCase()
    const lk = normalizeLink(j.link)
    if (em && crmSentEmails.has(em)) return false
    if (lk && crmSentLinks.has(lk)) return false
    return true
  })
  const allNew = [...newWithEmail, ...withoutEmail.filter(j => {
    const lk = normalizeLink(j.link)
    return !crmSentLinks.has(lk)
  })]

  // 6. Store outputs
  const timestamp = Date.now()
  const sourceCounts = {}
  for (const j of allNew) {
    const src = j.label || 'unknown'
    sourceCounts[src] = (sourceCounts[src] || 0) + 1
  }

  // Update seen jobs
  const updatedSeen = [...new Set([...seenJobs, ...allNew.map(j => normalizeLink(j.link))].filter(Boolean))]

  // Update CRM
  const updatedCrm = { ...crm }
  if (!updatedCrm.emails) updatedCrm.emails = {}
  if (!updatedCrm.links) updatedCrm.links = {}
  for (const j of allNew) {
    const lk = normalizeLink(j.link)
    updatedCrm.links[lk] = { title: j.title, addedAt: timestamp, score: j.score, source: j.label }
    if (j.email) {
      const em = j.email.toLowerCase()
      if (!updatedCrm.emails[em]) {
        updatedCrm.emails[em] = { title: j.title, link: j.link, addedAt: timestamp, score: j.score, source: j.label, sent: false }
      }
    }
  }

  // 7. Write seen_jobs.json
  const seenPath = path.join(n8nDir, 'seen_jobs.json')
  fs.writeFileSync(seenPath, JSON.stringify({ jobs: updatedSeen, updatedAt: timestamp, totalSeen: updatedSeen.length }, null, 2), 'utf-8')

  // 8. Write crm.json
  const crmPath = path.join(n8nDir, 'crm.json')
  fs.writeFileSync(crmPath, JSON.stringify(updatedCrm, null, 2), 'utf-8')

  // 9. Write pending_emails.json (for n8n approval flow)
  const pendingEmails = newWithEmail.filter(j => {
    const em = (j.email || '').toLowerCase()
    const entry = updatedCrm.emails?.[em]
    return entry && !entry.sent
  })
  const pendingPath = path.join(n8nDir, 'pending_emails.json')
  fs.writeFileSync(pendingPath, JSON.stringify({ pending: pendingEmails, allJobs: allNew, savedAt: timestamp }, null, 2), 'utf-8')

  // 10. Generate report
  const report = {
    totalParsed: allParsed.length,
    totalUnique: deduped.length,
    approved: scored.length,
    withEmail: withEmail.length,
    withoutEmail: withoutEmail.length,
    newWithEmail: newWithEmail.length,
    newTotal: allNew.length,
    pendingEmails: pendingEmails.length,
    sourceCounts,
    timestamp,
  }

  console.log(`[Pipeline] ${report.totalParsed} parsed → ${report.totalUnique} unique → ${report.approved} approved → ${report.newWithEmail} new emails → ${report.pendingEmails} pending`)
  return { report, pendingEmails, allJobs: allNew, updatedSeen, updatedCrm }
}
