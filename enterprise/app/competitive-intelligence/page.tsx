"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import {
  Globe, TrendingUp, TrendingDown, Minus, Trophy, ShieldCheck,
  Search, ArrowUpDown, Download, ArrowLeft, ArrowRight,
  Sparkles, Activity, Database, AlertTriangle, Eye, Filter, X,
  SlidersHorizontal, BarChart3, Target, ChevronRight,
} from "lucide-react"
import Link from "next/link"
import { cn, safeFetch, formatDate } from "@/lib/utils"
import { EngineOffline } from "@/components/engine-offline"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-states"
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, Cell,
} from "recharts"

type SiteComparison = {
  hostname: string
  healthScore: number
  dataQualityScore: number
  totalAds: number
  extractionRate: number
  issues: number
  lastCrawl: string
  trend: number
  tier: string
}

const SortHeader = ({ label, sortKey: sk, currentSort, onToggle }: { label: string; sortKey: string; currentSort: string; onToggle: (k: string) => void }) => (
  <button onClick={() => onToggle(sk)} className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
    {label}
    <ArrowUpDown className={cn("h-3 w-3", currentSort === sk && "text-primary")} />
  </button>
)

const TIERS: Record<string, { label: string; color: string; bg: string }> = {
  A: { label: "High Performance", color: "text-emerald-500", bg: "bg-emerald-500/10" },
  B: { label: "Moderate", color: "text-amber-500", bg: "bg-amber-500/10" },
  C: { label: "Blocked", color: "text-rose-500", bg: "bg-rose-500/10" },
  D: { label: "Unstable", color: "text-rose-500", bg: "bg-rose-500/10" },
}

const TIER_MAP: Record<string, string> = {
  "gumtree.com": "A", "preloved.co.uk": "A", "olx.com.pk": "A",
  "london.craigslist.org": "B", "expatriates.com": "B",
  "bayt.com": "D", "sa.opensooq.com": "D",
}

export default function CompetitiveIntelligenceCenter() {
  const [healthScores, setHealthScores] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<string>("healthScore")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [selectedSites, setSelectedSites] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<"table" | "cards" | "chart">("table")
  const [expandedSite, setExpandedSite] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [tierFilter, setTierFilter] = useState("all")
  const [healthMin, setHealthMin] = useState(0)
  const [healthMax, setHealthMax] = useState(100)
  const [dqMin, setDqMin] = useState(0)
  const [dqMax, setDqMax] = useState(100)

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

  const comparisons: SiteComparison[] = healthScores.map((h: any) => {
    const report = reports.find((r: any) => r.site === h.site)
    // Compute real trend from reports if multiple exist for this site
    const siteReports = reports.filter((r: any) => r.site === h.site).sort((a: any, b: any) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    const trend = siteReports.length >= 2
      ? (siteReports[0].metrics?.dataQualityScore || 0) - (siteReports[1].metrics?.dataQualityScore || 0)
      : 0
    return {
      hostname: h.site,
      healthScore: h.healthScore,
      dataQualityScore: h.dataQualityScore || report?.metrics?.dataQualityScore || 0,
      totalAds: h.totalAds || report?.totalAds || 0,
      extractionRate: report?.metrics?.extractionRate || 0,
      issues: report?.issues?.length || 0,
      lastCrawl: h.lastCrawl,
      trend,
      tier: TIER_MAP[h.site] || "B",
    }
  }).filter(s => s.hostname)

  const filtered = comparisons
    .filter(s => s.hostname.toLowerCase().includes(search.toLowerCase()))
    .filter(s => tierFilter === "all" || s.tier === tierFilter)
    .filter(s => s.healthScore >= healthMin && s.healthScore <= healthMax)
    .filter(s => s.dataQualityScore >= dqMin && s.dataQualityScore <= dqMax)
    .sort((a, b) => {
      const av = (a as any)[sortKey] ?? 0
      const bv = (b as any)[sortKey] ?? 0
      return sortDir === "desc" ? bv - av : av - bv
    })

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc")
    else { setSortKey(key); setSortDir("desc") }
  }

  const toggleSite = (hostname: string) => {
    setSelectedSites(prev => {
      const next = new Set(prev)
      if (next.has(hostname)) next.delete(hostname); else next.add(hostname)
      return next
    })
  }

  const avgHealth = comparisons.length ? Math.round(comparisons.reduce((s, c) => s + c.healthScore, 0) / comparisons.length) : 0
  const avgDQ = comparisons.length ? Math.round(comparisons.reduce((s, c) => s + c.dataQualityScore, 0) / comparisons.length) : 0
  const totalRecords = comparisons.reduce((s, c) => s + c.totalAds, 0)
  const totalIssues = comparisons.reduce((s, c) => s + c.issues, 0)

  const sortedForRanking = [...comparisons]
    .sort((a, b) => (b.healthScore * 0.4 + b.dataQualityScore * 0.4 + b.extractionRate * 0.2) - (a.healthScore * 0.4 + a.dataQualityScore * 0.4 + a.extractionRate * 0.2))

  const tierCounts = { A: 0, B: 0, C: 0, D: 0 }
  comparisons.forEach(s => { if (s.tier in tierCounts) (tierCounts as any)[s.tier]++ })

  const benchmarkData = [...comparisons]
    .sort((a, b) => b.dataQualityScore - a.dataQualityScore)
    .slice(0, 8)
    .map(s => ({ name: s.hostname.split(".")[0], "Data Quality": s.dataQualityScore, "Health": s.healthScore }))

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="gradient-text">Competitive Intelligence Center</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Compare, benchmark, and rank intelligence sources</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className={cn("gap-1.5 text-xs", showFilters && "border-primary")} onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-3.5 w-3.5" /> Filters
          </Button>
          <Select value={viewMode} onValueChange={(v: any) => setViewMode(v)}>
            <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="table">Table View</SelectItem>
              <SelectItem value="cards">Scorecards</SelectItem>
              <SelectItem value="chart">Charts</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs">
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : comparisons.length === 0 ? (
        <Card><CardContent>
          <EmptyState variant="sites" title="No intelligence sources" description="Launch campaigns to collect data for comparison." className="py-10" />
        </CardContent></Card>
      ) : (
        <>
          {/* KPI Strip — clickable */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 animate-fade-in-up stagger-1">
            <Link href="/sites">
              <Card className="kpi-card glass-card hover:border-primary/30 transition-all cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="p-2 rounded-lg bg-blue-500/10"><Globe className="h-4 w-4 text-blue-400" /></div>
                  </div>
                  <div className="kpi-value text-lg">{comparisons.length}</div>
                  <div className="kpi-label">Sources Tracked</div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/operations">
              <Card className="kpi-card glass-card hover:border-primary/30 transition-all cursor-pointer">
                <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className={cn("p-2 rounded-lg", avgHealth >= 80 ? "bg-emerald-500/10" : "bg-amber-500/10")}>
                        <Activity className={cn("h-4 w-4", avgHealth >= 80 ? "text-emerald-400" : "text-amber-400")} />
                      </div>
                    </div>
                  <div className="kpi-value text-lg">{avgHealth}%</div>
                  <div className="kpi-label">Avg Health</div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/data-quality">
              <Card className="kpi-card glass-card hover:border-primary/30 transition-all cursor-pointer">
                <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className={cn("p-2 rounded-lg", avgDQ >= 80 ? "bg-emerald-500/10" : "bg-amber-500/10")}>
                        <ShieldCheck className={cn("h-4 w-4", avgDQ >= 80 ? "text-emerald-400" : "text-amber-400")} />
                      </div>
                    </div>
                  <div className="kpi-value text-lg">{avgDQ}%</div>
                  <div className="kpi-label">Avg Data Quality</div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/results">
              <Card className="kpi-card glass-card hover:border-primary/30 transition-all cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="p-2 rounded-lg bg-violet-500/10"><Database className="h-4 w-4 text-violet-400" /></div>
                  </div>
                  <div className="kpi-value text-lg">{totalRecords.toLocaleString()}</div>
                  <div className="kpi-label">Total Records</div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/ai-copilot">
              <Card className="kpi-card glass-card hover:border-primary/30 transition-all cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className={cn("p-2 rounded-lg", totalIssues > 0 ? "bg-rose-500/10" : "bg-emerald-500/10")}>
                      <AlertTriangle className={cn("h-4 w-4", totalIssues > 0 ? "text-rose-400" : "text-emerald-400")} />
                    </div>
                  </div>
                  <div className="kpi-value text-lg">{totalIssues}</div>
                  <div className="kpi-label">Issues Found</div>
                </CardContent>
              </Card>
            </Link>
          </div>

          {/* Advanced Filters Panel */}
          {showFilters && (
            <Card className="glass-card animate-fade-in-up">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold flex items-center gap-1.5">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-primary" /> Advanced Filters
                  </h3>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => { setTierFilter("all"); setHealthMin(0); setHealthMax(100); setDqMin(0); setDqMax(100) }}>
                    <X className="h-3 w-3" /> Reset
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Tier</Label>
                    <Select value={tierFilter} onValueChange={setTierFilter}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Tiers</SelectItem>
                        <SelectItem value="A">A — High Performance ({tierCounts.A})</SelectItem>
                        <SelectItem value="B">B — Moderate ({tierCounts.B})</SelectItem>
                        <SelectItem value="C">C — Blocked ({tierCounts.C})</SelectItem>
                        <SelectItem value="D">D — Unstable ({tierCounts.D})</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Health Score Range</Label>
                    <div className="flex items-center gap-2">
                      <Input type="number" min={0} max={100} value={healthMin} onChange={e => setHealthMin(Number(e.target.value))} className="h-7 text-xs w-16" />
                      <span className="text-[10px] text-muted-foreground">to</span>
                      <Input type="number" min={0} max={100} value={healthMax} onChange={e => setHealthMax(Number(e.target.value))} className="h-7 text-xs w-16" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Data Quality Range</Label>
                    <div className="flex items-center gap-2">
                      <Input type="number" min={0} max={100} value={dqMin} onChange={e => setDqMin(Number(e.target.value))} className="h-7 text-xs w-16" />
                      <span className="text-[10px] text-muted-foreground">to</span>
                      <Input type="number" min={0} max={100} value={dqMax} onChange={e => setDqMax(Number(e.target.value))} className="h-7 text-xs w-16" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Search</Label>
                    <Input placeholder="Filter by name..." className="h-7 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Table View */}
          {viewMode === "table" && (
            <Card className="glass-card animate-fade-in-up stagger-3 overflow-hidden">
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    Source Benchmarking
                    <Badge variant="outline" className="text-[9px]">{filtered.length} shown</Badge>
                  </CardTitle>
                  <div className="relative w-48">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Filter sources..." className="pl-8 h-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50">
                        <th className="text-left px-4 py-3"><span className="text-xs font-medium text-muted-foreground">Source</span></th>
                        <th className="text-left px-4 py-3"><SortHeader label="Health" sortKey="healthScore" currentSort={sortKey} onToggle={toggleSort} /></th>
                        <th className="text-left px-4 py-3"><SortHeader label="Data Quality" sortKey="dataQualityScore" currentSort={sortKey} onToggle={toggleSort} /></th>
                        <th className="text-left px-4 py-3"><SortHeader label="Records" sortKey="totalAds" currentSort={sortKey} onToggle={toggleSort} /></th>
                        <th className="text-left px-4 py-3"><SortHeader label="Extraction" sortKey="extractionRate" currentSort={sortKey} onToggle={toggleSort} /></th>
                        <th className="text-left px-4 py-3"><SortHeader label="Issues" sortKey="issues" currentSort={sortKey} onToggle={toggleSort} /></th>
                        <th className="text-left px-4 py-3"><SortHeader label="Trend" sortKey="trend" currentSort={sortKey} onToggle={toggleSort} /></th>
                        <th className="text-left px-4 py-3"><SortHeader label="Tier" sortKey="tier" currentSort={sortKey} onToggle={toggleSort} /></th>
                        <th className="text-right px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(s => (
                        <tr key={s.hostname} className={cn(
                          "border-b border-border/20 transition-colors hover:bg-accent/30",
                          selectedSites.has(s.hostname) && "bg-primary/5"
                        )}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selectedSites.has(s.hostname)}
                                onChange={() => toggleSite(s.hostname)}
                                className="rounded border-muted-foreground/30 accent-primary"
                              />
                              <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                              <span className="font-medium text-sm">{s.hostname}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full" style={{
                                  width: `${s.healthScore}%`,
                                  background: s.healthScore >= 80 ? "oklch(0.55 0.18 160)" : s.healthScore >= 50 ? "oklch(0.6 0.2 80)" : "oklch(0.58 0.24 30)"
                                }} />
                              </div>
                              <span className={cn("text-xs font-semibold tabular-nums w-10 text-right", s.healthScore >= 80 ? "text-emerald-500" : s.healthScore >= 50 ? "text-amber-500" : "text-rose-500")}>{s.healthScore}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={s.dataQualityScore >= 80 ? "success" : s.dataQualityScore >= 50 ? "warning" : "destructive"} className="text-[10px]">
                              {s.dataQualityScore}%
                            </Badge>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-xs">{s.totalAds.toLocaleString()}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full" style={{
                                  width: `${s.extractionRate}%`,
                                  background: s.extractionRate >= 80 ? "oklch(0.55 0.18 160)" : "oklch(0.6 0.2 80)"
                                }} />
                              </div>
                              <span className="text-xs">{s.extractionRate}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn("text-xs font-medium", s.issues > 0 ? "text-rose-500" : "text-emerald-500")}>{s.issues}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {s.trend > 1 ? <TrendingUp className="h-3 w-3 text-emerald-500" /> : s.trend < -1 ? <TrendingDown className="h-3 w-3 text-rose-500" /> : <Minus className="h-3 w-3 text-muted-foreground" />}
                              <span className={cn("text-xs tabular-nums", s.trend > 1 ? "text-emerald-500" : s.trend < -1 ? "text-rose-500" : "text-muted-foreground")}>
                                {s.trend > 0 ? "+" : ""}{s.trend}%
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", TIERS[s.tier]?.color || "text-muted-foreground", TIERS[s.tier]?.bg || "bg-muted/50")}>
                              {s.tier}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link href={`/crawl-studio?site=${s.hostname}`}>
                              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                                Configure <ChevronRight className="h-3 w-3" />
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={9} className="px-4 py-10"><EmptyState variant="search" title="No matching sources" description="Adjust filters or search query." /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground border-t border-border/30">
                  <span>{filtered.length} of {comparisons.length} sources</span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Healthy</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Warning</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Critical</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Scorecards View */}
          {viewMode === "cards" && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 animate-fade-in-up stagger-3">
              {filtered.map((s, i) => (
                <Link key={s.hostname} href={`/crawl-studio?site=${s.hostname}`}>
                  <Card className={cn("glass-card hover:border-primary/30 transition-all group cursor-pointer", `stagger-${i + 1}`)}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Globe className="h-4 w-4 text-primary shrink-0" />
                          <span className="text-sm font-medium truncate">{s.hostname}</span>
                        </div>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium border", TIERS[s.tier]?.color, TIERS[s.tier]?.bg)}>
                          Tier {s.tier}
                        </span>
                      </div>
                      <div className="space-y-2 mb-3">
                        {[
                          { label: "Health", value: s.healthScore, color: s.healthScore >= 80 ? "oklch(0.55 0.18 160)" : s.healthScore >= 50 ? "oklch(0.6 0.2 80)" : "oklch(0.58 0.24 30)" },
                          { label: "Data Quality", value: s.dataQualityScore, color: s.dataQualityScore >= 80 ? "oklch(0.55 0.18 160)" : s.dataQualityScore >= 50 ? "oklch(0.6 0.2 80)" : "oklch(0.58 0.24 30)" },
                          { label: "Extraction", value: s.extractionRate, color: s.extractionRate >= 80 ? "oklch(0.55 0.18 160)" : "oklch(0.6 0.2 80)" },
                        ].map(m => (
                          <div key={m.label}>
                            <div className="flex justify-between text-xs mb-0.5">
                              <span className="text-muted-foreground">{m.label}</span>
                              <span className="font-medium">{m.value}%</span>
                            </div>
                            <div className="h-1 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${m.value}%`, background: m.color }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                        <div className="p-2 rounded-lg bg-muted/30">
                          <span className="text-muted-foreground">Records</span>
                          <div className="font-medium tabular-nums">{s.totalAds.toLocaleString()}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-muted/30">
                          <span className="text-muted-foreground">Issues</span>
                          <div className={cn("font-medium tabular-nums", s.issues > 0 ? "text-rose-500" : "text-emerald-500")}>{s.issues}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          {s.trend > 1 ? <TrendingUp className="h-3 w-3 text-emerald-500" /> : s.trend < -1 ? <TrendingDown className="h-3 w-3 text-rose-500" /> : <Minus className="h-3 w-3 text-muted-foreground" />}
                          <span className={cn("text-xs tabular-nums", s.trend > 1 ? "text-emerald-500" : s.trend < -1 ? "text-rose-500" : "text-muted-foreground")}>
                            {s.trend > 0 ? "+" : ""}{s.trend}%
                          </span>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full"><EmptyState variant="search" title="No matching sources" description="Adjust filters." /></div>
              )}
            </div>
          )}

          {/* Chart View */}
          {viewMode === "chart" && (
            <div className="grid gap-6 lg:grid-cols-2 animate-fade-in-up stagger-3">
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    14-Day Health Trend
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-72 flex items-center justify-center">
                  <div className="text-center max-w-xs">
                    <TrendingUp className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Historical trend data requires repeated crawls over time.</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Run campaigns on a recurring schedule to build trend visualizations.</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    Quality & Health Benchmark
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={benchmarkData} layout="vertical" barCategoryGap={8}>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "oklch(0.55 0 0)" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "oklch(0.55 0 0)" }} axisLine={false} tickLine={false} width={80} />
                      <Tooltip contentStyle={{ background: "oklch(0.1 0.02 260 / 0.95)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: "8px", fontSize: "12px" }} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <Bar dataKey="Data Quality" radius={[0, 4, 4, 0]} fill="oklch(0.6 0.2 270 / 0.8)" />
                      <Bar dataKey="Health" radius={[0, 4, 4, 0]} fill="oklch(0.55 0.18 160 / 0.8)" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Source Ranking */}
          <Card className="glass-card gradient-border animate-fade-in-up">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                  <Trophy className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-sm font-semibold">Source Ranking</h3>
                    <span className="text-[10px] text-muted-foreground">By composite score (health 40% + DQ 40% + extraction 20%)</span>
                  </div>
                  <div className="space-y-1.5">
                    {sortedForRanking.map((s, i) => {
                      const score = Math.round(s.healthScore * 0.4 + s.dataQualityScore * 0.4 + s.extractionRate * 0.2)
                      const prevScore = sortedForRanking[i - 1]
                        ? Math.round(sortedForRanking[i - 1].healthScore * 0.4 + sortedForRanking[i - 1].dataQualityScore * 0.4 + sortedForRanking[i - 1].extractionRate * 0.2)
                        : 0
                      const gap = prevScore > 0 ? prevScore - score : 0
                      return (
                        <Link key={s.hostname} href={`/crawl-studio?site=${s.hostname}`}>
                          <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/30 transition-colors cursor-pointer">
                            <div className={cn(
                              "h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                              i === 0 ? "bg-amber-500/20 text-amber-500" : i === 1 ? "bg-zinc-400/20 text-zinc-400" : i === 2 ? "bg-amber-700/20 text-amber-700" : "bg-muted text-muted-foreground"
                            )}>
                              {i + 1}
                            </div>
                            <Globe className="h-4 w-4 text-primary shrink-0" />
                            <span className="text-sm font-medium flex-1">{s.hostname}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground hidden sm:block">
                                Score: <span className="font-semibold text-foreground">{score}</span>
                                {gap > 0 && <span className="text-rose-500 ml-1">(-{gap})</span>}
                              </span>
                              <Badge variant={s.healthScore >= 80 ? "success" : s.healthScore >= 50 ? "warning" : "destructive"} className="text-[10px]">
                                {s.healthScore >= 80 ? "Healthy" : s.healthScore >= 50 ? "Warning" : "Critical"}
                              </Badge>
                              {i === 0 && <Sparkles className="h-3.5 w-3.5 text-amber-500" />}
                            </div>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
