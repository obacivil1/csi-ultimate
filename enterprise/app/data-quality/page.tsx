"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ShieldCheck, AlertTriangle, Lightbulb,
  Globe, Search, FileSearch, Zap, BarChart3,
} from "lucide-react"
import Link from "next/link"
import { cn, safeFetch } from "@/lib/utils"
import { EngineOffline } from "@/components/engine-offline"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-states"
const FIELD_LABELS: Record<string, string> = {
  title: "Title", description: "Description", price: "Price",
  location: "Location", phones: "Phone", emails: "Email",
}

export default function DataQualityLab() {
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)
  const [selectedSite, setSelectedSite] = useState<string>("")

  useEffect(() => {
    safeFetch("/api/reports").then(d => {
      setReports(d)
      setEngineOnline(d.length > 0)
      setLoading(false)
      if (d.length > 0) setSelectedSite(d[0].site)
    })
  }, [])

  const currentReport = reports.find((r: any) => r.site === selectedSite)
  const fields = currentReport?.fields || {}
  const issues = reports.flatMap((r: any) => (r.issues || []).map((i: string) => ({ site: r.site, issue: i })))
  const suggestions = reports.flatMap((r: any) => (r.configSuggestions || []).map((s: string) => ({ site: r.site, suggestion: s })))

  const fieldEntries = Object.entries(fields).map(([k, v]: [string, any]) => ({
    field: FIELD_LABELS[k] || k,
    key: k,
    pct: v.pct || 0,
    present: v.present || 0,
    total: (v.present || 0) + (v.empty || 0),
  })).sort((a, b) => a.pct - b.pct)

  const avgDQ = reports.length
    ? Math.round(reports.reduce((s: number, r: any) => s + (r.metrics?.dataQualityScore || 0), 0) / reports.length)
    : 0
  const totalRecords = reports.reduce((s: number, r: any) => s + (r.totalAds || 0), 0)

  const worstField = fieldEntries.length > 0 ? fieldEntries[0] : null

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="gradient-text">Data Quality Lab</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Field-level quality analysis and intelligence auditing</p>
        </div>
        <div className="flex items-center gap-2">
          {engineOnline && reports.length > 0 && (
            <Badge variant="outline" className="gap-1.5 h-8">
              <span className={cn("stat-dot", avgDQ >= 80 ? "bg-emerald-500" : avgDQ >= 50 ? "bg-amber-500" : "bg-rose-500")} />
              Avg DQ: {avgDQ}%
            </Badge>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : reports.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              variant="quality"
              title="No quality data available"
              description="Run a campaign to generate quality analysis."
              action={
                <Link href="/crawl-studio">
                  <Button variant="outline" className="gap-1.5">
                    <Zap className="h-4 w-4" /> Launch Campaign
                  </Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary metrics — What's happening now */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 animate-fade-in-up stagger-1">
            {[
              { label: "Overall DQ Score", value: `${avgDQ}%`, icon: ShieldCheck, color: avgDQ >= 80 ? "text-emerald-400" : avgDQ >= 50 ? "text-amber-400" : "text-rose-400", bg: avgDQ >= 80 ? "bg-emerald-500/10" : avgDQ >= 50 ? "bg-amber-500/10" : "bg-rose-500/10" },
              { label: "Sites Analyzed", value: reports.length, icon: Globe, color: "text-blue-400", bg: "bg-blue-500/10" },
              { label: "Issues Detected", value: issues.length, icon: AlertTriangle, color: issues.length > 0 ? "text-rose-400" : "text-emerald-400", bg: issues.length > 0 ? "bg-rose-500/10" : "bg-emerald-500/10" },
              { label: "Suggestions", value: suggestions.length, icon: Lightbulb, color: "text-amber-400", bg: "bg-amber-500/10" },
            ].map((k, i) => (
              <Card key={k.label} className={cn("kpi-card glass-card animate-fade-in-up", `stagger-${i + 1}`)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className={cn("p-2 rounded-lg", k.bg)}>
                      <k.icon className={cn("h-4 w-4", k.color)} />
                    </div>
                  </div>
                  <div className="kpi-value text-lg">{k.value}</div>
                  <div className="kpi-label mt-0.5">{k.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Insight: weakest field */}
          {worstField && worstField.pct < 80 && (
            <Card className="glass-card border-amber-500/20 bg-amber-500/5 animate-fade-in-up stagger-2">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-500">Lowest coverage: <strong>{worstField.field}</strong> ({worstField.pct}%)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Only {worstField.present} of {worstField.total} records have this field populated. Consider reviewing extraction selectors.</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Site selector + Coverage */}
          <div className="grid gap-6 lg:grid-cols-5 animate-fade-in-up stagger-3">
            <Card className="lg:col-span-3 glass-card">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileSearch className="h-4 w-4 text-primary" />
                  Field Coverage &mdash; {currentReport?.site || "No site selected"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <Select value={selectedSite} onValueChange={setSelectedSite}>
                    <SelectTrigger className="w-full max-w-xs">
                      <SelectValue placeholder="Select intelligence source" />
                    </SelectTrigger>
                    <SelectContent>
                      {reports.map((r: any) => (
                        <SelectItem key={r.reportId} value={r.site}>{r.site}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  {fieldEntries.length > 0 ? fieldEntries.map((f) => (
                    <div key={f.key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium">{f.field}</span>
                        <span className={cn(
                          "font-semibold",
                          f.pct >= 80 ? "text-emerald-500" : f.pct >= 50 ? "text-amber-500" : "text-rose-500"
                        )}>
                          {f.pct}% &middot; {f.present}/{f.total}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${f.pct}%`,
                            background: f.pct >= 80
                              ? "oklch(0.55 0.18 160)"
                              : f.pct >= 50
                                ? "oklch(0.6 0.2 80)"
                                : "oklch(0.58 0.24 30)"
                          }}
                        />
                      </div>
                    </div>
                  )) : (
                    <EmptyState
                      variant="data"
                      title="No field coverage data"
                      description="Select a different site or run a campaign first."
                      className="py-6"
                    />
                  )}
                </div>

                {fieldEntries.length > 0 && (
                  <div className="mt-4 text-xs text-muted-foreground text-center">
                    {totalRecords.toLocaleString()} total records analyzed across {fieldEntries.length} fields
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Issues & Suggestions */}
            <div className="lg:col-span-2 space-y-4">
              {/* Issues */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-500" />
                    Issues Found
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {issues.length > 0 ? (
                    <div className="space-y-2">
                      {issues.slice(0, 5).map((item, i) => (
                        <div key={i} className="text-xs p-2 rounded-lg bg-rose-500/5 border border-rose-500/10">
                          <span className="font-medium text-rose-500">{item.site}</span>
                          <span className="text-muted-foreground">: {item.issue}</span>
                        </div>
                      ))}
                      {issues.length > 5 && (
                        <p className="text-xs text-muted-foreground text-center pt-2">
                          +{issues.length - 5} more issue{issues.length - 5 !== 1 ? "s" : ""}
                        </p>
                      )}
                    </div>
                  ) : (
                    <EmptyState
                      variant="quality"
                      title="No issues detected"
                      className="py-4"
                    />
                  )}
                </CardContent>
              </Card>

              {/* Suggestions */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-amber-500" />
                    Recommendations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {suggestions.length > 0 ? (
                    <div className="space-y-2">
                      {suggestions.slice(0, 4).map((item, i) => (
                        <div key={i} className="text-xs p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                          <span className="font-medium text-amber-500">{item.site}</span>
                          <span className="text-muted-foreground">: {item.suggestion}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      variant="search"
                      title="No recommendations"
                      className="py-4"
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Action bar */}
          <div className="flex gap-2 animate-fade-in-up">
            <Link href="/competitive-intelligence">
              <Button variant="outline" className="gap-1.5">
                <BarChart3 className="h-4 w-4" /> Compare Sources
              </Button>
            </Link>
            <Link href="/ai-copilot">
              <Button variant="outline" className="gap-1.5">
                <Lightbulb className="h-4 w-4" /> Full Intelligence Report
              </Button>
            </Link>
            <Link href="/results">
              <Button variant="outline" className="gap-1.5">
                <Search className="h-4 w-4" /> Browse Results
              </Button>
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
