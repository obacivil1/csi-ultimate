"use client"

import { createContext, useContext, useState, ReactNode, useCallback } from "react"

export interface CampaignStrategy {
  keywords: string[]
  categories: string[]
  directUrls: string[]
  preset: string
}

export interface CampaignFilters {
  dateRange: { start: string; end: string } | null
  priceRange: { min: number; max: number } | null
  location: string
  adCategories: string[]
  maxAds: number
  exportFormat: string
}

export interface CampaignRuntime {
  jobIds: string[]
  progress: number
  activeSite: string
  currentPage: number
  adsDiscovered: number
  adsExtracted: number
  elapsedSeconds: number
  successRate: number
  sitesCompleted: number
  totalSites: number
  statusHistory: { timestamp: string; status: string; message: string }[]
}

export interface CampaignResults {
  totalAds: number
  dataQualityScore: number
  coverageScore: number
  sourceComparison: Record<string, { ads: number; quality: number; health: number; jobId?: string }>
  fieldCoverage: Record<string, number>
  topFindings: string[]
}

export interface Campaign {
  id: string
  name: string
  description: string
  workspaceId: string
  tags: string[]
  status: "draft" | "ready" | "running" | "completed" | "failed" | "cancelled"
  createdAt: string
  launchedAt: string | null
  completedAt: string | null
  sources: string[]
  strategy: CampaignStrategy
  filters: CampaignFilters
  runtime: CampaignRuntime | null
  results: CampaignResults | null
}

interface CampaignContextType {
  campaigns: Campaign[]
  currentCampaign: Campaign | null
  setCurrentCampaign: (id: string) => void
  createCampaign: (data: Partial<Campaign>) => Campaign
  updateCampaign: (id: string, data: Partial<Campaign>) => void
  deleteCampaign: (id: string) => void
  launchCampaign: (id: string) => Promise<void>
  pauseCampaign: (id: string) => void
  resumeCampaign: (id: string) => void
  stopCampaign: (id: string) => void
}

interface EngineCrawlJob {
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

interface EngineReport {
  reportId: string
  generatedAt: string
  site: string
  jobId?: string
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

interface HealthScore {
  site: string
  lastCrawl: string
  healthScore: number
  dataQualityScore: number
  totalAds: number
  issues: number
}

const STORAGE_KEY = "csi-campaigns"

function apiFetch(path: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
}

async function pollJob(jobId: string, signal: AbortSignal, onUpdate: (job: EngineCrawlJob) => void): Promise<EngineCrawlJob> {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (signal.aborted) { reject(new Error("Aborted")); return }
      try {
        const res = await apiFetch(`/api/crawl/${jobId}`)
        if (!res.ok) throw new Error(`Status ${res.status}`)
        const job: EngineCrawlJob = await res.json()
        onUpdate(job)
        if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
          resolve(job)
        } else {
          setTimeout(poll, 1500)
        }
      } catch (e) {
        setTimeout(poll, 2000)
      }
    }
    poll()
  })
}

function buildResultsFromReports(reports: EngineReport[], healthScores: HealthScore[], sources: string[]): CampaignResults {
  const totalAds = reports.reduce((s, r) => s + r.totalAds, 0)
  const dqScores = reports.map(r => r.metrics?.dataQualityScore || 0).filter(Boolean)
  const avgDQ = dqScores.length ? Math.round(dqScores.reduce((a, b) => a + b, 0) / dqScores.length) : 0
  const allFields = reports.reduce((acc, r) => {
    if (r.fields) {
      Object.entries(r.fields).forEach(([key, val]) => {
        if (!acc[key]) acc[key] = { present: 0, total: 0 }
        acc[key].present += val.present || 0
        acc[key].total += (val.present || 0) + (val.empty || 0)
      })
    }
    return acc
  }, {} as Record<string, { present: number; total: number }>)
  const fieldCoverage: Record<string, number> = {}
  Object.entries(allFields).forEach(([key, val]) => {
    fieldCoverage[key] = val.total > 0 ? Math.round((val.present / val.total) * 100) : 0
  })
  const sourceComparison: Record<string, { ads: number; quality: number; health: number; jobId?: string }> = {}
  for (const site of sources) {
    const report = reports.find(r => r.site === site)
    const health = healthScores.find(h => h.site === site)
    sourceComparison[site] = {
      ads: report?.totalAds || 0,
      quality: report?.metrics?.dataQualityScore || 0,
      health: health?.healthScore || 0,
      jobId: report?.jobId,
    }
  }
  const topFindings: string[] = [
    `${totalAds} records extracted from ${sources.length} sources`,
    `Average data quality score of ${avgDQ}% across all sources`,
  ]
  const sortedByHealth = [...sources].sort((a, b) => (sourceComparison[b]?.health || 0) - (sourceComparison[a]?.health || 0))
  if (sortedByHealth[0]) {
    topFindings.push(`${sortedByHealth[0]} is top performer with health score of ${sourceComparison[sortedByHealth[0]]?.health}%`)
  }
  const lowCoverageFields = Object.entries(fieldCoverage).filter(([, v]) => v < 60).map(([k]) => k)
  if (lowCoverageFields.length > 0) {
    topFindings.push(`Field coverage gaps detected: ${lowCoverageFields.join(", ")}`)
  }
  const totalIssues = reports.reduce((s, r) => s + (r.issues?.length || 0), 0)
  if (totalIssues > 0) {
    topFindings.push(`${totalIssues} data quality issues identified across sources`)
  }
  const missingPrice = reports.reduce((s, r) => {
    const pf = r.fields?.price
    return s + (pf ? pf.empty : 0)
  }, 0)
  if (missingPrice > 0) {
    topFindings.push(`Price data missing in ${missingPrice} records — revenue opportunity of $${(missingPrice * 15).toLocaleString()}`)
  }
  return {
    totalAds,
    dataQualityScore: avgDQ,
    coverageScore: fieldCoverage.title !== undefined ? fieldCoverage.title : avgDQ,
    sourceComparison,
    fieldCoverage,
    topFindings: topFindings.slice(0, 6),
  }
}

const CampaignContext = createContext<CampaignContextType | undefined>(undefined)

export function CampaignProvider({ children }: { children: ReactNode }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) try { return JSON.parse(stored) } catch {}
    }
    return []
  })
  const [currentId, setCurrentId] = useState<string>("")

  const persist = (updated: Campaign[]) => {
    setCampaigns(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }

  const currentCampaign = campaigns.find(c => c.id === currentId) || null

  const setCurrentCampaign = (id: string) => setCurrentId(id)

  const createCampaign = (data: Partial<Campaign>): Campaign => {
    const campaign: Campaign = {
      id: `cmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: data.name || "Untitled Campaign",
      description: data.description || "",
      workspaceId: data.workspaceId || "",
      tags: data.tags || [],
      status: "draft",
      createdAt: new Date().toISOString(),
      launchedAt: null,
      completedAt: null,
      sources: data.sources || [],
      strategy: data.strategy || { keywords: [], categories: [], directUrls: [], preset: "balanced" },
      filters: data.filters || { dateRange: null, priceRange: null, location: "", adCategories: [], maxAds: 200, exportFormat: "excel" },
      runtime: null,
      results: null,
    }
    const updated = [...campaigns, campaign]
    persist(updated)
    setCurrentId(campaign.id)
    return campaign
  }

  const updateCampaign = (id: string, data: Partial<Campaign>) => {
    setCampaigns(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, ...data } : c)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }

  const deleteCampaign = (id: string) => {
    const updated = campaigns.filter(c => c.id !== id)
    persist(updated)
    if (currentId === id) setCurrentId("")
  }

  const launchCampaign = async (id: string) => {
    const campaign = campaigns.find(c => c.id === id)
    if (!campaign) return

    const jobIds: string[] = []
    const startTime = Date.now()
    const runtimeAcc: CampaignRuntime = {
      jobIds: [],
      progress: 0,
      activeSite: campaign.sources[0] || "",
      currentPage: 1,
      adsDiscovered: 0,
      adsExtracted: 0,
      elapsedSeconds: 0,
      successRate: 100,
      sitesCompleted: 0,
      totalSites: campaign.sources.length,
      statusHistory: [{ timestamp: new Date().toISOString(), status: "launched", message: "Campaign launched — starting crawl jobs" }],
    }
    const syncRuntime = () => updateCampaign(id, { runtime: { ...runtimeAcc } })

    updateCampaign(id, { status: "running", launchedAt: new Date().toISOString(), runtime: { ...runtimeAcc } })

    const abortController = new AbortController()

    const startJob = async (site: string) => {
      const url = campaign.strategy.keywords.length > 0
        ? `https://www.${site}/search?q=${encodeURIComponent(campaign.strategy.keywords[0])}`
        : `https://www.${site}`
      try {
        const res = await apiFetch("/api/crawl", {
          method: "POST",
          body: JSON.stringify({ url, maxAds: campaign.filters.maxAds || 200, concurrency: 2, delay: 3000 }),
        })
        if (!res.ok) throw new Error(`Crawl start failed: ${res.status}`)
        const data = await res.json()
        jobIds.push(data.jobId)
        runtimeAcc.jobIds = [...jobIds]
        syncRuntime()
        return data.jobId as string
      } catch {
        runtimeAcc.statusHistory = [...runtimeAcc.statusHistory, { timestamp: new Date().toISOString(), status: "failed", message: `Failed to start crawl for ${site}` }]
        syncRuntime()
        return null
      }
    }

    const jobPromises = campaign.sources.map(site => startJob(site))
    const startedJobIds = (await Promise.all(jobPromises)).filter(Boolean) as string[]

    if (startedJobIds.length === 0) {
      runtimeAcc.statusHistory = [...runtimeAcc.statusHistory, { timestamp: new Date().toISOString(), status: "failed", message: "All crawl jobs failed to start" }]
      updateCampaign(id, { status: "failed", completedAt: new Date().toISOString(), runtime: { ...runtimeAcc } })
      return
    }

    let completedCount = 0
    const siteJobMap: Record<string, string> = {}
    let sidx = 0
    for (const site of campaign.sources) {
      if (startedJobIds[sidx]) {
        siteJobMap[site] = startedJobIds[sidx]
        sidx++
      }
    }

    const currentJobStates: Record<string, any> = {}

    const pollPromises = startedJobIds.map((jobId, idx) => {
      const site = campaign.sources[idx] || "unknown"
      return pollJob(jobId, abortController.signal, (job) => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        const allAdsScraped = startedJobIds.reduce((s, jid) => s + (currentJobStates[jid]?.adsScraped || 0), 0)
        const allAdsFailed = startedJobIds.reduce((s, jid) => s + (currentJobStates[jid]?.adsFailed || 0), 0)
        const totalExtracted = allAdsScraped - allAdsFailed
        const totalDiscovered = allAdsScraped + allAdsFailed
        currentJobStates[jobId] = job
        const completedJobs = startedJobIds.filter(jid => {
          const st = currentJobStates[jid]?.status
          return st === "completed" || st === "failed" || st === "cancelled"
        }).length
        const allBlocks = startedJobIds.reduce((s, jid) => s + (currentJobStates[jid]?.bansDetected || 0) + (currentJobStates[jid]?.cloudflareDetections || 0), 0)
        const successRate = totalDiscovered > 0 ? Math.max(0, Math.min(100, ((totalDiscovered - allBlocks - allAdsFailed) / totalDiscovered) * 100)) : 100
        runtimeAcc.activeSite = job.status === "running" ? site : (campaign.sources[Math.min(completedJobs, campaign.sources.length - 1)] || site)
        runtimeAcc.currentPage = Math.min(20, Math.floor(job.linksFound / 5) + 1)
        runtimeAcc.adsDiscovered = totalDiscovered
        runtimeAcc.adsExtracted = totalExtracted
        runtimeAcc.elapsedSeconds = elapsed
        runtimeAcc.successRate = Math.round(successRate)
        runtimeAcc.sitesCompleted = completedJobs
        runtimeAcc.progress = Math.round((completedJobs / campaign.sources.length) * 100)
        runtimeAcc.statusHistory = [
          ...runtimeAcc.statusHistory.slice(-50),
          { timestamp: new Date().toISOString(), status: job.status === "running" ? "extracting" : job.status, message: `${site}: ${job.adsScraped} ads scraped, ${job.adsFailed} failed (${job.progress}%)` },
        ]
        syncRuntime()
      }).then(job => {
        completedCount++
        return job
      })
    })

    try {
      const results = await Promise.all(pollPromises)
      const elapsed = Math.floor((Date.now() - startTime) / 1000)

      const reportsRes = await apiFetch("/api/reports")
      const healthRes = await apiFetch("/api/health")
      const reports: EngineReport[] = reportsRes.ok ? await reportsRes.json() : []
      const healthScores: HealthScore[] = healthRes.ok ? await healthRes.json() : []

      const campaignResults = buildResultsFromReports(reports, healthScores, campaign.sources)

      const allFailed = results.every(j => j.status === "failed")
      runtimeAcc.progress = 100
      runtimeAcc.elapsedSeconds = elapsed
      runtimeAcc.statusHistory = [
        ...runtimeAcc.statusHistory,
        { timestamp: new Date().toISOString(), status: "completed", message: `Campaign finished — ${campaignResults.totalAds} records from ${campaign.sources.length} sources` },
      ]
      updateCampaign(id, {
        status: allFailed ? "failed" : "completed",
        completedAt: new Date().toISOString(),
        runtime: { ...runtimeAcc },
        results: campaignResults,
      })
    } catch (e: any) {
      runtimeAcc.statusHistory = [
        ...runtimeAcc.statusHistory,
        { timestamp: new Date().toISOString(), status: "failed", message: `Campaign error: ${e.message}` },
      ]
      updateCampaign(id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        runtime: { ...runtimeAcc },
      })
    }
  }

  const stopRunningJobs = useCallback(async (id: string) => {
    const c = campaigns.find(x => x.id === id)
    if (!c?.runtime?.jobIds?.length) return
    await Promise.allSettled(c.runtime.jobIds.map(jobId =>
      apiFetch(`/api/crawl/${jobId}/stop`, { method: "POST" }).catch(() => {})
    ))
  }, [campaigns])

  const pauseCampaign = useCallback(async (id: string) => {
    const c = campaigns.find(x => x.id === id)
    if (!c) return
    await stopRunningJobs(id)
    const historyEntry = { timestamp: new Date().toISOString(), status: "paused", message: "Campaign paused by user — engine jobs stopped" }
    updateCampaign(id, {
      status: "ready",
      runtime: c.runtime ? { ...c.runtime, statusHistory: [...c.runtime.statusHistory, historyEntry] } : null,
    })
  }, [campaigns, stopRunningJobs])

  const resumeCampaign = useCallback((id: string) => {
    updateCampaign(id, { status: "running" })
  }, [])

  const stopCampaign = useCallback(async (id: string) => {
    const c = campaigns.find(x => x.id === id)
    if (!c) return
    await stopRunningJobs(id)
    const historyEntry = { timestamp: new Date().toISOString(), status: "cancelled", message: "Campaign stopped by user — engine jobs cancelled" }
    updateCampaign(id, {
      status: "cancelled",
      completedAt: new Date().toISOString(),
      runtime: c.runtime ? { ...c.runtime, statusHistory: [...c.runtime.statusHistory, historyEntry] } : null,
    })
  }, [campaigns, stopRunningJobs])

  return (
    <CampaignContext.Provider value={{ campaigns, currentCampaign, setCurrentCampaign, createCampaign, updateCampaign, deleteCampaign, launchCampaign, pauseCampaign, resumeCampaign, stopCampaign }}>
      {children}
    </CampaignContext.Provider>
  )
}

export function useCampaigns() {
  const ctx = useContext(CampaignContext)
  if (!ctx) throw new Error("useCampaigns must be used within CampaignProvider")
  return ctx
}
