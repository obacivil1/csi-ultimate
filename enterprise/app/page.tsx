"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Globe, Database, ShieldCheck, DollarSign,
  AlertTriangle, TrendingUp, TrendingDown, ArrowUpRight,
  Clock, Zap, Target, Activity, CheckCircle2, FileText,
  Sparkles, ChevronRight,
} from "lucide-react"
import Link from "next/link"
import { cn, safeFetch, formatDate } from "@/lib/utils"
import { EngineOffline } from "@/components/engine-offline"
import { FirstRun } from "@/components/first-run"
import { Skeleton } from "@/components/ui/skeleton"

const FIELD_LABELS: Record<string, string> = {
  title: "Title", description: "Description", price: "Price",
  location: "Location", phones: "Phone", emails: "Email",
}

export default function ExecutiveCommandCenter() {
  const [healthScores, setHealthScores] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)

  useEffect(() => {
    Promise.all([
      safeFetch("/api/health"),
      safeFetch("/api/reports"),
    ]).then(([scores, reps]) => {
      setHealthScores(scores)
      setReports(reps)
      setEngineOnline(scores.length > 0 || reps.length > 0)
      setLoading(false)
    })
  }, [])

  const avgHealth = healthScores.length
    ? Math.round(healthScores.reduce((s: number, h: any) => s + h.healthScore, 0) / healthScores.length) : 0
  const avgDQ = reports.length
    ? Math.round(reports.reduce((s: number, r: any) => s + (r.metrics?.dataQualityScore || 0), 0) / reports.length) : 0
  const totalAds = reports.reduce((s: number, r: any) => s + (r.totalAds || 0), 0)
  const totalIssues = reports.reduce((s: number, r: any) => s + (r.issues?.length || 0), 0)
  const totalCrawls = reports.length
  const healthyCount = healthScores.filter(s => s.healthScore >= 80).length
  const warningCount = healthScores.filter(s => s.healthScore >= 50 && s.healthScore < 80).length
  const criticalCount = healthScores.filter(s => s.healthScore < 50).length

  const fieldsTotal = reports.reduce((s: number, r: any) => {
    if (!r.fields) return s
    return s + Object.values(r.fields).reduce((fs: number, f: any) => fs + f.present + f.empty, 0)
  }, 0)
  const fieldsPresent = reports.reduce((s: number, r: any) => {
    if (!r.fields) return s
    return s + Object.values(r.fields).reduce((fs: number, f: any) => fs + f.present, 0)
  }, 0)
  const dataCompleteness = fieldsTotal > 0 ? Math.round((fieldsPresent / fieldsTotal) * 100) : 0

  const recordsWithMissingPrice = reports.reduce((s: number, r: any) => {
    const priceField = r.fields?.price
    return s + (priceField ? priceField.empty : 0)
  }, 0)
  const missingPhoneCount = reports.reduce((s: number, r: any) => {
    const pf = r.fields?.phones
    return s + (pf ? pf.empty : 0)
  }, 0)
  const estimatedRevenue = recordsWithMissingPrice * 15

  const criticalSources = healthScores.filter(h => h.healthScore < 50)
  const warningSources = healthScores.filter(h => h.healthScore >= 50 && h.healthScore < 80)

  const latestReport = reports.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0]

  const [timeSinceUpdate, setTimeSinceUpdate] = useState(0)
  useEffect(() => {
    const tick = () => setTimeSinceUpdate(Math.floor((Date.now() - (latestReport ? new Date(latestReport.generatedAt).getTime() : Date.now())) / 60000))
    tick(); const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [latestReport])

  const overallTrustScore = reports.length > 0
    ? Math.round(reports.reduce((s, r) => {
        const dq = r.metrics?.dataQualityScore || 0
        const er = r.metrics?.extractionRate || 0
        const sh = r.metrics?.siteHealthScore || 0
        const fields = r.fields ? Object.values(r.fields) : []
        const avgFc = fields.length > 0 ? fields.reduce((fs: number, f: any) => fs + (f.pct || 0), 0) / fields.length : 0
        return s + Math.round(dq * 0.3 + er * 0.2 + sh * 0.2 + avgFc * 0.3)
      }, 0) / reports.length)
    : 0

  const execSummary = [
    { label: "Sources Tracked", value: healthScores.length, icon: Globe, color: "text-blue-600", bg: "bg-blue-100", insight: `${healthyCount} healthy, ${criticalCount} critical` },
    { label: "Records Collected", value: totalAds.toLocaleString(), icon: Database, color: "text-violet-600", bg: "bg-violet-100", insight: `${overallTrustScore}% avg trust · ${totalCrawls} campaigns` },
    { label: "Data Trust", value: `${overallTrustScore}%`, icon: ShieldCheck, color: overallTrustScore >= 80 ? "text-emerald-600" : "text-amber-600", bg: overallTrustScore >= 80 ? "bg-emerald-100" : "bg-amber-100", insight: `${100 - dataCompleteness}% incomplete · ${totalIssues} issues` },
    { label: "Revenue Opportunity", value: `$${estimatedRevenue.toLocaleString()}`, icon: DollarSign, color: "text-amber-600", bg: "bg-amber-100", insight: `${recordsWithMissingPrice.toLocaleString()} records missing price · ${missingPhoneCount.toLocaleString()} missing phone` },
  ]

  const sourceReliability = reports.map(r => {
    const dq = r.metrics?.dataQualityScore || 0
    const er = r.metrics?.extractionRate || 0
    const sh = r.metrics?.siteHealthScore || 0
    const fields = r.fields ? Object.values(r.fields) : []
    const avgFc = fields.length > 0 ? fields.reduce((fs: number, f: any) => fs + (f.pct || 0), 0) / fields.length : 0
    const issuePenalty = (r.issues?.length || 0) * 5
    const score = Math.max(0, Math.min(100, Math.round(dq * 0.3 + er * 0.2 + sh * 0.2 + avgFc * 0.3 - issuePenalty)))
    return { site: r.site, score, records: r.totalAds || 0, dq, er, issues: r.issues?.length || 0 }
  }).sort((a, b) => b.score - a.score)

  // --- Discovery Feed: real findings from report data ---
  const discoveryFeed: { icon: any; color: string; bg: string; headline: string; detail: string }[] = []

  if (reports.length > 0) {
    const byRecords = [...reports].sort((a, b) => (b.totalAds || 0) - (a.totalAds || 0))
    const topSource = byRecords[0]
    const topPct = totalAds > 0 ? Math.round((topSource.totalAds / totalAds) * 100) : 0
    if (topPct >= 10) {
      discoveryFeed.push({
        icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-100",
        headline: `${topSource.site} generated ${topPct}% of all records`,
        detail: `${topSource.totalAds.toLocaleString()} records from this source alone`,
      })
    }

    const byDq = [...reports].sort((a, b) => (b.metrics?.dataQualityScore || 0) - (a.metrics?.dataQualityScore || 0))
    const bestDq = byDq[0]
    if (bestDq && bestDq.metrics?.dataQualityScore >= 80) {
      discoveryFeed.push({
        icon: ShieldCheck, color: "text-emerald-600", bg: "bg-emerald-100",
        headline: `${bestDq.site} produced the highest quality data`,
        detail: `${bestDq.metrics.dataQualityScore}% data quality score`,
      })
    }

    const byRate = [...reports].sort((a, b) => (b.metrics?.extractionRate || 0) - (a.metrics?.extractionRate || 0))
    const bestRate = byRate[0]
    if (bestRate && bestRate.metrics?.extractionRate > 0) {
      discoveryFeed.push({
        icon: Zap, color: "text-violet-600", bg: "bg-violet-100",
        headline: `${bestRate.site} has highest extraction success`,
        detail: `${bestRate.metrics.extractionRate}% extraction rate`,
      })
    }

    const byGrowth = [...reports].sort((a, b) => (a.totalAds || 0) - (b.totalAds || 0))
    if (byGrowth.length >= 2 && byGrowth[0].totalAds > 0) {
      const smallest = byGrowth[0]
      discoveryFeed.push({
        icon: Activity, color: "text-blue-600", bg: "bg-blue-100",
        headline: `${smallest.site} has lowest record count`,
        detail: `${smallest.totalAds.toLocaleString()} records — potential crawl configuration gap`,
      })
    }

    const totalIssuesAcross = reports.reduce((s, r) => s + (r.issues?.length || 0), 0)
    if (totalIssuesAcross > 0) {
      const siteWithMostIssues = [...reports].sort((a, b) => (b.issues?.length || 0) - (a.issues?.length || 0))[0]
      discoveryFeed.push({
        icon: AlertTriangle, color: "text-rose-600", bg: "bg-rose-100",
        headline: `${totalIssuesAcross} data quality issue${totalIssuesAcross > 1 ? "s" : ""} detected`,
        detail: siteWithMostIssues ? `${siteWithMostIssues.site} has ${siteWithMostIssues.issues?.length || 0} issue${siteWithMostIssues.issues?.length !== 1 ? "s" : ""}` : "Across all sources",
      })
    }

    const fieldsCombined: Record<string, { present: number; empty: number }> = {}
    reports.forEach(r => {
      if (r.fields) {
        Object.entries(r.fields).forEach(([key, fv]: [string, any]) => {
          if (!fieldsCombined[key]) fieldsCombined[key] = { present: 0, empty: 0 }
          fieldsCombined[key].present += fv.present || 0
          fieldsCombined[key].empty += fv.empty || 0
        })
      }
    })
    const fieldCoverages = Object.entries(fieldsCombined).map(([k, v]) => {
      const total = v.present + v.empty
      return { field: k, pct: total > 0 ? Math.round((v.present / total) * 100) : 0, present: v.present, empty: v.empty }
    }).sort((a, b) => a.pct - b.pct)
    const weakest = fieldCoverages[0]
    if (weakest && weakest.pct < 80 && weakest.empty > 0) {
      discoveryFeed.push({
        icon: DollarSign, color: "text-amber-600", bg: "bg-amber-100",
        headline: `${weakest.field} coverage is ${weakest.pct}%`,
        detail: `${weakest.empty.toLocaleString()} records missing ${weakest.field} data — potential revenue impact`,
      })
    }
    const strongest = fieldCoverages[fieldCoverages.length - 1]
    if (strongest && strongest !== weakest && strongest.pct >= 90) {
      discoveryFeed.push({
        icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100",
        headline: `${strongest.field} extraction at ${strongest.pct}%`,
        detail: `${strongest.present.toLocaleString()} of ${(strongest.present + strongest.empty).toLocaleString()} records have ${strongest.field} populated`,
      })
    }
  }

  const findings: { icon: any; color: string; bg: string; title: string; description: string; action?: { label: string; href: string } }[] = []
  if (criticalCount > 0) {
    findings.push({
      icon: AlertTriangle, color: "text-rose-600", bg: "bg-rose-100",
      title: `${criticalCount} source${criticalCount > 1 ? "s" : ""} require immediate attention`,
      description: criticalSources.map(s => `${s.site} (health: ${s.healthScore}%)`).join(", "),
      action: { label: "View Operations", href: "/operations" },
    })
  }
  if (totalIssues > 0) {
    findings.push({
      icon: TrendingDown, color: "text-amber-600", bg: "bg-amber-100",
      title: `${totalIssues} data quality issue${totalIssues > 1 ? "s" : ""} detected`,
      description: `Review issues across ${reports.length} report${reports.length > 1 ? "s" : ""} to improve extraction quality.`,
      action: { label: "View Issues", href: "/ai-insights" },
    })
  }
  if (recordsWithMissingPrice > 0) {
    findings.push({
      icon: DollarSign, color: "text-amber-600", bg: "bg-amber-100",
      title: `$${estimatedRevenue.toLocaleString()} in addressable revenue at risk`,
      description: `${recordsWithMissingPrice.toLocaleString()} records lack pricing data. Recovering this data could unlock significant business value.`,
      action: { label: "View Data Quality", href: "/data-quality" },
    })
  }
  if (missingPhoneCount > 0) {
    findings.push({
      icon: Target, color: "text-blue-600", bg: "bg-blue-100",
      title: `${missingPhoneCount.toLocaleString()} records missing contact information`,
      description: `Phone numbers missing in ${missingPhoneCount.toLocaleString()} records, reducing lead conversion potential.`,
      action: { label: "Review Coverage", href: "/results" },
    })
  }
  if (findings.length === 0 && totalAds > 0) {
    findings.push({
      icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100",
      title: "All systems operating within parameters",
      description: `${healthyCount} source${healthyCount > 1 ? "s" : ""} healthy, ${totalAds.toLocaleString()} records collected, ${dataCompleteness}% data completeness.`,
    })
  }

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Executive Command Center</h1>
            <Badge variant="outline" className="text-[10px] font-normal h-5 gap-1">
              <Clock className="h-3 w-3" />
              {timeSinceUpdate === 0 ? "Updated just now" : `Updated ${timeSinceUpdate}m ago`}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {criticalCount > 0
              ? `${criticalCount} source${criticalCount > 1 ? "s" : ""} need attention. ${healthyCount} operating normally.`
              : warningCount > 0
                ? `${warningCount} source${warningCount > 1 ? "s" : ""} showing signs of degradation.`
                : healthyCount > 0
                  ? `All ${healthyCount} source${healthyCount > 1 ? "s" : ""} operating within expected parameters.`
                  : "No intelligence data collected yet."
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/crawl-studio">
            <Button className="gap-1.5"><Zap className="h-4 w-4" /> New Campaign</Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}><CardContent className="p-5"><Skeleton className="h-7 w-20 mb-3" /><Skeleton className="h-3 w-32" /></CardContent></Card>
            ))}
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : healthScores.length === 0 && reports.length === 0 ? (
        <FirstRun />
      ) : (
        <>
          {/* Executive Summary KPI Bar */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in-up">
            {execSummary.map((k, i) => (
              <Card key={k.label} className={cn("animate-fade-in-up", `stagger-${i + 1}`)}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div className={cn("p-2 rounded-lg", k.bg)}>
                      <k.icon className={cn("h-4 w-4", k.color)} />
                    </div>
                  </div>
                  <div className="kpi-value">{k.value}</div>
                  <div className="kpi-label mt-0.5">{k.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">{k.insight}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Discovery Feed — What changed */}
          {discoveryFeed.length > 0 && (
            <div className="animate-fade-in-up stagger-5">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-3">
                <Sparkles className="h-4 w-4 text-primary" />
                Intelligence Feed
                <span className="text-[10px] font-normal text-muted-foreground">What changed across your sources</span>
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {discoveryFeed.filter((_, i) => i < 4).map((f, i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={cn("p-1.5 rounded-lg shrink-0", f.bg)}>
                          <f.icon className={cn("h-4 w-4", f.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground leading-snug">{f.headline}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{f.detail}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Source Reliability Ranking */}
          {sourceReliability.length > 0 && (
            <div className="animate-fade-in-up stagger-6">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5 mb-3">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Source Reliability
                <span className="text-[10px] font-normal text-muted-foreground">Ranked by data quality, extraction rate, and field confidence</span>
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {sourceReliability.map((s, i) => (
                  <Card key={s.site} className={cn(i === 0 && "ring-1 ring-emerald-500/20")}>
                    <CardContent className="p-3.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-foreground truncate">{s.site}</span>
                        <Badge variant={s.score >= 80 ? "success" : s.score >= 50 ? "warning" : "destructive"} className="text-[10px] h-5">{s.score}</Badge>
                      </div>
                      <div className="flex gap-2 text-[10px] text-muted-foreground">
                        <span>{s.records.toLocaleString()} records</span>
                        <span>&middot;</span>
                        <span>{s.dq}% DQ</span>
                        <span>&middot;</span>
                        <span>{s.er}% ER</span>
                        {s.issues > 0 && <><span>&middot;</span><span className="text-rose-500">{s.issues} issues</span></>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Key Findings + Risk Alerts — above the fold */}
          <div className="grid gap-5 lg:grid-cols-3 animate-fade-in-up stagger-7">
            {/* Key Findings — what happened, what's broken, what should be fixed */}
            <div className="lg:col-span-2 space-y-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-primary" />
                Key Findings
                <span className="text-[10px] font-normal text-muted-foreground">What needs your attention today</span>
              </h2>
              {findings.length > 0 ? (
                <div className="space-y-2">
                  {findings.map((f, i) => (
                    <Card key={i}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={cn("p-1.5 rounded-lg shrink-0", f.bg)}>
                            <f.icon className={cn("h-4 w-4", f.color)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground">{f.title}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{f.description}</div>
                            {f.action && (
                              <Link href={f.action.href}>
                                <Button variant="ghost" size="sm" className="h-7 mt-1.5 text-xs gap-1 p-0 hover:bg-transparent hover:text-primary">
                                  {f.action.label} <ChevronRight className="h-3 w-3" />
                                </Button>
                              </Link>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="p-8 text-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm text-foreground font-medium">No issues detected</p>
                    <p className="text-xs text-muted-foreground mt-1">All sources and campaigns operating within expected parameters.</p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Risk Alerts — what is broken */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-rose-500" />
                Risk Alerts
                {criticalCount > 0 && <Badge variant="destructive" className="text-[10px] h-5">{criticalCount} critical</Badge>}
              </h2>
              <div className="space-y-2">
                {criticalSources.length > 0 ? criticalSources.slice(0, 4).map(s => {
                  const report = reports.find(r => r.site === s.site)
                  return (
                    <Card key={s.site}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0 mt-1.5" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">{s.site}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="destructive" className="text-[10px]">{s.healthScore}% health</Badge>
                              {report?.totalAds > 0 && <span className="text-[10px] text-muted-foreground">{report.totalAds} records</span>}
                            </div>
                            <div className="text-[11px] text-rose-600 mt-1">
                              {s.issues || report?.issues?.length || 0} issue{(s.issues || report?.issues?.length || 0) !== 1 ? "s" : ""} detected
                            </div>
                            <Link href={`/jobs`}>
                              <Button variant="ghost" size="sm" className="h-6 mt-1 text-[11px] gap-1 p-0 hover:bg-transparent hover:text-primary">
                                Investigate <ArrowUpRight className="h-3 w-3" />
                              </Button>
                            </Link>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                }) : warningSources.length > 0 ? warningSources.slice(0, 3).map(s => (
                  <Card key={s.site}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{s.site}</div>
                          <Badge variant="warning" className="text-[10px] mt-1">{s.healthScore}% health</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )) : (
                  <Card>
                    <CardContent className="p-5 text-center">
                      <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto mb-1" />
                      <p className="text-xs text-muted-foreground">All sources healthy</p>
                    </CardContent>
                  </Card>
                )}
                {healthScores.length > 0 && (
                  <Link href="/operations">
                    <Button variant="outline" size="sm" className="w-full text-xs gap-1">
                      View All Sources <ChevronRight className="h-3 w-3" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* Business Value + Recent Activity — below fold */}
          <div className="grid gap-5 lg:grid-cols-3 animate-fade-in-up stagger-6">
            {/* Business Value */}
            <div className="lg:col-span-2">
              <Card className="card-accent">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                      <Sparkles className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-foreground mb-1">Business Value Summary</h3>
                      <div className="grid gap-3 sm:grid-cols-3 mt-3">
                        <div className="p-3 rounded-lg bg-muted">
                          <div className="text-[11px] text-muted-foreground">Total Records</div>
                          <div className="text-lg font-bold text-foreground">{totalAds.toLocaleString()}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">Across {totalCrawls} crawl{totalCrawls !== 1 ? "s" : ""}</div>
                        </div>
                        <div className="p-3 rounded-lg bg-muted">
                          <div className="text-[11px] text-muted-foreground">Avg Data Quality</div>
                          <div className="text-lg font-bold text-foreground">{avgDQ}%</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">Across all sources</div>
                        </div>
                        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-500/20">
                          <div className="text-[11px] text-amber-600 dark:text-amber-400">Revenue Opportunity</div>
                          <div className="text-lg font-bold text-amber-600 dark:text-amber-400">${estimatedRevenue.toLocaleString()}</div>
                          <div className="text-[11px] text-amber-600/80 dark:text-amber-400/80 mt-0.5">{recordsWithMissingPrice.toLocaleString()} records missing price</div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Link href="/reports">
                          <Button size="sm" variant="outline" className="text-xs gap-1">
                            <FileText className="h-3.5 w-3.5" /> View Reports
                          </Button>
                        </Link>
                        <Link href="/exports">
                          <Button size="sm" variant="outline" className="text-xs gap-1">
                            <DollarSign className="h-3.5 w-3.5" /> Export Data
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Intelligence Summary */}
            <div>
              <Card>
                <CardContent className="p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Intelligence Summary
                  </h3>
                  <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                    {reports.length > 0 && (() => {
                      const highest = [...reports].sort((a, b) => (b.totalAds || 0) - (a.totalAds || 0))[0]
                      const bestDq = [...reports].sort((a, b) => (b.metrics?.dataQualityScore || 0) - (a.metrics?.dataQualityScore || 0))[0]
                      const weakField = (() => {
                        const combined: Record<string, { p: number; e: number }> = {}
                        reports.forEach(r => {
                          if (r.fields) Object.entries(r.fields).forEach(([k, fv]: [string, any]) => {
                            if (!combined[k]) combined[k] = { p: 0, e: 0 }
                            combined[k].p += fv.present || 0; combined[k].e += fv.empty || 0
                          })
                        })
                        return Object.entries(combined).map(([k, v]) => ({ field: k, pct: v.p + v.e > 0 ? Math.round((v.p / (v.p + v.e)) * 100) : 0 })).sort((a, b) => a.pct - b.pct)[0]
                      })()
                      const totalIssuesAcross = reports.reduce((s, r) => s + (r.issues?.length || 0), 0)
                      const weakFieldName = weakField && weakField.pct < 80 ? FIELD_LABELS[weakField.field] || weakField.field : null
                      const bestSource = sourceReliability[0]
                      return (
                        <>
                          <p><span className="text-foreground font-medium">{totalAds.toLocaleString()}</span> records from <span className="text-foreground font-medium">{healthScores.length}</span> sources. Overall trust score: <span className={cn("font-medium", overallTrustScore >= 80 ? "text-emerald-600" : overallTrustScore >= 60 ? "text-amber-600" : "text-rose-600")}>{overallTrustScore}%</span>.</p>
                          {bestSource && <p>Most reliable source: <span className="text-foreground font-medium">{bestSource.site}</span> ({bestSource.score}/100).</p>}
                          {highest && highest.totalAds > 0 && <p><span className="text-foreground font-medium">{highest.site}</span> generated <span className="text-foreground font-medium">{Math.round((highest.totalAds / totalAds) * 100)}%</span> of all records ({highest.totalAds.toLocaleString()} records).</p>}
                          {bestDq && bestDq.metrics?.dataQualityScore >= 80 && <p><span className="text-foreground font-medium">{bestDq.site}</span> produced the highest quality data at <span className="text-emerald-600 font-medium">{bestDq.metrics.dataQualityScore}%</span>.</p>}
                          {weakFieldName && <p><span className="text-amber-600 font-medium">{weakFieldName}</span> has the lowest coverage at {weakField.pct}% — reviewing extraction configuration could improve completeness.</p>}
                          {totalIssuesAcross > 0 && <p className="text-rose-600"><span className="font-medium">{totalIssuesAcross}</span> issue{totalIssuesAcross > 1 ? "s" : ""} detected across all campaigns — review the Issues tab for details.</p>}
                          {estimatedRevenue > 0 && <p className="text-amber-600">Recovering missing price data could unlock <span className="font-semibold">${estimatedRevenue.toLocaleString()}</span> in addressable revenue.</p>}
                          {/* Sellable Product Test */}
                          <div className={cn("p-3 rounded-lg border text-xs mt-2", overallTrustScore >= 80 ? "bg-emerald-500/5 border-emerald-200/30" : overallTrustScore >= 60 ? "bg-amber-500/5 border-amber-200/30" : "bg-rose-500/5 border-rose-200/30")}>
                            <div className="flex items-center gap-1.5 font-medium mb-1">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              <span className={overallTrustScore >= 80 ? "text-emerald-700" : overallTrustScore >= 60 ? "text-amber-700" : "text-rose-700"}>
                                Sellable Product Test: {overallTrustScore >= 80 ? "READY FOR CUSTOMERS" : overallTrustScore >= 60 ? "CONDITIONAL ACCEPTANCE" : "NOT READY"}
                              </span>
                            </div>
                            <p className="text-muted-foreground">
                              {overallTrustScore >= 80
                                ? `Dataset scores ${overallTrustScore}/100 — suitable for paying customers. ${bestSource?.site || "Primary sources"} meet quality thresholds for commercial delivery.`
                                : overallTrustScore >= 60
                                  ? `Dataset scores ${overallTrustScore}/100 — conditional. ${weakFieldName ? `Weak ${weakFieldName} coverage (${weakField?.pct}%)` : `${totalIssuesAcross} issues detected`} should be resolved before customer delivery.`
                                  : `Dataset scores ${overallTrustScore}/100 — not ready for customers. ${criticalCount} critical sources and ${totalIssuesAcross} issues require remediation first.`
                              }
                            </p>
                          </div>
                        </>
                      )
                    })()}
                    <div className="flex gap-2 pt-1">
                      <Link href="/ai-insights">
                        <Button size="sm" variant="outline" className="text-xs gap-1">
                          <Sparkles className="h-3.5 w-3.5" /> AI Insights
                        </Button>
                      </Link>
                      <Link href="/competitive-intelligence">
                        <Button size="sm" variant="outline" className="text-xs gap-1">
                          <Globe className="h-3.5 w-3.5" /> Compare Sources
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
