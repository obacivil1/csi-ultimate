"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from "recharts"
import { BarChart3, TrendingUp, Activity, Globe } from "lucide-react"
import { cn, safeFetch } from "@/lib/utils"
import { EngineOffline } from "@/components/engine-offline"
import { Skeleton } from "@/components/ui/skeleton"

export default function AnalyticsCenter() {
  const [reports, setReports] = useState<any[]>([])
  const [healthScores, setHealthScores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)

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

  const siteCompareData = reports.slice(0, 10).reverse().map((r: any) => ({
    name: r.site?.split(".")[0] || "?",
    dq: r.metrics?.dataQualityScore || 0,
    health: r.metrics?.siteHealthScore || 0,
    extraction: r.metrics?.extractionRate || 0,
  }))

  const qualityTrend = reports.slice(0, 10).reverse().map((r: any, i: number) => ({
    index: i + 1,
    dq: r.metrics?.dataQualityScore || 0,
    health: r.metrics?.siteHealthScore || 0,
  }))

  const latest = reports[0]
  const fields = latest?.fields || {}
  const fieldChartData = Object.entries(fields).map(([k, v]: [string, any]) => ({
    field: k,
    coverage: v.pct || 0,
  }))

  const avgDQ = healthScores.length
    ? Math.round(healthScores.reduce((s: number, h: any) => s + h.dataQualityScore, 0) / healthScores.length)
    : 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="gradient-text">Analytics Center</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Deep intelligence analysis and trends</p>
        </div>
        <Badge variant="outline" className="gap-1.5 h-8">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
          {reports.length} reports analyzed
        </Badge>
      </div>

      {loading ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
          <Skeleton className="h-[400px] w-full" />
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-muted-foreground">No analytics data available. Run a crawl to generate insights.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in-up stagger-1">
            {[
              { label: "Avg Data Quality", value: `${avgDQ}%`, desc: "Across all sites" },
              { label: "Reports Generated", value: reports.length, desc: "Total intelligence reports" },
              { label: "Sites Analyzed", value: healthScores.length, desc: "Unique sources" },
              { label: "Extraction Rate", value: latest?.metrics?.extractionRate ? `${latest.metrics.extractionRate}%` : "N/A", desc: "Latest crawl" },
            ].map((s, i) => (
              <Card key={s.label} className={cn("kpi-card glass-card animate-fade-in-up", `stagger-${i + 1}`)}>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-0.5">{s.label}</div>
                  <div className="kpi-value text-lg">{s.value}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{s.desc}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Tabs defaultValue="comparison" className="animate-fade-in-up stagger-3">
            <TabsList>
              <TabsTrigger value="comparison" className="gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Site Comparison
              </TabsTrigger>
              <TabsTrigger value="trends" className="gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> Quality Trends
              </TabsTrigger>
              <TabsTrigger value="fields" className="gap-1.5">
                <Activity className="h-3.5 w-3.5" /> Field Coverage
              </TabsTrigger>
            </TabsList>

            <TabsContent value="comparison">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm">Site Comparison &mdash; Quality Metrics</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={siteCompareData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.3} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                      <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="dq" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={50} />
                      <Bar dataKey="health" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={50} />
                      <Bar dataKey="extraction" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={50} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="trends">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm">Quality Trend (Last 10 Crawls)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={qualityTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.3} />
                      <XAxis dataKey="index" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" label={{ value: "Crawl #", position: "bottom", fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                      <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                      <Area type="monotone" dataKey="dq" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} strokeWidth={2} />
                      <Area type="monotone" dataKey="health" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.15} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="fields">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm">Field Coverage &mdash; {latest?.site || "Latest"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={fieldChartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.3} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                      <YAxis type="category" dataKey="field" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={90} />
                      <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="coverage" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="grid gap-6 lg:grid-cols-2 animate-fade-in-up stagger-5">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Extraction Efficiency
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {reports.slice(0, 5).map((r: any) => (
                    <div key={r.reportId} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{r.site}</div>
                        <div className="text-[11px] text-muted-foreground">{r.totalAds} ads</div>
                      </div>
                      <div className="h-2 w-24 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${r.metrics?.extractionRate || 0}%` }} />
                      </div>
                      <span className="text-xs font-mono w-10 text-right">{r.metrics?.extractionRate || 0}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Health Score Evolution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {healthScores.slice(0, 5).map((s: any) => (
                    <div key={s.site} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{s.site}</div>
                        <div className="text-[11px] text-muted-foreground">{s.totalAds} ads</div>
                      </div>
                      <div className="h-2 w-24 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${s.healthScore}%`,
                          background: s.healthScore >= 80 ? "#22c55e" : s.healthScore >= 50 ? "#eab308" : "#ef4444",
                        }} />
                      </div>
                      <span className={cn(
                        "text-xs font-mono w-10 text-right",
                        s.healthScore >= 80 ? "text-emerald-500" : s.healthScore >= 50 ? "text-amber-500" : "text-rose-500",
                      )}>
                        {s.healthScore}%
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

