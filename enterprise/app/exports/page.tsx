"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import {
  Download, FileSpreadsheet, FileJson, Trash2, Clock, Calendar,
  FileText, Share2, RefreshCw, CheckCircle2, XCircle, Loader2,
  Globe, Sparkles, ChevronDown, ChevronUp, Settings2, TrendingUp,
  BarChart3, ShieldCheck, FileBarChart, Printer, Target,
} from "lucide-react"
import Link from "next/link"
import { cn, safeFetch, formatDate } from "@/lib/utils"
import { EngineOffline } from "@/components/engine-offline"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-states"
type ScheduledExport = {
  id: string
  name: string
  site: string
  format: string
  frequency: string
  active: boolean
  lastRun: string | null
  nextRun: string
  runCount: number
}

function generateManagementSummary(reports: any[], healthScores: any[]) {
  const totalSources = healthScores.length || reports.length
  const avgHealth = healthScores.length
    ? Math.round(healthScores.reduce((s: number, h: any) => s + h.healthScore, 0) / healthScores.length)
    : 0
  const avgDQ = reports.length
    ? Math.round(reports.reduce((s: number, r: any) => s + (r.metrics?.dataQualityScore || 0), 0) / reports.length)
    : 0
  const totalRecords = reports.reduce((s: number, r: any) => s + (r.totalAds || 0), 0)
  const totalIssues = reports.reduce((s: number, r: any) => s + (r.issues?.length || 0), 0)
  const totalCampaigns = reports.length
  const criticalSources = healthScores.filter((h: any) => h.healthScore < 50).length
  const healthySources = healthScores.filter((h: any) => h.healthScore >= 80).length
  const recordsMissingPrice = reports.reduce((s: number, r: any) => {
    const priceField = r.fields?.price
    return s + (priceField ? priceField.empty : 0)
  }, 0)
  const revenueOpportunity = recordsMissingPrice * 15
  return { totalSources, avgHealth, avgDQ, totalRecords, totalIssues, totalCampaigns, criticalSources, healthySources, recordsMissingPrice, revenueOpportunity }
}

export default function ExportCenter() {
  const [reports, setReports] = useState<any[]>([])
  const [healthScores, setHealthScores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)
  const [activeTab, setActiveTab] = useState("exports")
  const [schedules, setSchedules] = useState<ScheduledExport[]>([])
  const [showScheduler, setShowScheduler] = useState(false)
  const [exporting, setExporting] = useState<Set<string>>(new Set())

  const loadData = () => {
    Promise.all([
      safeFetch("/api/reports"),
      safeFetch("/api/health"),
      safeFetch("/api/schedules"),
    ]).then(([reps, scores, scheds]) => {
      setReports(reps)
      setHealthScores(scores)
      setSchedules(scheds || [])
      setEngineOnline(reps.length > 0 || scores.length > 0)
      setLoading(false)
    }).catch(() => { setLoading(false); setEngineOnline(false) })
  }

  useEffect(() => { loadData() }, [])

  const summary = generateManagementSummary(reports, healthScores)

  const exports = reports.map(r => ({
    reportId: r.reportId, site: r.site, date: r.generatedAt,
    ads: r.totalAds || 0, dq: r.metrics?.dataQualityScore || 0,
    jobId: r.jobId,
  }))

  const totalSize = exports.length * 12

  const handleExport = (jobId: string, format: string) => {
    if (!jobId) return
    setExporting(prev => new Set(prev).add(`${jobId}-${format}`))
    const link = document.createElement("a")
    link.href = `/api/crawl/${jobId}/export?format=${format}`
    link.target = "_blank"
    link.click()
    setTimeout(() => {
      setExporting(prev => { const n = new Set(prev); n.delete(`${jobId}-${format}`); return n })
    }, 2000)
  }

  const handleGeneratePdf = (report: any) => {
    const win = window.open("", "_blank")
    if (!win) return
    win.document.write(`
      <html><head><title>Report - ${report.site}</title>
      <style>body{font-family:sans-serif;padding:40px;color:#333}h1{color:#6c5ce7}
      .stat{display:inline-block;margin:10px;padding:20px;background:#f5f5f5;border-radius:8px;text-align:center}
      .stat-value{font-size:24px;font-weight:bold}
      .stat-label{font-size:12px;color:#666}
      .bar{height:12px;background:#e0e0e0;border-radius:6px;margin:4px 0}
      .bar-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#6c5ce7,#a29bfe)}
      table{width:100%;border-collapse:collapse;margin-top:20px}
      th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #eee}
      .footer{margin-top:40px;font-size:11px;color:#999;text-align:center}
      </style></head><body>
      <h1>CSI-Ultimate Intelligence Report</h1>
      <p style="color:#666">Source: ${report.site} | Generated: ${formatDate(report.date)}</p>
      <div style="margin:20px 0">
        <div class="stat"><div class="stat-value">${report.ads}</div><div class="stat-label">Records</div></div>
        <div class="stat"><div class="stat-value">${report.dq}%</div><div class="stat-label">Data Quality</div></div>
        <div class="stat"><div class="stat-value">${report.ads * 15}</div><div class="stat-label">Est. Value</div></div>
      </div>
      <h2>Field Coverage</h2>
      ${report.fields ? Object.entries(report.fields).map(([key, f]: any) => `
        <div style="margin:8px 0">
          <div style="display:flex;justify-content:space-between;font-size:13px">
            <span>${key}</span><span>${f.pct}% (${f.present}/${f.present + f.empty})</span>
          </div>
          <div class="bar"><div class="bar-fill" style="width:${f.pct}%"></div></div>
        </div>
      `).join("") : ""}
      <div class="footer">CSI-Ultimate Enterprise Intelligence Platform &mdash; Confidential</div>
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  const handleGenerateExecutiveReport = () => {
    const win = window.open("", "_blank")
    if (!win) return
    win.document.write(`
      <html><head><title>Executive Management Summary</title>
      <style>
        body{font-family:sans-serif;padding:40px;color:#333;max-width:900px;margin:auto}
        h1{color:#6c5ce7;border-bottom:3px solid #6c5ce7;padding-bottom:10px}
        h2{color:#444;margin-top:30px}
        .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}
        .kpi{background:#f8f8ff;padding:16px;border-radius:8px;text-align:center;border:1px solid #e0d8ff}
        .kpi-value{font-size:28px;font-weight:bold;color:#6c5ce7}
        .kpi-label{font-size:11px;color:#888;margin-top:4px}
        .summary-text{background:#f5f5f5;padding:16px;border-radius:8px;line-height:1.6;color:#555}
        table{width:100%;border-collapse:collapse;margin:16px 0}
        th{background:#6c5ce7;color:white;padding:10px 12px;text-align:left;font-size:12px}
        td{padding:8px 12px;border-bottom:1px solid #eee;font-size:13px}
        .footer{margin-top:40px;font-size:11px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:20px}
        .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:bold}
        .badge-green{background:#e8f5e9;color:#2e7d32}
        .badge-red{background:#fbe9e7;color:#c62828}
        .badge-amber{background:#fff8e1;color:#f57f17}
      </style></head><body>
      <h1>Executive Management Summary</h1>
      <p style="color:#888">CSI-Ultimate Intelligence Platform &mdash; Generated ${new Date().toLocaleDateString()}</p>

      <h2>Key Performance Indicators</h2>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-value">${summary.totalSources}</div><div class="kpi-label">Sources Tracked</div></div>
        <div class="kpi"><div class="kpi-value">${summary.avgHealth}%</div><div class="kpi-label">Avg Source Health</div></div>
        <div class="kpi"><div class="kpi-value">${summary.avgDQ}%</div><div class="kpi-label">Avg Data Quality</div></div>
        <div class="kpi"><div class="kpi-value">${summary.totalRecords.toLocaleString()}</div><div class="kpi-label">Total Records</div></div>
        <div class="kpi"><div class="kpi-value">$${summary.revenueOpportunity.toLocaleString()}</div><div class="kpi-label">Revenue Opportunity</div></div>
        <div class="kpi"><div class="kpi-value">${summary.totalCampaigns}</div><div class="kpi-label">Campaigns Run</div></div>
      </div>

      <h2>Executive Narrative</h2>
      <div class="summary-text">
        <p>This report covers <strong>${summary.totalSources}</strong> intelligence sources across <strong>${summary.totalCampaigns}</strong> campaigns, collecting <strong>${summary.totalRecords.toLocaleString()}</strong> total records.</p>
        <p>The average source health is <strong>${summary.avgHealth}%</strong> (${summary.healthySources} healthy, ${summary.criticalSources} critical). Data quality averages <strong>${summary.avgDQ}%</strong> across all sources.</p>
        ${summary.totalIssues > 0 ? `<p><strong>${summary.totalIssues}</strong> data quality issues require attention.</p>` : ""}
        ${summary.revenueOpportunity > 0 ? `<p>Recovering <strong>${summary.recordsMissingPrice.toLocaleString()}</strong> records with missing price data could unlock an estimated <strong>$${summary.revenueOpportunity.toLocaleString()}</strong> in addressable revenue.</p>` : ""}
        <p>Overall platform health is <strong>${summary.avgHealth >= 80 ? "strong" : summary.avgHealth >= 50 ? "moderate" : "critical"}</strong>. ${summary.criticalSources > 0 ? summary.criticalSources + " sources need immediate attention." : "All sources are within acceptable parameters."}</p>
      </div>

      <h2>Source Details</h2>
      <table>
        <tr><th>Source</th><th>Health</th><th>Data Quality</th><th>Records</th><th>Status</th></tr>
        ${reports.slice(0, 8).map((r: any) => `
          <tr>
            <td>${r.site}</td>
            <td>${r.metrics?.siteHealthScore || 0}%</td>
            <td>${r.metrics?.dataQualityScore || 0}%</td>
            <td>${r.totalAds || 0}</td>
            <td><span class="badge ${(r.metrics?.siteHealthScore || 0) >= 80 ? 'badge-green' : (r.metrics?.siteHealthScore || 0) >= 50 ? 'badge-amber' : 'badge-red'}">${(r.metrics?.siteHealthScore || 0) >= 80 ? 'Healthy' : (r.metrics?.siteHealthScore || 0) >= 50 ? 'Warning' : 'Critical'}</span></td>
          </tr>
        `).join("")}
      </table>

      <div class="footer">
        CSI-Ultimate Enterprise Intelligence Platform &mdash; Confidential<br>
        Generated by AI Insights Engine &mdash; ${new Date().toLocaleString()}
      </div>
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="gradient-text">Export &amp; Reporting Center</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Download data, generate reports, and schedule exports</p>
        </div>
        <Badge variant="outline" className="gap-1.5 h-8">
          <Download className="h-3.5 w-3.5 text-primary" />
          {exports.length} files
        </Badge>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-96" />
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : exports.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Download className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>No exports yet. Run a campaign to generate data.</p>
          <Link href="/crawl-studio"><Button variant="outline" className="mt-4">Launch Campaign</Button></Link>
        </CardContent></Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in-up">
          <TabsList className="flex-wrap">
            <TabsTrigger value="exports" className="gap-1.5 text-xs"><Download className="h-3.5 w-3.5" /> Export Files</TabsTrigger>
            <TabsTrigger value="reports" className="gap-1.5 text-xs"><FileText className="h-3.5 w-3.5" /> PDF Reports</TabsTrigger>
            <TabsTrigger value="executive" className="gap-1.5 text-xs"><FileBarChart className="h-3.5 w-3.5" /> Management Summary</TabsTrigger>
            <TabsTrigger value="scheduled" className="gap-1.5 text-xs"><Calendar className="h-3.5 w-3.5" /> Scheduled ({schedules.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="exports" className="mt-4">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2"><Download className="h-4 w-4 text-primary" /> Export History</CardTitle>
                  <Badge variant="outline">{exports.length} files &middot; ~{totalSize}KB</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <div className="grid grid-cols-6 gap-2 px-3 py-2 text-xs text-muted-foreground font-medium border-b border-border">
                    <span className="col-span-2">Intelligence Source</span><span>Date</span><span>Records</span><span>Quality</span><span className="text-right">Actions</span>
                  </div>
                  {exports.map(e => (
                    <div key={e.reportId} className="grid grid-cols-6 gap-2 px-3 py-2.5 text-sm items-center hover:bg-accent/50 rounded-lg transition-colors">
                      <span className="col-span-2 font-medium truncate">{e.site}</span>
                      <span className="text-muted-foreground text-xs">{formatDate(e.date)}</span>
                      <span className="tabular-nums">{e.ads}</span>
                      <Badge variant={e.dq >= 80 ? "success" : "warning"} className="w-fit text-[10px]">{e.dq}%</Badge>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => handleExport(e.jobId, "excel")} disabled={!e.jobId || exporting.has(`${e.jobId}-excel`)}>
                          {e.jobId && exporting.has(`${e.jobId}-excel`) ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => handleExport(e.jobId, "json")} disabled={!e.jobId || exporting.has(`${e.jobId}-json`)}>
                          {e.jobId && exporting.has(`${e.jobId}-json`) ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileJson className="h-3.5 w-3.5 text-blue-500" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => handleExport(e.jobId, "csv")} disabled={!e.jobId || exporting.has(`${e.jobId}-csv`)}>
                          {e.jobId && exporting.has(`${e.jobId}-csv`) ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3.5 w-3.5 text-amber-500" />}
                        </Button>
                        <Separator orientation="vertical" className="h-5 mx-0.5" />
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {exports.slice(0, 4).map(e => (
                <Card key={e.reportId} className="glass-card hover:border-primary/30 transition-all">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">{e.site}</span>
                      </div>
                      <Badge variant={e.dq >= 80 ? "success" : "warning"} className="text-[10px]">{e.dq}%</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                      <div className="p-2 rounded bg-muted/30 text-center">
                        <div className="font-semibold">{e.ads}</div>
                        <div className="text-muted-foreground">Records</div>
                      </div>
                      <div className="p-2 rounded bg-muted/30 text-center">
                        <div className="font-semibold">{formatDate(e.date)}</div>
                        <div className="text-muted-foreground">Generated</div>
                      </div>
                      <div className="p-2 rounded bg-muted/30 text-center">
                        <div className="font-semibold text-emerald-500">{e.ads * 15}</div>
                        <div className="text-muted-foreground">Est. Value</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 h-8 text-xs gap-1.5" onClick={() => handleGeneratePdf(e)}>
                        <FileText className="h-3.5 w-3.5" /> PDF Report
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 h-8 text-xs gap-1.5" onClick={() => handleExport(e.reportId, "excel")}>
                        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="glass-card mt-4">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Branded Report Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Company Name</Label>
                    <Input placeholder="Your Company" className="h-8 text-xs" defaultValue="CSI Intelligence" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Logo URL (optional)</Label>
                    <Input placeholder="https://..." className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Brand Color</Label>
                    <div className="flex gap-2">
                      <Input type="color" defaultValue="#6c5ce7" className="h-8 w-12 p-0.5" />
                      <Input placeholder="#6c5ce7" className="h-8 text-xs flex-1" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* KPI Snapshot */}
            <Card className="glass-card gradient-border mt-4">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-emerald-500/10 shrink-0"><Target className="h-5 w-5 text-emerald-500" /></div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold mb-2">KPI Snapshot — Quick Export</h3>
                    <div className="grid gap-3 sm:grid-cols-3 mb-3">
                      <div className="p-3 rounded bg-muted/30">
                        <div className="text-xs text-muted-foreground">Total Records</div>
                        <div className="text-lg font-bold">{summary.totalRecords.toLocaleString()}</div>
                      </div>
                      <div className="p-3 rounded bg-muted/30">
                        <div className="text-xs text-muted-foreground">Avg Data Quality</div>
                        <span className="text-lg font-bold">{summary.avgDQ}%</span>
                      </div>
                      <div className="p-3 rounded bg-amber-500/5 border border-amber-500/10">
                        <div className="text-xs text-amber-500">Revenue Opportunity</div>
                        <div className="text-lg font-bold text-amber-500">${summary.revenueOpportunity.toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="text-xs gap-1.5" onClick={handleGenerateExecutiveReport}>
                        <FileBarChart className="h-3.5 w-3.5" /> Export KPI Summary
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs gap-1.5">
                        <Printer className="h-3.5 w-3.5" /> Print
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Management Summary Tab — Executive Report */}
          <TabsContent value="executive" className="mt-4 space-y-4">
            <Card className="glass-card gradient-border">
              <CardContent className="p-6">
                <div className="flex items-start gap-4 mb-6">
                  <div className="p-2 rounded-lg bg-primary/10 shrink-0"><FileBarChart className="h-5 w-5 text-primary" /></div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold">Executive Management Summary</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Enterprise-wide KPI snapshot covering {summary.totalSources} sources across {summary.totalCampaigns} campaigns
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="text-xs gap-1.5" onClick={handleGenerateExecutiveReport}>
                      <FileBarChart className="h-3.5 w-3.5" /> Generate Report
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs gap-1.5">
                      <Download className="h-3.5 w-3.5" /> Download PDF
                    </Button>
                  </div>
                </div>

                {/* KPI Grid */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-6">
                  <div className="p-4 rounded-lg bg-muted/40">
                    <div className="flex items-center gap-2 mb-1">
                      <Globe className="h-3.5 w-3.5 text-blue-500" />
                      <span className="text-xs text-muted-foreground">Intelligence Coverage</span>
                    </div>
                    <div className="text-2xl font-bold">{summary.totalSources}</div>
                    <div className="text-xs text-muted-foreground">
                      {summary.healthySources} healthy, {summary.criticalSources} critical
                    </div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/40">
                    <div className="flex items-center gap-2 mb-1">
                      <HeartPulseIcon className="h-3.5 w-3.5 text-emerald-500" />
                      <span className="text-xs text-muted-foreground">Avg Source Health</span>
                    </div>
                    <div className="text-2xl font-bold">{summary.avgHealth}%</div>
                    <div className="text-xs text-muted-foreground">{summary.healthySources}/{summary.totalSources} optimal</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/40">
                    <div className="flex items-center gap-2 mb-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-violet-500" />
                      <span className="text-xs text-muted-foreground">Data Quality</span>
                    </div>
                    <div className="text-2xl font-bold">{summary.avgDQ}%</div>
                    <div className="text-xs text-muted-foreground">Across all campaigns</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/40">
                    <div className="flex items-center gap-2 mb-1">
                      <DatabaseIcon className="h-3.5 w-3.5 text-blue-500" />
                      <span className="text-xs text-muted-foreground">Total Records</span>
                    </div>
                    <div className="text-2xl font-bold">{summary.totalRecords.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">{summary.totalCampaigns} campaigns executed</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/40">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangleIcon className="h-3.5 w-3.5 text-rose-500" />
                      <span className="text-xs text-muted-foreground">Issues Detected</span>
                    </div>
                    <div className="text-2xl font-bold">{summary.totalIssues}</div>
                    <div className="text-xs text-muted-foreground">Requiring investigation</div>
                  </div>
                  <div className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/10">
                    <div className="flex items-center gap-2 mb-1">
                      <Target className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-xs text-amber-500">Revenue Opportunity</span>
                    </div>
                    <div className="text-2xl font-bold text-amber-500">${summary.revenueOpportunity.toLocaleString()}</div>
                    <div className="text-xs text-amber-500/80">
                      {summary.recordsMissingPrice.toLocaleString()} records missing price data
                    </div>
                  </div>
                </div>

                {/* Source Summary Table */}
                <Card className="glass-card overflow-hidden">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold">Source Performance Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/50">
                            <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Source</th>
                            <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Health</th>
                            <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">DQ</th>
                            <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Records</th>
                            <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Extraction</th>
                            <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Issues</th>
                            <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reports.slice(0, 6).map((r: any) => {
                            const health = r.metrics?.siteHealthScore || 0
                            const st = health >= 80 ? "Healthy" : health >= 50 ? "Warning" : "Critical"
                            const stColor = health >= 80 ? "text-emerald-500" : health >= 50 ? "text-amber-500" : "text-rose-500"
                            const stBg = health >= 80 ? "bg-emerald-500/10" : health >= 50 ? "bg-amber-500/10" : "bg-rose-500/10"
                            return (
                              <tr key={r.reportId} className="border-b border-border/20 hover:bg-accent/30 transition-colors">
                                <td className="px-4 py-2 font-medium text-xs">{r.site}</td>
                                <td className="px-4 py-2 tabular-nums text-xs">{health}%</td>
                                <td className="px-4 py-2 tabular-nums text-xs">{r.metrics?.dataQualityScore || 0}%</td>
                                <td className="px-4 py-2 tabular-nums text-xs">{r.totalAds?.toLocaleString() || 0}</td>
                                <td className="px-4 py-2 tabular-nums text-xs">{r.metrics?.extractionRate || 0}%</td>
                                <td className="px-4 py-2 tabular-nums text-xs">{r.issues?.length || 0}</td>
                                <td className="px-4 py-2">
                                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", stColor, stBg)}>{st}</span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scheduled" className="mt-4 space-y-4">
            {schedules.length > 0 && (
              <div className="space-y-2">
                {schedules.map(s => (
                  <Card key={s.id} className="glass-card">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Switch checked={s.active} onCheckedChange={() => { fetch(`/api/schedules/${s.id}/toggle`, { method: "PUT" }).catch(() => {}); setSchedules(prev => prev.map(sch => sch.id === s.id ? { ...sch, active: !sch.active } : sch)) }} />
                          <div>
                            <div className="text-sm font-medium">{s.name}</div>
                            <div className="text-xs text-muted-foreground">{s.site} &middot; {s.format.toUpperCase()}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right text-xs">
                            <div className="flex items-center gap-1 justify-end text-muted-foreground">
                              <RefreshCw className="h-3 w-3" />
                              <span className="capitalize">{s.frequency}</span>
                            </div>
                            <div className="text-muted-foreground">Run #{s.runCount}</div>
                          </div>
                          <Badge variant={s.active ? "success" : "secondary"}>{s.active ? "Active" : "Paused"}</Badge>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500" onClick={() => { fetch(`/api/schedules/${s.id}`, { method: "DELETE" }).catch(() => {}); setSchedules(prev => prev.filter(sch => sch.id !== s.id)) }}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> Last: {s.lastRun ? formatDate(s.lastRun) : "Never"}</div>
                        <div className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Next: {formatDate(s.nextRun)}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <Card className="glass-card">
              <CardHeader className="pb-2">
                <button className="flex items-center justify-between w-full" onClick={() => setShowScheduler(!showScheduler)}>
                  <CardTitle className="text-sm flex items-center gap-2"><Calendar className="h-4 w-4 text-primary" /> Create Scheduled Export</CardTitle>
                  {showScheduler ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>
              </CardHeader>
                  {showScheduler && <ScheduleForm onSchedule={(s) => setSchedules(prev => [...prev, s])} exports={exports} />}
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function HeartPulseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <polyline points="3.6 14 8.5 14 10.5 10 13.5 16 15.5 12 20.4 12" />
    </svg>
  )
}

function ScheduleForm({ onSchedule, exports }: { onSchedule: (s: ScheduledExport) => void; exports: any[] }) {
  const [name, setName] = useState("")
  const [site, setSite] = useState("")
  const [format, setFormat] = useState("excel")
  const [frequency, setFrequency] = useState("weekly")
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!name.trim() || !site) return
    setCreating(true)
    const nextDate = new Date()
    nextDate.setDate(nextDate.getDate() + (frequency === "daily" ? 1 : frequency === "weekly" ? 7 : 30))
    const newItem = {
      id: `sched_${Date.now()}`,
      name: name.trim(),
      site,
      format,
      frequency,
      active: true,
      lastRun: null,
      nextRun: nextDate.toISOString(),
      runCount: 0,
    }
    await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site, keywords: name, interval: frequency, maxAds: 50 }),
    }).catch(() => {})
    onSchedule(newItem)
    setName(""); setSite(""); setFormat("excel"); setFrequency("weekly")
    setCreating(false)
  }

  return (
    <CardContent className="animate-fade-in-up">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label className="text-xs">Name</Label>
          <Input placeholder="Weekly Report" className="h-8 text-xs" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Source</Label>
          <Select value={site} onValueChange={setSite}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {exports.map(e => <SelectItem key={e.reportId} value={e.site}>{e.site}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Format</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Format" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="excel">Excel (.xlsx)</SelectItem>
              <SelectItem value="csv">CSV (.csv)</SelectItem>
              <SelectItem value="json">JSON (.json)</SelectItem>
              <SelectItem value="pdf">PDF Report</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Frequency</Label>
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Frequency" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">&nbsp;</Label>
          <Button className="w-full h-8 text-xs gap-1.5" onClick={handleCreate} disabled={!name.trim() || !site || creating}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calendar className="h-3.5 w-3.5" />} Create Schedule
          </Button>
        </div>
      </div>
    </CardContent>
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

function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}
