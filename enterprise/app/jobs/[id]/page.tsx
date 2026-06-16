"use client"

import { useState, useEffect, useRef, use } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { cn, formatDate } from "@/lib/utils"
import {
  Square, ExternalLink, ArrowLeft, Loader2, AlertTriangle, CheckCircle2,
  Activity, Globe, Search, Link2, Zap, ShieldCheck, Smartphone, Mail,
  Clock, BarChart3, TrendingUp, Target, FileSpreadsheet, ScrollText,
} from "lucide-react"
import Link from "next/link"

export default function LiveCrawlMonitor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [status, setStatus] = useState<any>(null)
  const [events, setEvents] = useState<string[]>([])
  const [engineError, setEngineError] = useState(false)
  const [runtime, setRuntime] = useState(0)
  const eventsRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const runtimeRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addEvent = (msg: string, type?: string) => {
    const ts = new Date().toLocaleTimeString()
    setEvents(prev => [...prev.slice(-199), JSON.stringify({ ts, msg, type })])
  }

  useEffect(() => {
    if (!id) return
    // SSE connection
    const es = new EventSource(`/api/crawl/${id}/stream`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === "connected") {
          addEvent(`Connected — status: ${data.status}`, "info")
        } else if (data.type === "search") {
          addEvent(`Searching: "${data.keyword}"`, "search")
        } else if (data.type === "linksFound") {
          addEvent(`Found ${data.count} links for "${data.keyword}"`, "found")
        } else if (data.type === "adScraped") {
          addEvent(`Scraped [${data.index}/${data.total}]: ${data.url || ""} (${data.elapsed || "?"}s)`, "scraped")
        } else if (data.type === "adFailed") {
          addEvent(`Failed [${data.index}/${data.total}]: ${data.url || ""}`, "failed")
        } else if (data.type === "progress") {
          setStatus((prev: any) => prev ? {
            ...prev,
            progress: data.progress,
            adsScraped: data.scraped,
            adsFailed: data.failed,
            total: data.total,
            phoneCoverage: data.phoneCoverage,
            emailCoverage: data.emailCoverage,
            crawlSpeed: data.speed,
          } : prev)
        } else if (data.type === "scrapeComplete") {
          addEvent(`Extraction complete: ${data.scraped} scraped, ${data.failed} failed`, "complete")
        } else if (data.type === "exportComplete") {
          addEvent(`Export files generated: ${Object.keys(data.files || {}).join(", ")}`, "complete")
        } else if (data.type === "analysisComplete") {
          addEvent(`Report generated`, "complete")
        } else if (data.type === "completed") {
          addEvent(`Crawl finished successfully`, "complete")
        } else if (data.type === "failed") {
          addEvent(`Crawl failed: ${data.error || "Unknown error"}`, "error")
        } else if (data.type === "cancelled") {
          addEvent(`Crawl cancelled`, "warning")
        }
      } catch {}
    }

    es.onerror = () => {
      addEvent("SSE connection lost — falling back to polling", "warning")
      es.close()
      esRef.current = null
      // Fall back to polling
      const interval = setInterval(async () => {
        try {
          const r = await fetch(`/api/crawl/${id}`)
          const j = await r.json()
          if (j && !j.error) {
            setStatus(j)
            setEngineError(false)
            if (j.status === "completed" || j.status === "failed" || j.status === "cancelled") {
              clearInterval(interval)
            }
          } else {
            setEngineError(true)
          }
        } catch { setEngineError(true) }
      }, 2000)
      return () => clearInterval(interval)
    }

    // Fetch initial status
    fetch(`/api/crawl/${id}`).then(r => r.json()).then(j => {
      if (j && !j.error) { setStatus(j); setEngineError(false) }
      else { setEngineError(true) }
    }).catch(() => setEngineError(true))

    return () => { es.close(); esRef.current = null }
  }, [id])

  // Runtime timer
  useEffect(() => {
    if (status?.startTime && status?.status === "running") {
      runtimeRef.current = setInterval(() => {
        setRuntime(Math.floor((Date.now() - new Date(status.startTime).getTime()) / 1000))
      }, 1000)
    }
    return () => { if (runtimeRef.current) clearInterval(runtimeRef.current) }
  }, [status?.startTime, status?.status])

  // Auto-scroll event log
  useEffect(() => {
    if (eventsRef.current) {
      eventsRef.current.scrollTop = eventsRef.current.scrollHeight
    }
  }, [events])

  const handleStop = async () => {
    addEvent("Stop requested by user", "warning")
    try {
      const r = await fetch(`/api/crawl/${id}/stop`, { method: "POST" })
      const j = await r.json()
      if (j.status === "cancelled") addEvent("Crawl stopped successfully", "warning")
    } catch { addEvent("Failed to stop crawl", "error") }
  }

  const runtimeStr = runtime >= 3600
    ? `${Math.floor(runtime / 3600)}h ${Math.floor((runtime % 3600) / 60)}m ${runtime % 60}s`
    : runtime >= 60
      ? `${Math.floor(runtime / 60)}m ${runtime % 60}s`
      : `${runtime}s`

  const successRate = (status?.adsScraped + status?.adsFailed) > 0
    ? Math.round((status.adsScraped / (status.adsScraped + status.adsFailed)) * 100)
    : 0

  const isRunning = status?.status === "running" || status?.status === "queued"
  const isComplete = status?.status === "completed"
  const isFailed = status?.status === "failed"
  const isCancelled = status?.status === "cancelled"

  const progressPercent = status?.progress || 0
  const barColor = isComplete ? "oklch(0.55 0.18 160)"
    : isFailed || isCancelled ? "oklch(0.58 0.24 30)"
    : "oklch(0.6 0.2 270)"

  const lastEvent = events.length > 0 ? (() => {
    try { return JSON.parse(events[events.length - 1]) } catch { return null }
  })() : null

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in-up">
        <div className="flex items-center gap-4">
          <Link href="/jobs"><Button variant="ghost" size="icon" className="shrink-0"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight">Live Crawl Monitor</h1>
              <Badge variant={isComplete ? "success" : isFailed ? "destructive" : isCancelled ? "warning" : "default"}
                className={cn("animate-fade-in-up", isRunning && "animate-pulse")}>
                {isRunning && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                {status?.status || "loading"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5 flex items-center gap-2">
              <span>Job: {id}</span>
              {status?.url && <><span className="opacity-30">|</span><span>{status.url}</span></>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Button variant="outline" size="sm" onClick={handleStop} className="gap-1.5 border-rose-500/30 hover:bg-rose-500/10 hover:border-rose-500/50">
              <Square className="h-3.5 w-3.5 text-rose-500" /> Stop
            </Button>
          )}
          <Link href={`/results?id=${id}`}>
            <Button variant="outline" size="sm" disabled={!isComplete} className="gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" /> Results
            </Button>
          </Link>
          <Link href={`/api/crawl/${id}/export?format=xlsx`}>
            <Button variant="outline" size="sm" disabled={!isComplete} className="gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Export
            </Button>
          </Link>
        </div>
      </div>

      {engineError ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="p-3 rounded-full bg-amber-500/10 w-fit mx-auto mb-4">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Job Not Found</h2>
            <p className="text-muted-foreground mb-2">The engine is offline or this job ID does not exist.</p>
            <Link href="/jobs"><Button variant="outline"><ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Jobs</Button></Link>
          </CardContent>
        </Card>
      ) : !status ? (
        <Card>
          <CardContent className="py-12 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading job data...
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Progress bar */}
          <div className="animate-fade-in-up stagger-1">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="font-medium">{progressPercent}% complete</span>
              <span className="text-muted-foreground text-xs">{status.adsScraped || 0} / {status.total || "?"} records</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500 ease-out" style={{
                width: `${progressPercent}%`,
                background: `linear-gradient(90deg, ${barColor}, oklch(0.6 0.2 270 / 0.6))`,
              }} />
            </div>
          </div>

          {/* Live Intelligence Metrics Grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 animate-fade-in-up stagger-1">
            {[
              { label: "Records Found", value: status.adsScraped || 0, icon: Target, color: "text-emerald-500", bg: "bg-emerald-500/10", format: (v: number) => v.toLocaleString() },
              { label: "Failed", value: status.adsFailed || 0, icon: AlertTriangle, color: "text-rose-500", bg: "bg-rose-500/10" },
              { label: "Success Rate", value: `${successRate}%`, icon: TrendingUp, color: successRate >= 80 ? "text-emerald-500" : successRate >= 50 ? "text-amber-500" : "text-rose-500", bg: "bg-muted/50" },
              { label: "Crawl Speed", value: status.crawlSpeed ? `${status.crawlSpeed}/min` : "—", icon: Zap, color: "text-blue-400", bg: "bg-blue-500/10" },
              { label: "Phone Coverage", value: status.phoneCoverage != null ? `${status.phoneCoverage}%` : "—", icon: Smartphone, color: status.phoneCoverage >= 60 ? "text-emerald-500" : "text-amber-500", bg: "bg-muted/50" },
              { label: "Email Coverage", value: status.emailCoverage != null ? `${status.emailCoverage}%` : "—", icon: Mail, color: status.emailCoverage >= 60 ? "text-emerald-500" : "text-amber-500", bg: "bg-muted/50" },
              { label: "Runtime", value: runtimeStr, icon: Clock, color: "text-muted-foreground", bg: "bg-muted/50" },
            ].map((m, i) => (
              <Card key={m.label} className="glass-card animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className={cn("p-1.5 rounded-md", m.bg)}>
                      <m.icon className={cn("h-3.5 w-3.5", m.color)} />
                    </div>
                  </div>
                  <div className={cn("text-lg font-bold tabular-nums", m.color)}>{m.format ? m.format(m.value as number) : m.value}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider font-medium">{m.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Two-column layout */}
          <div className="grid gap-6 lg:grid-cols-2 animate-fade-in-up stagger-2">
            {/* Intelligence Log */}
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ScrollText className="h-4 w-4 text-primary" /> Intelligence Stream
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] font-mono">{events.length} events</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div ref={eventsRef} className="h-[320px] overflow-y-auto font-mono text-[11px] leading-relaxed bg-black/30 rounded-lg p-3 space-y-1">
                  {events.length === 0 ? (
                    <div className="text-muted-foreground italic">Awaiting intelligence stream...</div>
                  ) : (
                    events.map((raw, i) => {
                      let msg = "", type = "info"
                      try { const p = JSON.parse(raw); msg = p.msg; type = p.type } catch { msg = raw }
                      const isErr = type === "error" || type === "failed"
                      const isOk = type === "complete" || type === "found"
                      const isSearch = type === "search"
                      const isWarn = type === "warning"
                      const isScraped = type === "scraped"
                      return (
                        <div key={i} className={cn(
                          "flex items-start gap-2",
                          isErr ? "text-rose-400" : isOk ? "text-emerald-400" : isSearch ? "text-blue-400" : isWarn ? "text-amber-400" : isScraped ? "text-foreground" : "text-muted-foreground"
                        )}>
                          <span className="opacity-40 shrink-0">
                            {isErr ? "✗" : isOk ? "✓" : isSearch ? "→" : isWarn ? "!" : isScraped ? "•" : " "}
                          </span>
                          <span className="opacity-40 shrink-0">
                            {(() => { try { return JSON.parse(raw).ts } catch { return "" } })()}
                          </span>
                          <span className="break-all">{msg}</span>
                        </div>
                      )
                    })
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Job Details Panel */}
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" /> Operation Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-sm">
                  {[
                    ["Job ID", status.id, true],
                    ["Status", status.status, false],
                    ["Source URL", status.url || "—", true],
                    ["Search Query", status.search || "—", true],
                    ["Max Records", status.maxAds || "—", false],
                    ["Concurrency", status.concurrency || "—", false],
                    ["Delay", status.delay ? `${status.delay}ms` : "—", false],
                    ["Links Found", status.linksFound || 0, false],
                    ["Records Scraped", status.adsScraped || 0, false],
                    ["Records Failed", status.adsFailed || 0, false],
                    ["Phone Coverage", status.phoneCoverage != null ? `${status.phoneCoverage}%` : "—", false],
                    ["Email Coverage", status.emailCoverage != null ? `${status.emailCoverage}%` : "—", false],
                    ["Retries", status.retries || 0, false],
                    ["Bans Detected", status.bansDetected || 0, false],
                    ["Start Time", status.startTime ? new Date(status.startTime).toLocaleString() : "—", false],
                    ["End Time", status.endTime ? new Date(status.endTime).toLocaleString() : "In progress", false],
                  ].map(([label, value, mono]) => (
                    <div key={label as string} className="flex justify-between py-1 border-b border-border/20 last:border-0">
                      <span className="text-xs text-muted-foreground">{label as string}</span>
                      <span className={cn("text-xs font-medium", mono && "font-mono")}>{String(value)}</span>
                    </div>
                  ))}
                  {status?.error && (
                    <div className="flex items-center gap-2 p-2 rounded bg-rose-500/10 text-rose-500 text-xs mt-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>{status.error}</span>
                    </div>
                  )}
                </div>

                {/* Live activity indicator */}
                {isRunning && lastEvent && (
                  <div className="mt-4 p-2 rounded-lg bg-primary/5 border border-primary/10 flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                    <span className="text-muted-foreground truncate">
                      {(() => { try { return JSON.parse(events[events.length - 1]).msg } catch { return "Processing..." } })()}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Completion banners */}
          {isComplete && (
            <Card className="border-emerald-500/30 animate-fade-in-up">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-2 rounded-full bg-emerald-500/20">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Crawl completed successfully</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {status.adsScraped} records extracted — {successRate}% success rate — {runtimeStr} runtime
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link href={`/results?id=${id}`}><Button variant="outline" size="sm" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> View Results</Button></Link>
                  <Link href={`/api/crawl/${id}/export?format=xlsx`}><Button size="sm" className="gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5" /> Download Excel</Button></Link>
                </div>
              </CardContent>
            </Card>
          )}

          {isFailed && (
            <Card className="border-rose-500/30 animate-fade-in-up">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-2 rounded-full bg-rose-500/20">
                  <AlertTriangle className="h-6 w-6 text-rose-500" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Crawl failed</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{status.error || "An unexpected error occurred during extraction."}</p>
                </div>
                <Link href="/crawl-studio"><Button variant="outline" className="gap-1.5"><Zap className="h-3.5 w-3.5" /> New Crawl</Button></Link>
              </CardContent>
            </Card>
          )}

          {isCancelled && (
            <Card className="border-amber-500/30 animate-fade-in-up">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-2 rounded-full bg-amber-500/20">
                  <AlertTriangle className="h-6 w-6 text-amber-500" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Crawl cancelled</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {status.adsScraped > 0 ? `${status.adsScraped} records were extracted before cancellation.` : "No records were extracted."}
                  </p>
                </div>
                <Link href="/crawl-studio"><Button variant="outline" className="gap-1.5"><Zap className="h-3.5 w-3.5" /> New Crawl</Button></Link>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
