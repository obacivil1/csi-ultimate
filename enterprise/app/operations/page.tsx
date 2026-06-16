"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Radio, Globe, Play, Activity, Clock, AlertTriangle,
  CheckCircle2, ArrowUpRight, Zap, Sparkles, StopCircle,
  RefreshCw, ListOrdered, Timer, History, ChevronRight,
  ExternalLink, Eye, Filter, Loader2,
} from "lucide-react"
import Link from "next/link"
import { cn, safeFetch, formatDate, duration } from "@/lib/utils"
import { EngineOffline } from "@/components/engine-offline"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-states"
import { Progress } from "@/components/ui/progress"

type JobItem = {
  id: string
  site: string
  status: "running" | "completed" | "failed" | "queued" | "cancelled"
  progress: number
  adsScraped: number
  adsFailed: number
  linksFound: number
  startTime: string | null
  endTime: string | null
  error: string | null
}

type ActivityEntry = {
  id: string
  type: "start" | "complete" | "fail" | "cancel" | "retry" | "extract" | "block"
  site: string
  message: string
  timestamp: string
}

const ACTIVITY_COLORS: Record<string, string> = {
  start: "text-blue-400", complete: "text-emerald-400", fail: "text-rose-400",
  cancel: "text-amber-400", retry: "text-amber-400", extract: "text-emerald-400", block: "text-rose-400",
}

function jobStatusMessage(j: JobItem): string {
  switch (j.status) {
    case "running": return `Campaign running on ${j.site}`
    case "completed": return `Campaign completed on ${j.site} — ${j.adsScraped} records`
    case "failed": return `Campaign failed on ${j.site}${j.error ? `: ${j.error}` : ""}`
    case "cancelled": return `Campaign cancelled on ${j.site}`
    case "queued": return `Campaign queued for ${j.site}`
    default: return `Status update for ${j.site}`
  }
}

export default function LiveOperationsCenter() {
  const [healthScores, setHealthScores] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)
  const [activeTab, setActiveTab] = useState("overview")
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [stopping, setStopping] = useState<Set<string>>(new Set())
  const [siteFilter, setSiteFilter] = useState("all")

  useEffect(() => {
    Promise.all([
      safeFetch("/api/health"),
      safeFetch("/api/reports"),
      safeFetch("/api/jobs"),
    ]).then(([scores, reps, rawJobs]) => {
      setHealthScores(scores)
      setReports(reps)
      setEngineOnline(scores.length > 0 || reps.length > 0)
      const jobList: JobItem[] = (rawJobs || []).map((j: any) => {
        let hostname = "unknown"
        try { hostname = new URL(j.url).hostname } catch {}
        return {
          id: j.id, site: hostname, status: j.status,
          progress: j.progress || 0,
          adsScraped: j.adsScraped || 0,
          adsFailed: j.adsFailed || 0,
          linksFound: j.linksFound || 0,
          startTime: j.startTime, endTime: j.endTime, error: j.error,
        }
      })
      setJobs(jobList)
      setActivity(jobList.filter(j => j.startTime).map(j => ({
        id: j.id, type: j.status === "failed" ? "fail" as const : j.status === "cancelled" ? "cancel" as const : j.status === "completed" ? "complete" as const : "start" as const,
        site: j.site, message: jobStatusMessage(j), timestamp: j.startTime || j.endTime || new Date().toISOString(),
      })))
      setLoading(false)
    })
  }, [])

  const handleStop = async (jobId: string) => {
    setStopping(prev => new Set(prev).add(jobId))
    try {
      await fetch(`/api/crawl/${jobId}/stop`, { method: "POST" })
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: "cancelled" as const, progress: j.progress } : j))
      setActivity(prev => [{
        id: `cancel-${Date.now()}`, type: "cancel", site: jobs.find(j => j.id === jobId)?.site || "unknown",
        message: `Campaign cancelled by operator`, timestamp: new Date().toISOString(),
      }, ...prev])
    } catch {}
    setStopping(prev => { const n = new Set(prev); n.delete(jobId); return n })
  }

  const handleRetry = async (job: JobItem) => {
    const site = job.site
    try {
      const r = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `https://www.${site}`, maxAds: 100, concurrency: 2, delay: 3000 }),
      })
      const data = await r.json()
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, id: data.jobId, status: "running", progress: 0, adsScraped: 0, adsFailed: 0, error: null, startTime: new Date().toISOString(), endTime: null } : j))
      setActivity(prev => [{
        id: `retry-${Date.now()}`, type: "retry", site,
        message: `Retrying campaign on ${site} with reduced speed`, timestamp: new Date().toISOString(),
      }, ...prev])
    } catch {}
  }

  const successRate = healthScores.length > 0
    ? Math.round(healthScores.reduce((s: number, h: any) => s + h.healthScore, 0) / healthScores.length) : 0
  const totalRecords = reports.reduce((s: number, r: any) => s + (r.totalAds || 0), 0)
  const blockedSites = healthScores.filter((h: any) => h.healthScore < 50).length
  const healthySites = healthScores.filter((h: any) => h.healthScore >= 80).length
  const warningSites = healthScores.filter((h: any) => h.healthScore >= 50 && h.healthScore < 80).length
  const runningJobs = jobs.filter(j => j.status === "running").length
  const failedJobs = jobs.filter(j => j.status === "failed").length
  const queuedJobs = jobs.filter(j => j.status === "queued").length

  const statusDot = (status: string) => {
    switch (status) {
      case "running": return "bg-blue-500 animate-pulse"
      case "completed": return "bg-emerald-500"
      case "failed": return "bg-rose-500"
      case "queued": return "bg-amber-500"
      case "cancelled": return "bg-zinc-500"
      default: return "bg-muted"
    }
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case "running": return <Badge className="bg-blue-500/10 text-blue-500 border-0 text-[10px]">Running</Badge>
      case "completed": return <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[10px]">Completed</Badge>
      case "failed": return <Badge className="bg-rose-500/10 text-rose-500 border-0 text-[10px]">Failed</Badge>
      case "queued": return <Badge className="bg-amber-500/10 text-amber-500 border-0 text-[10px]">Queued</Badge>
      case "cancelled": return <Badge className="bg-zinc-500/10 text-zinc-500 border-0 text-[10px]">Cancelled</Badge>
      default: return null
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="gradient-text">Live Operations Center</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Real-time campaign monitoring and control</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={siteFilter} onValueChange={setSiteFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <Filter className="h-3 w-3 mr-1 text-muted-foreground" />
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {healthScores.map((h: any) => <SelectItem key={h.site} value={h.site}>{h.site}</SelectItem>)}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="gap-1.5 h-8">
            <span className={cn("stat-dot", engineOnline ? "bg-emerald-500" : "bg-rose-500")} />
            {engineOnline ? "Engine Connected" : "Offline"}
          </Badge>
          <Link href="/crawl-studio">
            <Button size="sm" className="gap-1.5"><Play className="h-4 w-4" /> New Campaign</Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 animate-fade-in-up stagger-1">
            {[
              { label: "Sources Monitored", value: healthScores.length, icon: Globe, href: "/sites", color: "text-blue-400", bg: "bg-blue-500/10" },
              { label: "Running Now", value: runningJobs, icon: Radio, href: "#running", color: "text-blue-400", bg: "bg-blue-500/10" },
              { label: "Queued", value: queuedJobs, icon: ListOrdered, href: "#queued", color: "text-amber-400", bg: "bg-amber-500/10" },
              { label: "Success Rate", value: `${successRate}%`, icon: Activity, href: "", color: successRate >= 80 ? "text-emerald-400" : "text-amber-400", bg: "bg-amber-500/10" },
              { label: "Records Collected", value: totalRecords.toLocaleString(), icon: Clock, href: "/results", color: "text-violet-400", bg: "bg-violet-500/10" },
            ].map((k, i) => {
              const card = (
                <Card key={k.label} className={cn("kpi-card glass-card hover:border-primary/30 transition-all cursor-pointer group", `stagger-${i + 1}`)}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className={cn("p-2 rounded-lg", k.bg)}>
                        <k.icon className={cn("h-4 w-4", k.color)} />
                      </div>
                      <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="kpi-value text-lg">{k.value}</div>
                    <div className="kpi-label mt-0.5">{k.label}</div>
                  </CardContent>
                </Card>
              )
              return k.href ? <Link key={k.label} href={k.href}>{card}</Link> : card
            })}
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in-up stagger-3">
            <TabsList>
              <TabsTrigger value="overview" className="gap-1.5 text-xs">
                <Radio className="h-3.5 w-3.5" /> Campaign Status
              </TabsTrigger>
              <TabsTrigger value="timeline" className="gap-1.5 text-xs">
                <Timer className="h-3.5 w-3.5" /> Activity Timeline
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-4">
              {jobs.length > 0 ? (
                <div className="space-y-2">
                  {jobs.map(job => (
                    <Card key={job.id} className={cn(
                      "glass-card transition-all",
                      job.status === "running" && "border-blue-500/20",
                      job.status === "failed" && "border-rose-500/20",
                    )}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", statusDot(job.status))} />
                            <div>
                              <div className="text-sm font-medium">{job.site}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">ID: {job.id.slice(0, 12)}...</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {statusBadge(job.status)}
                            <Link href={`/jobs/${job.id}`}>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              </Button>
                            </Link>
                          </div>
                        </div>

                        {job.status === "running" && (
                          <div className="space-y-2 mb-3">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Progress</span>
                              <span className="font-medium">{job.progress}%</span>
                            </div>
                            <Progress value={job.progress} className="h-1.5" />
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-3 text-xs">
                          <div className="p-2 rounded-lg bg-muted/30 text-center">
                            <div className="text-emerald-500 font-semibold">{job.adsScraped}</div>
                            <div className="text-muted-foreground">Scraped</div>
                          </div>
                          <div className="p-2 rounded-lg bg-muted/30 text-center">
                            <div className={cn("font-semibold", job.adsFailed > 0 ? "text-rose-500" : "text-muted-foreground")}>{job.adsFailed}</div>
                            <div className="text-muted-foreground">Failed</div>
                          </div>
                          <div className="p-2 rounded-lg bg-muted/30 text-center">
                            <div className="text-foreground font-semibold">{job.linksFound}</div>
                            <div className="text-muted-foreground">Links</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/30">
                          <div className="text-[10px] text-muted-foreground">
                            {job.startTime && `Started ${formatDate(job.startTime)}`}
                            {job.endTime && ` · Ended ${formatDate(job.endTime)}`}
                          </div>
                          <div className="flex gap-1.5">
                            {(job.status === "running" || job.status === "queued") && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1 text-rose-500 border-rose-500/20 hover:bg-rose-500/10"
                                onClick={() => handleStop(job.id)}
                                disabled={stopping.has(job.id)}
                              >
                                {stopping.has(job.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <StopCircle className="h-3 w-3" />}
                                Stop
                              </Button>
                            )}
                            {job.status === "failed" && (
                              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleRetry(job)}>
                                <RefreshCw className="h-3 w-3" /> Retry
                              </Button>
                            )}
                            {job.status === "completed" && (
                              <Link href={`/results`}>
                                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> View Results
                                </Button>
                              </Link>
                            )}
                          </div>
                        </div>

                        {job.error && (
                          <div className="mt-2 text-[10px] text-rose-500 bg-rose-500/5 rounded p-1.5 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            {job.error}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className="glass-card"><CardContent>
                  <EmptyState variant="sites" title="No campaigns running" description="Launch your first campaign to start monitoring." action={
                    <Link href="/crawl-studio"><Button variant="outline" size="sm" className="gap-1.5"><Play className="h-3.5 w-3.5" /> Launch Campaign</Button></Link>
                  } className="py-8" />
                </CardContent></Card>
              )}
            </TabsContent>

            <TabsContent value="timeline" className="mt-4">
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Timer className="h-4 w-4 text-primary" />
                    Activity Timeline
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-[500px] overflow-y-auto">
                    {activity.length > 0 ? (
                      <div className="relative pl-8 pr-4 py-4 space-y-0">
                        <div className="absolute left-[15px] top-0 bottom-0 w-px bg-border/50" />
                        {activity.map((a) => (
                          <div key={a.id} className="relative pb-3 last:pb-0">
                            <div className={cn(
                              "absolute -left-[19px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background",
                              ACTIVITY_COLORS[a.type].replace("text-", "bg-")
                            )} />
                            <div className="flex items-start justify-between">
                              <div>
                                <span className="text-xs font-medium">{a.message}</span>
                                <div className="text-[10px] text-muted-foreground mt-0.5">{a.site}</div>
                              </div>
                              <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                                {formatDate(a.timestamp)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState variant="notifications" title="No activity yet" className="py-8" />
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="grid gap-6 lg:grid-cols-2 animate-fade-in-up stagger-5">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Issues Requiring Attention
                </CardTitle>
              </CardHeader>
              <CardContent>
                {blockedSites > 0 ? (
                  <div className="space-y-2">
                    {healthScores.filter((h: any) => h.healthScore < 50).map((s: any) => (
                      <div key={s.site} className="flex items-center gap-3 p-2.5 rounded-lg bg-rose-500/5 border border-rose-500/10">
                        <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{s.site}</div>
                          <div className="text-xs text-rose-500/80">Health score: {s.healthScore}% &mdash; Requires intervention</div>
                        </div>
                        <Link href="/competitive-intelligence">
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                            Diagnose <ArrowUpRight className="h-3 w-3" />
                          </Button>
                        </Link>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState variant="quality" title="All clear" description="All sources operating within expected parameters." className="py-6" />
                )}
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {[
                  { href: "/crawl-studio", label: "Launch New Campaign", desc: "Start extracting from any intelligence source", icon: Play },
                  { href: "/competitive-intelligence", label: "Compare Sources", desc: "Benchmark and rank intelligence sources", icon: Radio },
                  { href: "/results", label: "Review Results", desc: "Browse, filter, and export extraction data", icon: Activity },
                  { href: "/exports", label: "Generate Reports", desc: "Create PDF reports and scheduled exports", icon: CheckCircle2 },
                ].map(({ href, label, desc, icon: Icon }) => (
                  <Link key={href} href={href}>
                    <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer group">
                      <Icon className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium group-hover:text-foreground transition-colors">{label}</div>
                        <div className="text-xs text-muted-foreground">{desc}</div>
                      </div>
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
