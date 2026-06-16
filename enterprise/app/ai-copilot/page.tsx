"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sparkles, AlertTriangle, TrendingUp, TrendingDown, ShieldCheck,
  Globe, Activity, FileSearch, Zap, Lightbulb, Radar, ArrowUpRight,
  Clock, BrainCircuit, Ban, ExternalLink, ChevronRight,
  Gauge, Search as SearchIcon, Target, BarChart3,
} from "lucide-react"
import Link from "next/link"
import { cn, safeFetch } from "@/lib/utils"
import { EngineOffline } from "@/components/engine-offline"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-states"
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, Cell,
} from "recharts"

interface Anomaly {
  id: string
  site: string
  type: "spike" | "drop" | "blockage" | "degradation"
  severity: "critical" | "warning" | "info"
  metric: string
  currentValue: number
  expectedValue: number
  deviation: number
  description: string
  timestamp: string
}

interface TrendSignal {
  site: string
  metric: string
  direction: "up" | "down" | "stable"
  magnitude: number
  period: string
  insight: string
}

interface Recommendation {
  id: string
  site: string
  priority: "high" | "medium" | "low"
  category: "config" | "extraction" | "blocking" | "quality"
  title: string
  description: string
  impact: string
  actionLabel: string
  actionHref: string
}

const COLORS = {
  critical: "oklch(0.58 0.24 30)",
  warning: "oklch(0.6 0.2 80)",
  info: "oklch(0.6 0.2 270)",
}

function generateAnomalies(reports: any[], healthScores: any[]): Anomaly[] {
  const result: Anomaly[] = []
  for (const r of reports) {
    if (r.metrics?.dataQualityScore < 50) {
      result.push({
        id: `anom-dq-${r.reportId}`,
        site: r.site,
        type: "degradation",
        severity: "critical",
        metric: "Data Quality",
        currentValue: r.metrics.dataQualityScore,
        expectedValue: 80,
        deviation: 80 - r.metrics.dataQualityScore,
        description: `Data quality dropped to ${r.metrics.dataQualityScore}% for ${r.site}. Critical extraction gaps detected.`,
        timestamp: r.generatedAt,
      })
    }
    if (r.metrics?.extractionRate < 60) {
      result.push({
        id: `anom-extract-${r.reportId}`,
        site: r.site,
        type: "drop",
        severity: r.metrics.extractionRate < 30 ? "critical" : "warning",
        metric: "Extraction Rate",
        currentValue: r.metrics.extractionRate,
        expectedValue: 85,
        deviation: 85 - r.metrics.extractionRate,
        description: `Extraction rate at ${r.metrics.extractionRate}% — significantly below optimal threshold.`,
        timestamp: r.generatedAt,
      })
    }
    if (r.metrics?.blockedPages > 5) {
      result.push({
        id: `anom-block-${r.reportId}`,
        site: r.site,
        type: "blockage",
        severity: r.metrics.blockedPages > 20 ? "critical" : "warning",
        metric: "Blocked Pages",
        currentValue: r.metrics.blockedPages,
        expectedValue: 0,
        deviation: r.metrics.blockedPages,
        description: `${r.metrics.blockedPages} pages blocked on ${r.site} — potential IP ban or CAPTCHA challenge.`,
        timestamp: r.generatedAt,
      })
    }
    if (r.metrics?.retries > 10) {
      result.push({
        id: `anom-retry-${r.reportId}`,
        site: r.site,
        type: "degradation",
        severity: r.metrics.retries > 30 ? "critical" : "warning",
        metric: "Retries",
        currentValue: r.metrics.retries,
        expectedValue: 3,
        deviation: r.metrics.retries - 3,
        description: `Excessive retries (${r.metrics.retries}) for ${r.site} — indicates site structure changes.`,
        timestamp: r.generatedAt,
      })
    }
  }
  for (const h of healthScores) {
    if (h.healthScore < 40) {
      result.push({
        id: `anom-health-${h.site}`,
        site: h.site,
        type: "degradation",
        severity: "critical",
        metric: "Source Health",
        currentValue: h.healthScore,
        expectedValue: 80,
        deviation: 80 - h.healthScore,
        description: `Source health critically low at ${h.healthScore}% for ${h.site}. Immediate investigation required.`,
        timestamp: h.lastCrawl,
      })
    }
  }
  return result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

function generateTrendSignals(reports: any[]): TrendSignal[] {
  const signals: TrendSignal[] = []
  const siteGroups: Record<string, any[]> = {}
  reports.forEach(r => {
    if (!siteGroups[r.site]) siteGroups[r.site] = []
    siteGroups[r.site].push(r)
  })
  for (const [site, reps] of Object.entries(siteGroups)) {
    if (reps.length >= 2) {
      const sorted = reps.sort((a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime())
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      if (last.totalAds && first.totalAds) {
        const change = ((last.totalAds - first.totalAds) / first.totalAds) * 100
        if (Math.abs(change) > 10) {
          signals.push({
            site, metric: "Address Capture Rate",
            direction: change > 0 ? "up" : "down",
            magnitude: Math.abs(change),
            period: `${sorted.length} reports`,
            insight: `${site} address capture ${change > 0 ? "increased" : "decreased"} by ${Math.abs(change).toFixed(0)}% over ${sorted.length} runs.`,
          })
        }
      }
      if (last.metrics?.dataQualityScore && first.metrics?.dataQualityScore) {
        const dqChange = last.metrics.dataQualityScore - first.metrics.dataQualityScore
        if (Math.abs(dqChange) > 5) {
          signals.push({
            site, metric: "Data Quality",
            direction: dqChange > 0 ? "up" : "down",
            magnitude: Math.abs(dqChange),
            period: `${sorted.length} reports`,
            insight: `${site} data quality ${dqChange > 0 ? "improved" : "declined"} by ${Math.abs(dqChange).toFixed(0)} points across ${sorted.length} reports.`,
          })
        }
      }
    }
  }
  return signals
}

function generateRecommendations(reports: any[], healthScores: any[]): Recommendation[] {
  const recs: Recommendation[] = []
  for (const r of reports) {
    if (r.metrics?.extractionRate < 70) {
      recs.push({
        id: `rec-extract-${r.reportId}`,
        site: r.site,
        priority: r.metrics.extractionRate < 40 ? "high" : "medium",
        category: "extraction",
        title: "Optimize extraction selectors",
        description: `Extraction rate at ${r.metrics.extractionRate}% — review and update CSS selectors for ${r.site}.`,
        impact: "Restore full data capture",
        actionLabel: "Edit Config",
        actionHref: `/crawl-studio?site=${r.site}`,
      })
    }
    if (r.metrics?.blockedPages > 0) {
      recs.push({
        id: `rec-block-${r.reportId}`,
        site: r.site,
        priority: r.metrics.blockedPages > 10 ? "high" : "medium",
        category: "blocking",
        title: "Configure anti-blocking measures",
        description: `${r.metrics.blockedPages} pages blocked on ${r.site}. Increase delays and enable Cloudflare bypass.`,
        impact: "Reduce blockage by up to 90%",
        actionLabel: "Adjust Crawl Config",
        actionHref: `/crawl-studio?site=${r.site}`,
      })
    }
    if (r.configSuggestions?.length > 0) {
      r.configSuggestions.forEach((s: string, i: number) => {
        recs.push({
          id: `rec-config-${r.reportId}-${i}`,
          site: r.site,
          priority: "medium",
          category: "config",
          title: s.slice(0, 50) + (s.length > 50 ? "..." : ""),
          description: s,
          impact: "Improve extraction reliability",
          actionLabel: "View Settings",
          actionHref: `/crawl-studio?site=${r.site}`,
        })
      })
    }
    if (r.issues?.length > 0) {
      r.issues.forEach((issue: string, i: number) => {
        recs.push({
          id: `rec-issue-${r.reportId}-${i}`,
          site: r.site,
          priority: "high",
          category: "quality",
          title: issue.slice(0, 50) + (issue.length > 50 ? "..." : ""),
          description: issue,
          impact: "Resolve data quality issue",
          actionLabel: "Fix Issue",
          actionHref: `/operations?site=${r.site}`,
        })
      })
    }
  }
  return recs.slice(0, 20)
}

export default function AIInsightsEngine() {
  const [reports, setReports] = useState<any[]>([])
  const [healthScores, setHealthScores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)
  const [siteFilter, setSiteFilter] = useState("all")
  const [activeTab, setActiveTab] = useState("overview")

  useEffect(() => {
    Promise.all([
      safeFetch("/api/reports"),
      safeFetch("/api/health"),
    ]).then(([reps, scores]) => {
      setReports(reps)
      setHealthScores(scores)
      setEngineOnline(reps.length > 0 || scores.length > 0)
      setLoading(false)
    })
  }, [])

  const sites = [...new Set([...reports.map((r: any) => r.site), ...healthScores.map((h: any) => h.site)])].sort()

  const filteredReports = siteFilter === "all" ? reports : reports.filter((r: any) => r.site === siteFilter)
  const filteredHealth = siteFilter === "all" ? healthScores : healthScores.filter((h: any) => h.site === siteFilter)

  const anomalies = useMemo(() => generateAnomalies(reports, healthScores), [reports, healthScores])
  const filteredAnomalies = siteFilter === "all" ? anomalies : anomalies.filter(a => a.site === siteFilter)

  const trendSignals = useMemo(() => generateTrendSignals(reports), [reports])
  const filteredSignals = siteFilter === "all" ? trendSignals : trendSignals.filter(s => s.site === siteFilter)

  const recommendations = useMemo(() => generateRecommendations(reports, healthScores), [reports, healthScores])
  const filteredRecs = siteFilter === "all" ? recommendations : recommendations.filter(r => r.site === siteFilter)

  const blockedSites = filteredHealth.filter((h: any) => h.healthScore < 50).length
  const warningSites = filteredHealth.filter((h: any) => h.healthScore >= 50 && h.healthScore < 80).length
  const healthySites = filteredHealth.filter((h: any) => h.healthScore >= 80).length

  const criticalAnomalies = filteredAnomalies.filter(a => a.severity === "critical").length
  const warningAnomalies = filteredAnomalies.filter(a => a.severity === "warning").length

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return { text: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20", dot: "bg-rose-500" }
      case "warning": return { text: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20", dot: "bg-amber-500" }
      default: return { text: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20", dot: "bg-blue-500" }
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "spike": return TrendingUp
      case "drop": return TrendingDown
      case "blockage": return Ban
      default: return Activity
    }
  }

  const anomalyTypeData = useMemo(() => {
    const counts = { spike: 0, drop: 0, blockage: 0, degradation: 0 }
    filteredAnomalies.forEach(a => { (counts as any)[a.type]++ })
    return Object.entries(counts).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))
  }, [filteredAnomalies])

  const severityData = useMemo(() => {
    const counts = { critical: 0, warning: 0, info: 0 }
    filteredAnomalies.forEach(a => { (counts as any)[a.severity]++ })
    return Object.entries(counts).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))
  }, [filteredAnomalies])

  const trendChartData: { name: string; quality: number; health: number }[] = []

  return (
    <div className="p-6 space-y-6">
      {/* Header with filtering */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="gradient-text">AI Insights Engine</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2">
            <BrainCircuit className="h-3.5 w-3.5" />
            Anomaly detection, trend analysis & automated recommendations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={siteFilter} onValueChange={setSiteFilter}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sites.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="gap-1.5 h-8 px-3 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI Engine
          </Badge>
        </div>
      </div>

      {loading ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : reports.length === 0 && healthScores.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              variant="data"
              title="No intelligence data available"
              description="Run a campaign to generate AI-powered insights and recommendations."
              action={
                <Link href="/crawl-studio">
                  <Button variant="outline" className="gap-1.5"><Zap className="h-4 w-4" /> Launch Campaign</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI Strip — all clickable */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in-up stagger-1">
            <Link href="#anomalies" onClick={() => setActiveTab("anomalies")}>
              <Card className="kpi-card glass-card hover:border-rose-500/30 transition-all cursor-pointer">
                <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="p-2 rounded-lg bg-rose-500/10"><AlertTriangle className="h-4 w-4 text-rose-400" /></div>
                    </div>
                  <div className="kpi-value text-lg">{criticalAnomalies}</div>
                  <div className="kpi-label">Critical Anomalies</div>
                </CardContent>
              </Card>
            </Link>
            <Link href="#anomalies" onClick={() => setActiveTab("anomalies")}>
              <Card className="kpi-card glass-card hover:border-amber-500/30 transition-all cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="p-2 rounded-lg bg-amber-500/10"><Activity className="h-4 w-4 text-amber-400" /></div>
                  </div>
                  <div className="kpi-value text-lg">{warningAnomalies}</div>
                  <div className="kpi-label">Warnings</div>
                </CardContent>
              </Card>
            </Link>
            <Link href="#trends" onClick={() => setActiveTab("trends")}>
              <Card className="kpi-card glass-card hover:border-primary/30 transition-all cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="p-2 rounded-lg bg-blue-500/10"><TrendingUp className="h-4 w-4 text-blue-400" /></div>
                  </div>
                  <div className="kpi-value text-lg">{filteredSignals.length}</div>
                  <div className="kpi-label">Trend Signals</div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/data-quality">
              <Card className="kpi-card glass-card hover:border-emerald-500/30 transition-all cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="p-2 rounded-lg bg-emerald-500/10"><Target className="h-4 w-4 text-emerald-400" /></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="kpi-value text-lg">{healthySites}</div>
                    <span className="text-xs text-muted-foreground">/ {filteredHealth.length}</span>
                  </div>
                  <div className="kpi-label">Healthy Sources</div>
                </CardContent>
              </Card>
            </Link>
          </div>

          {/* Intelligence Summary */}
          <Card className="glass-card gradient-border animate-fade-in-up stagger-2">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <BrainCircuit className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold mb-1">AI Intelligence Summary</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {criticalAnomalies > 0
                      ? <><span className="text-rose-500 font-medium">{criticalAnomalies}</span> critical issue{criticalAnomalies > 1 ? "s" : ""} require{criticalAnomalies === 1 ? "s" : ""} immediate attention. </>
                      : "No critical anomalies detected. "}
                    {warningAnomalies > 0
                      ? <><span className="text-amber-500 font-medium">{warningAnomalies}</span> warning{warningAnomalies > 1 ? "s" : ""} identified for review. </>
                      : ""}
                    {trendSignals.length > 0
                      ? <><span className="text-blue-500 font-medium">{trendSignals.length}</span> significant trend{trendSignals.length > 1 ? "s" : ""} detected. </>
                      : "No significant trends identified. "}
                    {recommendations.length > 0
                      ? <><span className="text-emerald-500 font-medium">{recommendations.length}</span> recommendation{recommendations.length > 1 ? "s" : ""} available. </>
                      : "All sources operating within expected parameters."}
                    {siteFilter !== "all" && <span className="text-muted-foreground/60"> Filtered to: <span className="font-medium">{siteFilter}</span></span>}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Main Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in-up stagger-3">
            <TabsList className="flex-wrap">
              <TabsTrigger value="overview" className="gap-1.5">
                <Radar className="h-3.5 w-3.5" /> Overview
              </TabsTrigger>
              <TabsTrigger value="anomalies" className="gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Anomalies
                {criticalAnomalies > 0 && <span className="h-4 px-1.5 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center">{criticalAnomalies}</span>}
              </TabsTrigger>
              <TabsTrigger value="trends" className="gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> Trends
              </TabsTrigger>
              <TabsTrigger value="recommendations" className="gap-1.5">
                <Lightbulb className="h-3.5 w-3.5" /> Recommendations
                {recommendations.length > 0 && <span className="h-4 px-1.5 rounded-full bg-primary/20 text-[9px] font-bold text-primary flex items-center">{recommendations.length}</span>}
              </TabsTrigger>
            </TabsList>

            {/* Overview */}
            <TabsContent value="overview" className="space-y-6">
              {/* Anomaly Type Distribution */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="glass-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-rose-500" /> Anomalies by Type
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={anomalyTypeData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.05)" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "oklch(0.55 0 0)" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "oklch(0.55 0 0)" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: "oklch(0.1 0.02 260 / 0.95)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: "8px", fontSize: "12px" }} />
                        <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]}>
                          {anomalyTypeData.map((_, i) => (
                            <Cell key={i} fill={i === 2 ? COLORS.critical : i === 1 ? COLORS.warning : i === 0 ? COLORS.info : "oklch(0.6 0.2 270 / 0.5)"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card className="glass-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold flex items-center gap-2">
                      <Gauge className="h-3.5 w-3.5 text-amber-500" /> Quality & Health Trend
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="h-52 flex items-center justify-center">
                    <div className="text-center max-w-xs">
                      <BarChart3 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">Trend data requires repeated crawls over time.</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Anomaly Summary List */}
              <Card className="glass-card" id="anomalies">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-500" /> Recent Anomalies
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => setActiveTab("anomalies")}>
                    View All <ChevronRight className="h-3 w-3" />
                  </Button>
                </CardHeader>
                <CardContent className="pt-0">
                  {filteredAnomalies.length > 0 ? (
                    <div className="divide-y divide-border/30">
                      {filteredAnomalies.slice(0, 5).map(a => {
                        const severityColor = getSeverityColor(a.severity)
                        const TypeIcon = getTypeIcon(a.type)
                        return (
                          <div key={a.id} className="flex items-start gap-3 py-2.5 hover:bg-accent/30 transition-colors -mx-2 px-2 rounded-lg">
                            <div className={cn("p-1.5 rounded-md", severityColor.bg)}>
                              <TypeIcon className={cn("h-3.5 w-3.5", severityColor.text)} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium">{a.site}</span>
                                <Badge variant="outline" className={cn("text-[9px] border-0 px-1.5", severityColor.bg, severityColor.text)}>
                                  {a.severity}
                                </Badge>
                                <Badge variant="outline" className="text-[9px] text-muted-foreground bg-muted/30 border-0 px-1.5">{a.metric}</Badge>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{a.description}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <EmptyState variant="quality" title="No anomalies detected" description="All sources are performing within expected parameters." className="py-6" />
                  )}
                </CardContent>
              </Card>

              {/* Quick Recommendations */}
              <Card className="glass-card">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-xs font-semibold flex items-center gap-2">
                    <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> Top Recommendations
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => setActiveTab("recommendations")}>
                    View All <ChevronRight className="h-3 w-3" />
                  </Button>
                </CardHeader>
                <CardContent className="pt-0">
                  {filteredRecs.length > 0 ? (
                    <div className="divide-y divide-border/30">
                      {filteredRecs.slice(0, 4).map(r => (
                        <div key={r.id} className="flex items-start gap-3 py-2.5 hover:bg-accent/30 transition-colors -mx-2 px-2 rounded-lg">
                          <div className={cn(
                            "p-1.5 rounded-md",
                            r.priority === "high" ? "bg-rose-500/10" : r.priority === "medium" ? "bg-amber-500/10" : "bg-blue-500/10"
                          )}>
                            <FileSearch className={cn(
                              "h-3.5 w-3.5",
                              r.priority === "high" ? "text-rose-500" : r.priority === "medium" ? "text-amber-500" : "text-blue-500"
                            )} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium">{r.site}</span>
                              <Badge variant="outline" className={cn(
                                "text-[9px] border-0 px-1.5",
                                r.priority === "high" ? "bg-rose-500/10 text-rose-500" : "bg-amber-500/10 text-amber-500"
                              )}>{r.priority}</Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{r.title}</p>
                          </div>
                          <Link href={r.actionHref}>
                            <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1">
                              {r.actionLabel} <ArrowUpRight className="h-2.5 w-2.5" />
                            </Button>
                          </Link>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState variant="search" title="No recommendations" description="All sources configured optimally." className="py-6" />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Anomalies Tab */}
            <TabsContent value="anomalies" className="space-y-4">
              <Card className="glass-card">
                <CardContent className="p-0 divide-y divide-border/30">
                  {filteredAnomalies.length > 0 ? (
                    filteredAnomalies.map(a => {
                      const s = getSeverityColor(a.severity)
                      const TypeIcon = getTypeIcon(a.type)
                      return (
                        <div key={a.id} className="flex items-start gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                          <div className={cn("p-1.5 rounded-md shrink-0", s.bg)}>
                            <TypeIcon className={cn("h-4 w-4", s.text)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{a.site}</span>
                              <Badge variant="outline" className={cn("text-[9px] border-0 px-1.5", s.bg, s.text)}>{a.severity}</Badge>
                              <Badge className="text-[9px] bg-muted/30 text-muted-foreground border-0">{a.metric}</Badge>
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />{new Date(a.timestamp).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{a.description}</p>
                            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                              <span>Current: <span className={cn("font-mono font-semibold", a.currentValue < a.expectedValue ? "text-rose-500" : "text-emerald-500")}>{a.currentValue}</span></span>
                              <span>Expected: <span className="font-mono">{a.expectedValue}</span></span>
                              <span>Deviation: <span className="font-mono font-semibold text-rose-500">{a.deviation > 0 ? "+" : ""}{a.deviation.toFixed(1)}</span></span>
                            </div>
                          </div>
                          <Link href={`/crawl-studio?site=${a.site}`}>
                            <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 shrink-0">
                              Investigate <ExternalLink className="h-3 w-3" />
                            </Button>
                          </Link>
                        </div>
                      )
                    })
                  ) : (
                    <div className="p-6">
                      <EmptyState variant="quality" title="No anomalies detected" description="All sources are performing within expected parameters." />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Trends Tab */}
            <TabsContent value="trends" id="trends" className="space-y-4">
              {/* Trend Chart */}
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5 text-primary" /> Quality & Health Trend
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-64 flex items-center justify-center">
                  <div className="text-center max-w-xs">
                    <BarChart3 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Historical trend data requires repeated crawls over time.</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Run campaigns on a recurring schedule to build trend visualizations.</p>
                  </div>
                </CardContent>
              </Card>

              {/* Trend Signals */}
              {filteredSignals.length > 0 && (
                <Card className="glass-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold flex items-center gap-2">
                      <TrendingUp className="h-3.5 w-3.5 text-blue-500" /> Detected Trends ({filteredSignals.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="divide-y divide-border/30">
                      {filteredSignals.map((s, i) => (
                        <div key={i} className="flex items-start gap-3 py-2.5 hover:bg-accent/30 transition-colors -mx-2 px-2 rounded-lg">
                          <div className={cn("p-1.5 rounded-md shrink-0", s.direction === "up" ? "bg-emerald-500/10" : s.direction === "down" ? "bg-rose-500/10" : "bg-blue-500/10")}>
                            {s.direction === "up" ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> :
                             s.direction === "down" ? <TrendingDown className="h-3.5 w-3.5 text-rose-500" /> :
                             <Activity className="h-3.5 w-3.5 text-blue-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium">{s.site}</span>
                              <Badge variant="outline" className={cn(
                                "text-[9px] border-0 px-1.5",
                                s.direction === "up" ? "text-emerald-500 bg-emerald-500/10" : s.direction === "down" ? "text-rose-500 bg-rose-500/10" : "text-blue-500 bg-blue-500/10"
                              )}>
                                {s.direction} · {s.magnitude.toFixed(0)}%
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{s.insight}</p>
                          </div>
                          <Link href={`/competitive-intelligence`}>
                            <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1 shrink-0">
                              Analyze <ArrowUpRight className="h-2.5 w-2.5" />
                            </Button>
                          </Link>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Recommendations Tab */}
            <TabsContent value="recommendations" className="space-y-4">
              <Card className="glass-card">
                <CardContent className="p-0 divide-y divide-border/30">
                  {filteredRecs.length > 0 ? (
                    filteredRecs.map(r => (
                      <div key={r.id} className="flex items-start gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                        <div className={cn(
                          "p-1.5 rounded-md shrink-0",
                          r.priority === "high" ? "bg-rose-500/10" : r.priority === "medium" ? "bg-amber-500/10" : "bg-blue-500/10"
                        )}>
                          {r.priority === "high" ? <AlertTriangle className="h-4 w-4 text-rose-500" /> :
                           <Lightbulb className={cn("h-4 w-4", r.priority === "medium" ? "text-amber-500" : "text-blue-500")} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{r.site}</span>
                            <Badge variant="outline" className={cn(
                              "text-[9px] border-0 px-1.5",
                              r.priority === "high" ? "bg-rose-500/10 text-rose-500" : r.priority === "medium" ? "bg-amber-500/10 text-amber-500" : "bg-blue-500/10 text-blue-500"
                            )}>{r.priority}</Badge>
                            <Badge variant="outline" className="text-[9px] bg-muted/30 text-muted-foreground border-0">{r.category}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-emerald-500 flex items-center gap-1">
                              <Target className="h-2.5 w-2.5" /> Impact: {r.impact}
                            </span>
                          </div>
                        </div>
                        <Link href={r.actionHref}>
                          <Button variant="outline" size="sm" className="h-8 text-xs gap-1 shrink-0">
                            {r.actionLabel} <ArrowUpRight className="h-3 w-3" />
                          </Button>
                        </Link>
                      </div>
                    ))
                  ) : (
                    <div className="p-6">
                      <EmptyState variant="search" title="No recommendations" description="All sources configured optimally. Run additional campaigns for more tailored suggestions." />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Action Panel */}
          <div className="flex flex-wrap gap-2 animate-fade-in-up">
            <Link href="/crawl-studio">
              <Button className="gap-1.5"><Zap className="h-4 w-4" /> Apply Recommendations</Button>
            </Link>
            <Link href="/data-quality">
              <Button variant="outline" className="gap-1.5"><SearchIcon className="h-4 w-4" /> Deep Quality Analysis</Button>
            </Link>
            <Link href="/operations">
              <Button variant="outline" className="gap-1.5"><Activity className="h-4 w-4" /> Live Operations</Button>
            </Link>
            <Link href="/competitive-intelligence">
              <Button variant="outline" className="gap-1.5"><Globe className="h-4 w-4" /> Benchmark Sources</Button>
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
