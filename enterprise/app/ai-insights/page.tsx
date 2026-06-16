"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Lightbulb, AlertTriangle, CheckCircle2, ThumbsUp, RefreshCw,
  Wrench, BrainCircuit, TrendingUp, TrendingDown, AlertCircle,
} from "lucide-react"
import { cn, safeFetch } from "@/lib/utils"
import { EngineOffline } from "@/components/engine-offline"
import { Skeleton } from "@/components/ui/skeleton"

export default function AIInsights() {
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

  const allIssues = reports.flatMap(r => (r.issues || []).map((i: string) => ({
    site: r.site, issue: i, date: r.generatedAt, id: r.reportId,
  })))
  const allSuggestions = reports.flatMap(r => (r.configSuggestions || []).map((s: string) => ({
    site: r.site, suggestion: s, date: r.generatedAt, id: r.reportId,
  })))

  const healthRiskMap = healthScores.map(h => {
    const score = h.healthScore || 0
    const risk = score >= 80 ? "Low" : score >= 60 ? "Medium" : score >= 40 ? "High" : "Critical"
    return { site: h.site, risk, score, issues: h.issues || 0 }
  }).sort((a, b) => a.score - b.score)

  const anomalies = reports.filter(r => r.issues?.length > 0 || r.metrics?.cloudflareDetections > 0 || r.metrics?.blockedPages > 0).flatMap(r => {
    const items: { site: string; type: string; severity: string; desc: string }[] = []
    if (r.metrics?.cloudflareDetections > 0) {
      items.push({ site: r.site, type: "Cloudflare Block", severity: "critical", desc: `${r.metrics.cloudflareDetections} requests blocked by Cloudflare protection` })
    }
    if (r.metrics?.blockedPages > 0) {
      items.push({ site: r.site, type: "Rate Limiting", severity: "warning", desc: `${r.metrics.blockedPages} pages blocked — possible rate limiting` })
    }
    if (r.metrics?.extractionRate !== undefined && r.metrics.extractionRate < 50) {
      items.push({ site: r.site, type: "Structure Change", severity: "critical", desc: `Low extraction rate (${r.metrics.extractionRate}%) — selectors may need update` })
    }
    if (r.issues?.some((i: string) => i.toLowerCase().includes("selector") || i.toLowerCase().includes("structure") || i.toLowerCase().includes("changed"))) {
      items.push({ site: r.site, type: "Structure Change", severity: "critical", desc: r.issues.find((i: string) => i.toLowerCase().includes("selector") || i.toLowerCase().includes("structure") || i.toLowerCase().includes("changed")) })
    }
    return items
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="gradient-text">AI Insights</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Intelligent analysis and automated recommendations
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5 h-8">
          <BrainCircuit className="h-3.5 w-3.5 text-primary" />
          AI Engine Active
        </Badge>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-64" />
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BrainCircuit className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-muted-foreground">Run a crawl to generate AI insights and recommendations.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in-up stagger-1">
            {[
              { label: "Issues Detected", value: allIssues.length, icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10" },
              { label: "Suggestions", value: allSuggestions.length, icon: Lightbulb, color: "text-emerald-400", bg: "bg-emerald-500/10" },
              { label: "Anomalies", value: anomalies.length, icon: AlertCircle, color: "text-rose-400", bg: "bg-rose-500/10" },
              { label: "Critical Sites", value: healthRiskMap.filter(s => s.risk === "Critical" || s.risk === "High").length, icon: TrendingDown, color: "text-rose-400", bg: "bg-rose-500/10" },
            ].map((k, i) => (
              <Card key={k.label} className={cn("kpi-card glass-card animate-fade-in-up", `stagger-${i + 1}`)}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg", k.bg)}>
                    <k.icon className={cn("h-4 w-4", k.color)} />
                  </div>
                  <div>
                    <div className="kpi-value text-lg">{k.value}</div>
                    <div className="kpi-label">{k.label}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Tabs defaultValue="issues" className="animate-fade-in-up stagger-3">
            <TabsList>
              <TabsTrigger value="issues" className="gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Issues {allIssues.length > 0 && `(${allIssues.length})`}
              </TabsTrigger>
              <TabsTrigger value="recommendations" className="gap-1.5">
                <Lightbulb className="h-3.5 w-3.5" /> Recommendations
              </TabsTrigger>
              <TabsTrigger value="anomalies" className="gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" /> Anomalies ({anomalies.length})
              </TabsTrigger>
              <TabsTrigger value="risk" className="gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" /> Site Risk
              </TabsTrigger>
            </TabsList>

            <TabsContent value="issues">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm">Detected Quality Issues</CardTitle>
                </CardHeader>
                <CardContent>
                  {allIssues.length === 0 ? (
                    <div className="text-muted-foreground text-sm py-8 text-center">
                      <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
                      <p>No issues detected — all systems nominal.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {allIssues.map((s, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm">{s.issue}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{s.site}</div>
                          </div>
                          <Button variant="outline" size="sm" className="h-7 text-xs shrink-0">
                            <Wrench className="h-3 w-3 mr-1" /> Fix
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="recommendations">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm">AI Recommendations</CardTitle>
                </CardHeader>
                <CardContent>
                  {allSuggestions.length === 0 ? (
                    <div className="text-muted-foreground text-sm py-8 text-center">
                      <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
                      <p>All configurations optimal — no recommendations.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {allSuggestions.map((s, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                          <Lightbulb className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm">{s.suggestion}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{s.site}</div>
                          </div>
                          <Button variant="outline" size="sm" className="h-7 text-xs shrink-0">
                            <ThumbsUp className="h-3 w-3 mr-1" /> Apply
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="anomalies">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm">Detected Anomalies</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {anomalies.map((a, i) => (
                      <div key={i} className={cn(
                        "flex items-start gap-3 p-3 rounded-lg",
                        a.severity === "critical" ? "bg-rose-500/10" : "bg-amber-500/10"
                      )}>
                        {a.severity === "critical"
                          ? <AlertCircle className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
                          : <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                        }
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{a.type}</span>
                            <Badge variant={a.severity === "critical" ? "destructive" : "warning"} className="text-[9px] h-4">
                              {a.severity}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">{a.site} — {a.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="risk">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm">Site Risk Assessment</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {healthRiskMap.map((s) => (
                      <div key={s.site} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30">
                        <span className={cn(
                          "h-2.5 w-2.5 rounded-full shrink-0",
                          s.risk === "Low" ? "bg-emerald-500" :
                          s.risk === "Medium" ? "bg-amber-500" :
                          s.risk === "High" ? "bg-rose-500" : "bg-rose-700"
                        )} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{s.site}</div>
                          <div className="text-[11px] text-muted-foreground">{s.issues} issues detected</div>
                        </div>
                        <Badge variant={
                          s.risk === "Low" ? "success" :
                          s.risk === "Medium" ? "warning" :
                          s.risk === "High" ? "destructive" : "destructive"
                        } className="text-[10px]">
                          {s.risk}
                        </Badge>
                        <span className={cn(
                          "text-sm font-mono w-10 text-right",
                          s.score >= 80 ? "text-emerald-500" : s.score >= 50 ? "text-amber-500" : "text-rose-500"
                        )}>
                          {s.score}%
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="grid gap-6 lg:grid-cols-2 animate-fade-in-up stagger-5">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-primary" />
                  Auto-Fix Center
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground text-sm py-4 text-center">
                  <Wrench className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>Auto-fix system ready. {allIssues.length} issues can be fixed.</p>
                  <Button variant="outline" className="mt-4" disabled={allIssues.length === 0}>
                    <RefreshCw className="mr-1.5 h-4 w-4" /> Apply All Fixes ({allIssues.length})
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Intelligence Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { label: "Sites Analyzed", value: healthRiskMap.length, sub: `${healthScores.length} sources tracked` },
                    { label: "Issues Found", value: allIssues.length, sub: `${healthRiskMap.filter(s => s.risk === "Critical").length} critical` },
                    { label: "Recommendations", value: allSuggestions.length, sub: "Available for review" },
                    { label: "Auto-Fixable", value: Math.min(allIssues.length, allSuggestions.length), sub: "One-click resolution" },
                  ].map(s => (
                    <div key={s.label} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                      <div>
                        <div className="text-sm">{s.label}</div>
                        <div className="text-xs text-muted-foreground">{s.sub}</div>
                      </div>
                      <span className="text-lg font-bold">{s.value}</span>
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
