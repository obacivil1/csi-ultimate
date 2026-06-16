export interface SiteInfo {
  hostname: string
  name: string
  language: string
  categories: boolean
  searchEndpoint: string
  extractionSelectors: string[]
}

export interface CrawlJob {
  id: string
  status: string
  progress: number
  adsScraped: number
  adsFailed: number
  bansDetected: number
  cloudflareDetections: number
  retries: number
  linksFound: number
  startTime: string | null
  endTime: string | null
  error: string | null
}

export interface Report {
  reportId: string
  generatedAt: string
  site: string
  totalAds: number
  fields: Record<string, { present: number; empty: number; pct: number }>
  metrics: {
    dataQualityScore: number
    siteHealthScore: number
    extractionRate: number
    blockedPages: number
    cloudflareDetections: number
    retries: number
  }
  issues: string[]
  configSuggestions: string[]
}

export interface HealthScore {
  site: string
  lastCrawl: string
  healthScore: number
  dataQualityScore: number
  totalAds: number
  issues: number
}

async function fetchAPI(path: string, init?: RequestInit) {
  const base = `http://localhost:${process.env.CSI_PORT || 3030}`
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`)
  return res.json()
}

export async function getSites(): Promise<SiteInfo[]> {
  return fetchAPI("/api/sites")
}

export async function getSiteConfig(hostname: string): Promise<any> {
  return fetchAPI(`/api/sites/${hostname}`)
}

export async function startCrawl(params: {
  url: string
  search?: string
  maxAds?: number
  concurrency?: number
  delay?: number
}): Promise<{ jobId: string }> {
  return fetchAPI("/api/crawl", {
    method: "POST",
    body: JSON.stringify(params),
  })
}

export async function getCrawlStatus(jobId: string): Promise<CrawlJob> {
  return fetchAPI(`/api/crawl/${jobId}`)
}

export async function getCrawlResults(jobId: string): Promise<any> {
  return fetchAPI(`/api/crawl/${jobId}/results`)
}

export async function getReports(): Promise<Report[]> {
  return fetchAPI("/api/reports")
}

export async function getLatestReport(site?: string): Promise<Report | null> {
  const qs = site ? `?site=${encodeURIComponent(site)}` : ""
  return fetchAPI(`/api/reports/latest${qs}`)
}

export async function getHealthScores(): Promise<HealthScore[]> {
  return fetchAPI("/api/health")
}

export function getCrawlStreamURL(jobId: string): string {
  const port = process.env.NEXT_PUBLIC_CSI_PORT || 3030
  return `http://localhost:${port}/api/crawl/${jobId}/stream`
}
