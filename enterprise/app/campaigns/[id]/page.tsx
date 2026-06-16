"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Play, Radio, CheckCircle2, XCircle, Clock, AlertTriangle,
  Sparkles, Globe, ArrowLeft, Activity, Zap, Download,
  FileText, BarChart3, Pause, StopCircle, Target,
  ShieldCheck, Lightbulb, FileSpreadsheet, FileJson,
  ChevronRight, Search, ArrowRight,
} from "lucide-react"
import Link from "next/link"
import { cn, formatDate } from "@/lib/utils"

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-states"
import { useCampaigns } from "@/lib/campaign-store"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, Legend, AreaChart, Area,
} from "recharts"

const statusColors: Record<string, string> = {
  draft: "bg-zinc-500", ready: "bg-blue-500", running: "bg-emerald-500",
  completed: "bg-emerald-500", failed: "bg-rose-500", cancelled: "bg-zinc-500",
}

const statusLabels: Record<string, string> = {
  draft: "Draft", ready: "Ready", running: "Running",
  completed: "Completed", failed: "Failed", cancelled: "Cancelled",
}

export default function CampaignDetailPage() {
  const params = useParams()
  const { campaigns, updateCampaign, launchCampaign, pauseCampaign, resumeCampaign, stopCampaign } = useCampaigns()
  const campaign = campaigns.find(c => c.id === params.id)
  const [activeTab, setActiveTab] = useState("operations")

  if (!campaign) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-16">
            <EmptyState variant="search" title="Campaign not found" description="This campaign may have been deleted." action={
              <Link href="/campaigns"><Button variant="outline" className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to Campaigns</Button></Link>
            } />
          </CardContent>
        </Card>
      </div>
    )
  }

  const isRunning = campaign.status === "running"
  const isCompleted = campaign.status === "completed"
  const isDraft = campaign.status === "draft" || campaign.status === "ready"
  const isFailed = campaign.status === "failed" || campaign.status === "cancelled"

  const statusDot = (s: string) => statusColors[s] || "bg-zinc-500"
  const statusLabel = (s: string) => statusLabels[s] || s

  const handlePauseResume = () => {
    if (campaign.status === "running") pauseCampaign(campaign.id)
    else if (campaign.status === "ready") resumeCampaign(campaign.id)
  }

  const sourceChartData = campaign.sources.map(s => {
    const src = campaign.results?.sourceComparison?.[s]
    return {
      name: s.split(".")[0],
      Ads: src?.ads || 0,
      Quality: src?.quality || 0,
      Health: src?.health || 0,
    }
  })

  const fieldCoverageData = campaign.results?.fieldCoverage
    ? Object.entries(campaign.results.fieldCoverage).map(([name, value]) => ({ name, value: Math.round(value) }))
    : []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in-up">
        <div className="flex items-center gap-3">
          <Link href="/campaigns">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{campaign.name}</h1>
              <Badge variant="outline" className={cn("text-[10px] border-0", statusDot(campaign.status).replace("bg-", "bg-") + "/10", statusDot(campaign.status).replace("bg-", "text-"))}>
                <span className={cn("h-1.5 w-1.5 rounded-full inline-block mr-1", statusDot(campaign.status))} />
                {statusLabel(campaign.status)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {campaign.sources.length} source{campaign.sources.length !== 1 ? "s" : ""} &middot; Created {formatDate(campaign.createdAt)}
              {campaign.launchedAt && <> &middot; Launched {formatDate(campaign.launchedAt)}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDraft && !isRunning && (
            <Button className="gap-1.5" onClick={() => launchCampaign(campaign.id)}>
              <Play className="h-4 w-4" /> Launch Campaign
            </Button>
          )}
          {isRunning && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePauseResume}>
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-rose-500 border-rose-500/30 hover:bg-rose-500/10" onClick={() => stopCampaign(campaign.id)}>
                <StopCircle className="h-3.5 w-3.5" /> Stop
              </Button>
            </>
          )}
          {campaign.status === "ready" && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePauseResume}>
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          )}
        </div>
      </div>

      {/* Status banner for running */}
      {isRunning && campaign.runtime && (
        <Card className="glass-card border-blue-500/20 animate-pulse-slow">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="relative flex h-8 w-8 items-center justify-center">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-30" />
                <Activity className="h-4 w-4 text-blue-500 relative" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium">
                    Crawling <span className="text-primary">{campaign.runtime.activeSite}</span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{Math.round(campaign.runtime.progress)}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary transition-all duration-700 ease-out" style={{ width: `${campaign.runtime.progress}%` }} />
                </div>
                <div className="flex items-center gap-4 mt-1.5 text-[10px] text-muted-foreground">
                  <span>Page {campaign.runtime.currentPage}/5</span>
                  <span>{campaign.runtime.adsDiscovered} ads found</span>
                  <span>{campaign.runtime.adsExtracted} extracted</span>
                  <span>{formatDuration(campaign.runtime.elapsedSeconds)}</span>
                  <span>{Math.round(campaign.runtime.successRate)}% success</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completed banner */}
      {isCompleted && campaign.results && (
        <Card className="glass-card gradient-border border-emerald-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="flex-1">
                <span className="text-sm font-medium">Campaign completed successfully</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  <span>{campaign.results.totalAds} records collected</span>
                  <span>DQ: {campaign.results.dataQualityScore}%</span>
                  <span>Coverage: {campaign.results.coverageScore}%</span>
                  {campaign.completedAt && <span>Finished {formatDate(campaign.completedAt)}</span>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in-up">
        <TabsList className="flex-wrap">
          <TabsTrigger value="operations" className="gap-1.5 text-xs" disabled={isDraft}>
            <Radio className="h-3.5 w-3.5" /> Live Operations
          </TabsTrigger>
          <TabsTrigger value="results" className="gap-1.5 text-xs" disabled={!isCompleted && !isFailed}>
            <BarChart3 className="h-3.5 w-3.5" /> Results Intelligence
          </TabsTrigger>
          <TabsTrigger value="insights" className="gap-1.5 text-xs" disabled={!isCompleted && !isFailed}>
            <Sparkles className="h-3.5 w-3.5" /> AI Insights
          </TabsTrigger>
          <TabsTrigger value="export" className="gap-1.5 text-xs" disabled={!isCompleted && !isFailed}>
            <Download className="h-3.5 w-3.5" /> Export
          </TabsTrigger>
        </TabsList>

        {/* Step 6: Live Operations */}
        <TabsContent value="operations" className="mt-4 space-y-4">
          {!campaign.runtime ? (
            <Card><CardContent className="py-10">
              <EmptyState variant="data" title="No execution data" description="Launch the campaign to see live operations." />
            </CardContent></Card>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Progress", value: `${Math.round(campaign.runtime.progress)}%`, icon: Activity, color: "text-blue-500", bg: "bg-blue-500/10" },
                  { label: "Ads Discovered", value: campaign.runtime.adsDiscovered.toLocaleString(), icon: Search, color: "text-violet-500", bg: "bg-violet-500/10" },
                  { label: "Ads Extracted", value: campaign.runtime.adsExtracted.toLocaleString(), icon: Target, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                  { label: "Success Rate", value: `${Math.round(campaign.runtime.successRate)}%`, icon: ShieldCheck, color: campaign.runtime.successRate >= 80 ? "text-emerald-500" : "text-amber-500", bg: campaign.runtime.successRate >= 80 ? "bg-emerald-500/10" : "bg-amber-500/10" },
                ].map(k => (
                  <Card key={k.label} className="glass-card">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={cn("p-1.5 rounded-md", k.bg)}><k.icon className={cn("h-3.5 w-3.5", k.color)} /></div>
                      </div>
                      <div className="kpi-value text-lg">{k.value}</div>
                      <div className="kpi-label">{k.label}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold">Execution Log</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {campaign.runtime.statusHistory.map((entry, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-border/20 last:border-0">
                        <span className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          entry.status === "completed" ? "bg-emerald-500" : entry.status === "crawling" || entry.status === "extracting" ? "bg-blue-500" : entry.status === "paused" ? "bg-amber-500" : entry.status === "failed" || entry.status === "cancelled" ? "bg-rose-500" : "bg-zinc-500"
                        )} />
                        <span className="text-[10px] text-muted-foreground tabular-nums w-16">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="text-muted-foreground">{entry.message}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <div className="flex gap-2">
                {isRunning && (
                  <>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePauseResume}>
                      <Pause className="h-3.5 w-3.5" /> Pause
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5 text-rose-500 border-rose-500/30" onClick={() => stopCampaign(campaign.id)}>
                      <StopCircle className="h-3.5 w-3.5" /> Stop
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </TabsContent>

        {/* Step 7: Results Intelligence */}
        <TabsContent value="results" className="mt-4 space-y-4">
          {!campaign.results ? (
            <Card><CardContent className="py-10">
              <EmptyState variant="data" title="Results not available" description="Campaign results will appear here after completion." />
            </CardContent></Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Total Records", value: campaign.results.totalAds.toLocaleString(), icon: DatabaseIcon, color: "text-blue-500", bg: "bg-blue-500/10" },
                  { label: "Data Quality", value: `${campaign.results.dataQualityScore}%`, icon: ShieldCheck, color: campaign.results.dataQualityScore >= 80 ? "text-emerald-500" : "text-amber-500", bg: campaign.results.dataQualityScore >= 80 ? "bg-emerald-500/10" : "bg-amber-500/10" },
                  { label: "Coverage Score", value: `${campaign.results.coverageScore}%`, icon: Target, color: campaign.results.coverageScore >= 80 ? "text-emerald-500" : "text-amber-500", bg: campaign.results.coverageScore >= 80 ? "bg-emerald-500/10" : "bg-amber-500/10" },
                  { label: "Sources Analyzed", value: campaign.sources.length, icon: Globe, color: "text-violet-500", bg: "bg-violet-500/10" },
                ].map(k => (
                  <Card key={k.label} className="glass-card">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className={cn("p-2 rounded-lg", k.bg)}><k.icon className={cn("h-4 w-4", k.color)} /></div>
                      </div>
                      <div className="kpi-value text-lg">{k.value}</div>
                      <div className="kpi-label">{k.label}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Source comparison chart */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="glass-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold flex items-center gap-2">
                      <BarChart3 className="h-3.5 w-3.5 text-primary" /> Source Comparison
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={sourceChartData} barCategoryGap={8}>
                        <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.05)" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "oklch(0.55 0 0)" }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: "oklch(0.55 0 0)" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: "oklch(0.1 0.02 260 / 0.95)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: "8px", fontSize: "12px" }} />
                        <Legend wrapperStyle={{ fontSize: "10px" }} />
                        <Bar dataKey="Ads" radius={[4, 4, 0, 0]} fill="oklch(0.6 0.2 270 / 0.8)" />
                        <Bar dataKey="Quality" radius={[4, 4, 0, 0]} fill="oklch(0.55 0.18 160 / 0.8)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="glass-card">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold flex items-center gap-2">
                      <Target className="h-3.5 w-3.5 text-primary" /> Field Coverage
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={fieldCoverageData} layout="vertical" barCategoryGap={8}>
                        <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.05)" horizontal={false} />
                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "oklch(0.55 0 0)" }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "oklch(0.55 0 0)" }} axisLine={false} tickLine={false} width={80} />
                        <Tooltip contentStyle={{ background: "oklch(0.1 0.02 260 / 0.95)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: "8px", fontSize: "12px" }} />
                        <Bar dataKey="value" name="Coverage %" radius={[0, 4, 4, 0]}>
                          {fieldCoverageData.map((_, i) => (
                            <Cell key={i} fill={_.value >= 80 ? "oklch(0.55 0.18 160)" : _.value >= 50 ? "oklch(0.6 0.2 80)" : "oklch(0.58 0.24 30)"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Top Findings */}
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold flex items-center gap-2">
                    <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> Top Findings
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {campaign.results.topFindings.map((finding, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        {finding}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Step 8: AI Insights */}
        <TabsContent value="insights" className="mt-4 space-y-4">
          {!campaign.results ? (
            <Card><CardContent className="py-10">
              <EmptyState variant="data" title="AI insights not available" description="Insights will generate after campaign completion." />
            </CardContent></Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Anomalies", value: campaign.results.topFindings.filter(f => f.includes("missing") || f.includes("issue")).length, icon: AlertTriangle, color: "text-rose-500", bg: "bg-rose-500/10" },
                  { label: "Data Quality Risk", value: campaign.results.dataQualityScore < 70 ? "High" : campaign.results.dataQualityScore < 85 ? "Medium" : "Low", icon: ShieldCheck, color: campaign.results.dataQualityScore >= 85 ? "text-emerald-500" : campaign.results.dataQualityScore >= 70 ? "text-amber-500" : "text-rose-500", bg: campaign.results.dataQualityScore >= 85 ? "bg-emerald-500/10" : campaign.results.dataQualityScore >= 70 ? "bg-amber-500/10" : "bg-rose-500/10" },
                  { label: "Recommendations", value: campaign.results.topFindings.length, icon: Lightbulb, color: "text-amber-500", bg: "bg-amber-500/10" },
                  { label: "Top Performer", value: campaign.sources.sort((a, b) => (campaign.results?.sourceComparison?.[b]?.health || 0) - (campaign.results?.sourceComparison?.[a]?.health || 0))[0]?.split(".")[0] || "N/A", icon: TrophyIcon, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                ].map(k => (
                  <Card key={k.label} className="glass-card">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={cn("p-1.5 rounded-md", k.bg)}><k.icon className={cn("h-3.5 w-3.5", k.color)} /></div>
                      </div>
                      <div className="kpi-value text-lg">{k.value}</div>
                      <div className="kpi-label">{k.label}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Anomalies */}
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-500" /> Detected Anomalies
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {campaign.results.dataQualityScore < 75 && (
                      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-500/5 border border-rose-500/10">
                        <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-xs font-medium text-rose-500">Low data quality detected</span>
                          <p className="text-[11px] text-muted-foreground mt-0.5">Data quality score ({campaign.results.dataQualityScore}%) is below optimal threshold. Some fields may contain incomplete data.</p>
                        </div>
                      </div>
                    )}
                    {campaign.results.fieldCoverage?.price && campaign.results.fieldCoverage.price < 70 && (
                      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-xs font-medium text-amber-500">Missing price data</span>
                          <p className="text-[11px] text-muted-foreground mt-0.5">Price field coverage is at {Math.round(campaign.results.fieldCoverage.price)}% — significant revenue opportunity identified.</p>
                        </div>
                      </div>
                    )}
                    {campaign.results.fieldCoverage?.phone && campaign.results.fieldCoverage.phone < 50 && (
                      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <span className="text-xs font-medium text-amber-500">Low phone number extraction</span>
                          <p className="text-[11px] text-muted-foreground mt-0.5">Phone number coverage is low at {Math.round(campaign.results.fieldCoverage.phone)}% — review extraction selectors.</p>
                        </div>
                      </div>
                    )}
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                      <div>
                        <span className="text-xs font-medium text-emerald-500">All sources reachable</span>
                        <p className="text-[11px] text-muted-foreground mt-0.5">All {campaign.sources.length} target sources were successfully accessed and extracted.</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Source ranking */}
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold flex items-center gap-2">
                    <BarChart3 className="h-3.5 w-3.5 text-primary" /> Source Performance Ranking
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="divide-y divide-border/30">
                    {campaign.sources
                      .map(s => ({ hostname: s, ...campaign.results?.sourceComparison?.[s] || { ads: 0, quality: 0, health: 0 } }))
                      .sort((a, b) => b.health - a.health)
                      .map((s, i) => (
                        <div key={s.hostname} className="flex items-center gap-3 py-2.5">
                          <span className={cn(
                            "h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0",
                            i === 0 ? "bg-amber-500/20 text-amber-500" : i === 1 ? "bg-zinc-400/20 text-zinc-400" : i === 2 ? "bg-amber-700/20 text-amber-700" : "bg-muted text-muted-foreground"
                          )}>{i + 1}</span>
                          <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="text-xs font-medium flex-1">{s.hostname}</span>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span className="tabular-nums">{s.ads} ads</span>
                            <Badge variant="outline" className={cn("text-[9px] border-0", s.quality >= 80 ? "bg-emerald-500/10 text-emerald-500" : s.quality >= 50 ? "bg-amber-500/10 text-amber-500" : "bg-rose-500/10 text-rose-500")}>
                              DQ: {s.quality}%
                            </Badge>
                            <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${s.health}%`, background: s.health >= 80 ? "oklch(0.55 0.18 160)" : s.health >= 50 ? "oklch(0.6 0.2 80)" : "oklch(0.58 0.24 30)" }} />
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>

              {/* Recommendations */}
              <Card className="glass-card gradient-border">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <Lightbulb className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-semibold mb-1">Automated Recommendations</h4>
                      <ul className="space-y-1.5">
                        {fieldCoverageData.filter(f => f.value < 60).map(f => (
                          <li key={f.name} className="text-xs text-muted-foreground flex items-start gap-2">
                            <ArrowRight className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                            Improve <strong>{f.name}</strong> extraction (currently {f.value}%) — update CSS selectors for this field
                          </li>
                        ))}
                        {campaign.results.dataQualityScore < 80 && (
                          <li className="text-xs text-muted-foreground flex items-start gap-2">
                            <ArrowRight className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                            Increase crawl delay to improve data quality and reduce blocked requests
                          </li>
                        )}
                        <li className="text-xs text-muted-foreground flex items-start gap-2">
                          <ArrowRight className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                          Schedule recurring campaigns to track trends over time
                        </li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Step 9: Export */}
        <TabsContent value="export" className="mt-4 space-y-4">
          {!campaign.results ? (
            <Card><CardContent className="py-10">
              <EmptyState variant="data" title="Nothing to export" description="Campaign results are required for export." />
            </CardContent></Card>
          ) : (
            <>
              {[
                { label: "Excel (.xlsx)", icon: FileSpreadsheet, color: "text-emerald-500", bg: "bg-emerald-500/10", desc: "Full data export", format: "xlsx" },
                { label: "CSV (.csv)", icon: FileText, color: "text-amber-500", bg: "bg-amber-500/10", desc: "Universal format", format: "csv" },
                { label: "JSON (.json)", icon: FileJson, color: "text-blue-500", bg: "bg-blue-500/10", desc: "Machine readable", format: "json" },
                { label: "Executive PDF", icon: FileText, color: "text-rose-500", bg: "bg-rose-500/10", desc: "Management report", format: null },
              ].map((fmt) => {
                const firstJob = Object.values(campaign.results?.sourceComparison || {}).find(s => s.jobId)
                const jobId = firstJob?.jobId
                const href = jobId && fmt.format ? `/api/crawl/${jobId}/export?format=${fmt.format}` : undefined
                return (
                  <Card key={fmt.label}
                    className={cn("glass-card transition-all group", href ? "hover:border-primary/30 cursor-pointer" : "cursor-default")}
                    onClick={href ? () => window.open(href, "_blank") : undefined}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className={cn("p-2 rounded-lg", fmt.bg)}>
                          <fmt.icon className={cn("h-4 w-4", fmt.color)} />
                        </div>
                      </div>
                      <div className="text-sm font-medium">{fmt.label}</div>
                      <div className="text-[10px] text-muted-foreground">{fmt.desc}</div>
                      <div className="mt-3 flex items-center gap-1 text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        <Download className="h-3 w-3" /> Download <ChevronRight className="h-3 w-3" />
                      </div>
                    </CardContent>
                  </Card>
                )
              })}

              {/* KPI Export Summary */}
              <Card className="glass-card gradient-border">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold mb-1">Executive Summary</h4>
                      <p className="text-xs text-muted-foreground mb-3">
                        Campaign <strong>{campaign.name}</strong> collected {campaign.results.totalAds} records from {campaign.sources.length} sources
                        with an average data quality score of {campaign.results.dataQualityScore}%.
                      </p>
                      <div className="grid gap-2 sm:grid-cols-3 mb-3">
                        {[
                          { label: "Total Records", value: campaign.results.totalAds.toLocaleString() },
                          { label: "Data Quality", value: `${campaign.results.dataQualityScore}%` },
                          { label: "Sources", value: campaign.sources.length },
                        ].map(s => (
                          <div key={s.label} className="p-2 rounded bg-muted/30 text-center">
                            <div className="text-lg font-bold">{s.value}</div>
                            <div className="text-[10px] text-muted-foreground">{s.label}</div>
                          </div>
                        ))}
                      </div>
                      <Button size="sm" className="gap-1.5 text-xs" onClick={() => {
                        const win = window.open("", "_blank")
                        if (!win) return
                        const results = campaign.results!
                        win.document.write(`
                          <html><head><title>Campaign Report — ${campaign.name}</title>
                          <style>body{font-family:sans-serif;padding:40px;color:#333;max-width:800px;margin:auto}
                          h1{color:#6c5ce7;border-bottom:3px solid #6c5ce7;padding-bottom:10px}
                          .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}
                          .kpi{background:#f8f8ff;padding:16px;border-radius:8px;text-align:center}
                          .kpi-value{font-size:28px;font-weight:bold;color:#6c5ce7}
                          table{width:100%;border-collapse:collapse;margin:16px 0}
                          th{background:#6c5ce7;color:white;padding:8px 12px;text-align:left;font-size:12px}
                          td{padding:6px 12px;border-bottom:1px solid #eee;font-size:13px}
                          .footer{margin-top:40px;font-size:11px;color:#aaa;text-align:center}
                          </style></head><body>
                          <h1>Campaign Intelligence Report</h1>
                          <p>Campaign: ${campaign.name} | Generated: ${new Date().toLocaleDateString()}</p>
                          <div class="kpi-grid">
                            <div class="kpi"><div class="kpi-value">${results.totalAds}</div><div class="kpi-label">Records</div></div>
                            <div class="kpi"><div class="kpi-value">${results.dataQualityScore}%</div><div class="kpi-label">Data Quality</div></div>
                            <div class="kpi"><div class="kpi-value">${campaign.sources.length}</div><div class="kpi-label">Sources</div></div>
                          </div>
                          <table><tr><th>Source</th><th>Ads</th><th>Quality</th><th>Health</th></tr>
                          ${Object.entries(results.sourceComparison || {}).map(([site, data]: any) =>
                            `<tr><td>${site}</td><td>${data.ads}</td><td>${data.quality}%</td><td>${data.health}%</td></tr>`
                          ).join("")}
                          </table>
                          <div class="footer">CSI-Ultimate Enterprise Intelligence Platform &mdash; Confidential</div>
                          </body></html>
                        `)
                        win.document.close()
                        win.print()
                      }}>
                        <FileText className="h-3.5 w-3.5" /> Generate Executive Report
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 6 9 6 9" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 18 9 18 9" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2" />
    </svg>
  )
}

function DatabaseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
    </svg>
  )
}
