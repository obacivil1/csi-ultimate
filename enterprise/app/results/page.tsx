"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Search, Download, Filter, CheckSquare,
  Globe, Zap, X, Columns3, Activity, ShieldCheck,
  AlertTriangle, CheckCircle2, Lightbulb, FileSpreadsheet,
  SlidersHorizontal, Table2, ChevronDown, ChevronRight,
  Save, Bookmark, Trash2, Group, LayoutGrid, Plus,
} from "lucide-react"
import Link from "next/link"
import { cn, safeFetch, formatDate } from "@/lib/utils"
import { EngineOffline } from "@/components/engine-offline"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-states"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { computeFullValidation, type RecordValidation } from "@/lib/data-validation"

interface ReportData {
  reportId: string; site: string; generatedAt: string; totalAds: number
  jobId?: string
  fields: Record<string, { present: number; empty: number; pct: number }>
  metrics: { dataQualityScore: number; siteHealthScore: number; extractionRate: number }
  issues: string[]; configSuggestions: string[]
}

interface SavedView {
  id: string; name: string; groupBy: string; columnFilter: Record<string, boolean>
  siteFilter: string; minDq: string; sortBy: string
}

const FIELD_LABELS: Record<string, string> = {
  title: "Title", description: "Description", price: "Price",
  location: "Location", phones: "Phone", emails: "Email",
}

const ALL_COLUMNS = ["title", "price", "location", "phones", "emails", "company", "category"]

const GROUP_OPTIONS = [
  { value: "none", label: "No Grouping" },
  { value: "site", label: "Group by Source" },
  { value: "city", label: "Group by City" },
  { value: "category", label: "Group by Category" },
  { value: "dq", label: "Group by Extraction Quality" },
  { value: "date", label: "Group by Date" },
]

function getDqVariant(score: number) {
  return score >= 80 ? "success" as const : score >= 50 ? "warning" as const : "destructive" as const
}

export default function ResultsExplorer() {
  const [reports, setReports] = useState<ReportData[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState<string>("date")
  const [selectedReport, setSelectedReport] = useState<ReportData | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState("browse")
  const [compareReports, setCompareReports] = useState<ReportData[]>([])
  const [siteFilter, setSiteFilter] = useState<string>("all")
  const [minDq, setMinDq] = useState<string>("0")
  const [records, setRecords] = useState<any[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [validation, setValidation] = useState<RecordValidation | null>(null)

  const [groupBy, setGroupBy] = useState<string>("none")
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    ALL_COLUMNS.forEach(c => { init[c] = true })
    return init
  })

  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("results-saved-views")
        if (stored) return JSON.parse(stored)
      } catch {}
    }
    return []
  })
  const [activeView, setActiveView] = useState<string>("")

  const saveCurrentView = useCallback((name: string) => {
    const view: SavedView = {
      id: Date.now().toString(), name,
      groupBy, columnFilter: { ...visibleColumns },
      siteFilter, minDq, sortBy,
    }
    const updated = [...savedViews, view]
    setSavedViews(updated)
    localStorage.setItem("results-saved-views", JSON.stringify(updated))
    setActiveView(view.id)
  }, [savedViews, groupBy, visibleColumns, siteFilter, minDq, sortBy])

  const loadView = useCallback((viewId: string) => {
    const view = savedViews.find(v => v.id === viewId)
    if (!view) return
    setGroupBy(view.groupBy)
    setVisibleColumns(view.columnFilter)
    setSiteFilter(view.siteFilter)
    setMinDq(view.minDq)
    setSortBy(view.sortBy)
    setActiveView(viewId)
  }, [savedViews])

  const deleteView = useCallback((viewId: string) => {
    const updated = savedViews.filter(v => v.id !== viewId)
    setSavedViews(updated)
    localStorage.setItem("results-saved-views", JSON.stringify(updated))
    if (activeView === viewId) setActiveView("")
  }, [savedViews, activeView])

  useEffect(() => {
    safeFetch<ReportData>("/api/reports").then(d => {
      setReports(d)
      setEngineOnline(d.length > 0)
      setLoading(false)
      if (d.length > 0) setSelectedReport(d[0])
    })
  }, [])

  const sites = [...new Set(reports.map(r => r.site).filter(Boolean))]

  const filtered = reports
    .filter(r => r.site?.toLowerCase().includes(search.toLowerCase()))
    .filter(r => siteFilter === "all" || r.site === siteFilter)
    .filter(r => (r.metrics?.dataQualityScore || 0) >= parseInt(minDq))
    .sort((a, b) => {
      if (sortBy === "date") return new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
      if (sortBy === "site") return a.site?.localeCompare(b.site || "") || 0
      if (sortBy === "dq") return (b.metrics?.dataQualityScore || 0) - (a.metrics?.dataQualityScore || 0)
      if (sortBy === "records") return (b.totalAds || 0) - (a.totalAds || 0)
      return 0
    })

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(r => r.reportId)))
  }

  const addToCompare = (report: ReportData) => {
    if (compareReports.find(r => r.reportId === report.reportId)) {
      setCompareReports(prev => prev.filter(r => r.reportId !== report.reportId))
    } else {
      setCompareReports(prev => [...prev, report].slice(0, 4))
    }
  }

  const fetchRecords = async (jobId: string) => {
    setRecordsLoading(true)
    try {
      const res = await fetch(`/api/crawl/${jobId}/records?limit=200`)
      const data = await res.json()
      const fetched = data.records || []
      setRecords(fetched)
      setRecordsTotal(data.total || 0)
      if (fetched.length > 0) {
        setValidation(computeFullValidation(fetched, selectedReport, null))
      } else {
        setValidation(null)
      }
    } catch {
      setRecords([])
      setRecordsTotal(0)
      setValidation(null)
    }
    setRecordsLoading(false)
  }

  useEffect(() => {
    if (activeTab === "explorer" && selectedReport?.jobId) {
      fetchRecords(selectedReport.jobId)
    }
  }, [activeTab, selectedReport])

  const groupedRecords = (() => {
    if (groupBy === "none" || !records.length) return null
    const groups: Record<string, any[]> = {}
    records.forEach(rec => {
      let key = "Unknown"
      if (groupBy === "site") key = selectedReport?.site || "Unknown"
      else if (groupBy === "city") key = rec.city || rec.location || "Unknown"
      else if (groupBy === "category") key = rec.category || "Uncategorized"
      else if (groupBy === "dq") {
        const score = rec.dqScore || selectedReport?.metrics?.dataQualityScore || 0
        key = score >= 80 ? "High Quality (80%+)" : score >= 50 ? "Moderate (50-79%)" : "Low (<50%)"
      } else if (groupBy === "date") {
        const d = rec.date || rec.generatedAt || selectedReport?.generatedAt
        key = d ? new Date(d).toLocaleDateString() : "Unknown"
      }
      if (!groups[key]) groups[key] = []
      groups[key].push(rec)
    })
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  })()

  const colHeaders = ALL_COLUMNS.filter(c => visibleColumns[c])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Results Explorer</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Browse, group, compare, and export intelligence data</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (() => {
            const first = reports.find(r => selectedIds.has(r.reportId) && r.jobId)
            const href = first?.jobId ? `/api/crawl/${first.jobId}/export?format=xlsx` : undefined
            return (
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!href}
              onClick={() => href && window.open(href, "_blank")}>
              <Download className="h-4 w-4" /> Export ({selectedIds.size})
            </Button>
          )})()}
          <Link href="/crawl-studio">
            <Button size="sm" className="gap-1.5"><Search className="h-4 w-4" /> New Search</Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1 space-y-3">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : reports.length === 0 ? (
        <Card><CardContent>
          <EmptyState variant="search" title="No results available yet" description="Launch a campaign to start collecting intelligence data." action={
            <Link href="/crawl-studio"><Button variant="outline" className="gap-1.5"><Zap className="h-4 w-4" /> Launch Campaign</Button></Link>
          } />
        </CardContent></Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="browse" className="gap-1.5 text-xs"><Search className="h-3.5 w-3.5" /> Browse</TabsTrigger>
            <TabsTrigger value="compare" className="gap-1.5 text-xs" disabled={compareReports.length < 2}>
              <Columns3 className="h-3.5 w-3.5" /> Compare ({compareReports.length})
            </TabsTrigger>
            <TabsTrigger value="explorer" className="gap-1.5 text-xs"><Table2 className="h-3.5 w-3.5" /> Data Explorer</TabsTrigger>
          </TabsList>

          <TabsContent value="browse" className="mt-4">
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-1 space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Filter by site..." className="pl-8 h-9 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
                  </div>
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="w-[100px] h-9 text-xs"><Filter className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="site">Site</SelectItem>
                      <SelectItem value="dq">DQ Score</SelectItem>
                      <SelectItem value="records">Records</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-2">
                  <Select value={siteFilter} onValueChange={setSiteFilter}>
                    <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="All sites" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sites</SelectItem>
                      {sites.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={minDq} onValueChange={setMinDq}>
                    <SelectTrigger className="w-24 h-8 text-xs"><SelectValue placeholder="Min DQ" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Any DQ</SelectItem>
                      <SelectItem value="50">50%+</SelectItem>
                      <SelectItem value="80">80%+</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1 max-h-[600px] overflow-y-auto pr-1">
                  {filtered.map(r => (
                    <div
                      key={r.reportId}
                      className={cn(
                        "flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all text-sm",
                        selectedReport?.reportId === r.reportId ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                      )}
                    >
                      <div
                        className={cn(
                          "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                          selectedIds.has(r.reportId) ? "bg-primary border-primary" : "border-muted-foreground/30 hover:border-primary"
                        )}
                        onClick={e => { e.stopPropagation(); toggleSelect(r.reportId) }}
                      >
                        {selectedIds.has(r.reportId) && <CheckSquare className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0" onClick={() => setSelectedReport(r)}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium truncate">{r.site}</span>
                          <Badge variant={getDqVariant(r.metrics?.dataQualityScore || 0)} className="text-[10px] ml-2">
                            {r.metrics?.dataQualityScore || 0}%
                          </Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {r.totalAds} record{r.totalAds !== 1 ? "s" : ""} &middot; {formatDate(r.generatedAt)}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className={cn("h-6 w-6 p-0 shrink-0", compareReports.find(c => c.reportId === r.reportId) ? "text-primary" : "text-muted-foreground")}
                        onClick={e => { e.stopPropagation(); addToCompare(r) }} title="Add to compare">
                        <Columns3 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <button onClick={toggleSelectAll} className="hover:text-foreground transition-colors">
                    {selectedIds.size === filtered.length ? "Deselect all" : "Select all"}
                  </button>
                  <span>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
                </div>
              </div>

              <div className="lg:col-span-2 space-y-4">
                {selectedReport ? (() => {
                  const f = selectedReport.fields || {}
                  const m = selectedReport.metrics || {}
                  const fields = Object.entries(f)
                  const issues = selectedReport.issues || []
                  const suggestions = selectedReport.configSuggestions || []
                  const missingPriceCount = f.price ? f.price.empty : 0
                  const missingPhoneCount = f.phones ? f.phones.empty : 0
                  const missingEmailCount = f.emails ? f.emails.empty : 0
                  const missingLocationCount = f.location ? f.location.empty : 0
                  const totalFields = fields.length
                  const coveredFields = fields.filter(([, fv]) => fv.pct >= 80).length
                  const weakFields = fields.filter(([, fv]) => fv.pct < 50).length
                  const dq = m.dataQualityScore || 0
                  const dqLabel = dq >= 80 ? "strong" : dq >= 50 ? "moderate" : "poor"

                  const topOpportunities: { field: string; count: number; label: string }[] = []
                  if (missingPriceCount > 0) topOpportunities.push({ field: "price", count: missingPriceCount, label: `Missing prices — ${missingPriceCount} records lack pricing data; estimated revenue opportunity: $${(missingPriceCount * 15).toLocaleString()}` })
                  if (missingPhoneCount > 0) topOpportunities.push({ field: "phones", count: missingPhoneCount, label: `Missing phone numbers — ${missingPhoneCount} records have no contact number` })
                  if (missingEmailCount > 0) topOpportunities.push({ field: "emails", count: missingEmailCount, label: `Missing email addresses — ${missingEmailCount} records have no email` })
                  if (missingLocationCount > 0) topOpportunities.push({ field: "location", count: missingLocationCount, label: `Missing location data — ${missingLocationCount} records have no address` })
                  topOpportunities.sort((a, b) => b.count - a.count)
                  const weakFieldNames = fields.filter(([, fv]) => fv.pct < 50).map(([k]) => FIELD_LABELS[k] || k)

                  return (
                  <>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Zap className="h-4 w-4 text-primary" /> Intelligence Summary &mdash; {selectedReport.site}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                          {[
                            { label: "Records", value: selectedReport.totalAds.toLocaleString(), icon: Globe, color: "text-foreground" },
                            { label: "Data Quality", value: `${dq}%`, icon: ShieldCheck, color: dq >= 80 ? "text-emerald-600" : dq >= 50 ? "text-amber-600" : "text-rose-600" },
                            { label: "Extraction Rate", value: `${m.extractionRate || 0}%`, icon: Zap, color: "text-foreground" },
                            { label: "Health Score", value: `${m.siteHealthScore || 0}%`, icon: Activity, color: "text-foreground" },
                          ].map(s => (
                            <div key={s.label} className="p-3 rounded-lg bg-muted text-center">
                              <s.icon className={cn("h-4 w-4 mx-auto mb-1", s.color)} />
                              <div className={cn("text-lg font-bold", s.color)}>{s.value}</div>
                              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mt-0.5">{s.label}</div>
                            </div>
                          ))}
                        </div>
                        <div className="text-sm text-muted-foreground leading-relaxed space-y-1">
                          <p>
                            <strong className="text-foreground">{selectedReport.site}</strong> crawl extracted <strong className="text-foreground">{selectedReport.totalAds.toLocaleString()}</strong> records
                            with <strong className={cn(dq >= 80 ? "text-emerald-600" : dq >= 50 ? "text-amber-600" : "text-rose-600")}>{dqLabel} data quality ({dq}%)</strong>.
                            {totalFields > 0 && ` Of ${totalFields} tracked fields, ${coveredFields} meet quality thresholds and ${weakFields} need attention.`}
                          </p>
                          {topOpportunities.length > 0 && (
                            <p>
                              <strong className="text-foreground">Revenue opportunity:</strong> {topOpportunities[0].count.toLocaleString()} records with missing {topOpportunities[0].field} data.
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    <div className="grid gap-4 sm:grid-cols-2">
                      {topOpportunities.length > 0 && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2 text-emerald-600">
                              <Zap className="h-4 w-4" /> Top Opportunities
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              {topOpportunities.slice(0, 4).map((opp, i) => (
                                <div key={opp.field} className="flex items-start gap-2 p-2 rounded-lg bg-emerald-500/5 text-xs">
                                  <span className="font-medium text-emerald-600 shrink-0">#{i + 1}</span>
                                  <span className="text-muted-foreground">{opp.label}</span>
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      )}
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2 text-rose-600">
                            <AlertTriangle className="h-4 w-4" /> {issues.length > 0 ? "Issues Found" : "No Issues Detected"}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {issues.length > 0 ? (
                            <div className="space-y-1">
                              {issues.map((issue, i) => (
                                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-rose-500/5 text-xs">
                                  <span className="text-rose-600 shrink-0 mt-0.5">&bull;</span>
                                  <span className="text-muted-foreground">{issue}</span>
                                </div>
                              ))}
                            </div>
                          ) : weakFieldNames.length > 0 ? (
                            <div className="text-xs text-muted-foreground">
                              <span className="text-amber-600 font-medium">Weak fields:</span> {weakFieldNames.join(", ")} have below 50% coverage.
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-xs text-emerald-600 py-2">
                              <CheckCircle2 className="h-4 w-4" /> All extraction fields performing within acceptable thresholds.
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>

                    {suggestions.length > 0 && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2 text-emerald-600">
                            <Lightbulb className="h-4 w-4" /> Recommended Actions
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-1">
                            {suggestions.map((s, i) => (
                              <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-emerald-500/5 text-xs">
                                <span className="text-emerald-600 shrink-0 mt-0.5">&#8594;</span>
                                <span className="text-muted-foreground">{s}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1 gap-1.5" onClick={() => { if (selectedReport) addToCompare(selectedReport) }}>
                        <Columns3 className="h-4 w-4" /> Add to Compare
                      </Button>
                      {selectedReport.jobId && (
                        <Link href={`/api/crawl/${selectedReport.jobId}/export?format=xlsx`} className="flex-1">
                          <Button variant="outline" className="w-full gap-1.5">
                            <FileSpreadsheet className="h-4 w-4" /> Export Excel
                          </Button>
                        </Link>
                      )}
                      <Link href="/crawl-studio" className="flex-1">
                        <Button variant="outline" className="w-full gap-1.5">
                          <Search className="h-4 w-4" /> New Crawl
                        </Button>
                      </Link>
                    </div>
                  </>
                )})() : (
                  <Card><CardContent>
                    <EmptyState variant="search" title="Select a result" description="Choose a report from the list to view its details." className="py-14" />
                  </CardContent></Card>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="compare" className="mt-4">
            {compareReports.length >= 2 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <Columns3 className="h-4 w-4 text-primary" />
                    Comparing {compareReports.length} reports
                    <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => setCompareReports([])}>
                      <X className="h-3 w-3 mr-1" /> Clear
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    {compareReports.map(r => (
                      <Badge key={r.reportId} variant="outline" className="gap-1">
                        {r.site}
                        <button onClick={() => addToCompare(r)} className="hover:text-rose-500">&times;</button>
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4" style={{ gridTemplateColumns: `200px repeat(${compareReports.length}, 1fr)` }}>
                  <div className="text-xs font-medium text-muted-foreground p-2">Metric</div>
                  {compareReports.map(r => (
                    <div key={r.reportId} className="text-xs font-medium text-center p-2 border-b border-border/50">{r.site}</div>
                  ))}
                  {([
                    { label: "Records", accessor: (r: ReportData) => r.totalAds.toLocaleString(), color: false },
                    { label: "DQ Score", accessor: (r: ReportData) => `${r.metrics?.dataQualityScore || 0}%`, color: true },
                    { label: "Health", accessor: (r: ReportData) => `${r.metrics?.siteHealthScore || 0}%`, color: true },
                    { label: "Extraction Rate", accessor: (r: ReportData) => `${r.metrics?.extractionRate || 0}%`, color: false },
                    { label: "Issues", accessor: (r: ReportData) => String(r.issues?.length || 0), color: false },
                    ...Object.keys(FIELD_LABELS).map(field => ({
                      label: `${FIELD_LABELS[field]} Coverage`,
                      accessor: (r: ReportData) => {
                        const f = r.fields?.[field]
                        return f ? `${f.pct}%` : "N/A"
                      },
                      color: true,
                    })),
                  ] as { label: string; accessor: (r: ReportData) => string; color: boolean }[]).map(row => (
                    <div key={row.label} className="contents">
                      <div className="text-xs text-muted-foreground p-2 border-t border-border/20">{row.label}</div>
                      {compareReports.map(r => {
                        const val = row.accessor(r)
                        const num = parseInt(val)
                        const isHigh = val.endsWith("%") && num >= 80
                        const isMid = val.endsWith("%") && num >= 50
                        return (
                          <div key={r.reportId} className={cn(
                            "text-xs text-center p-2 border-t border-border/20",
                            row.color && isHigh ? "text-emerald-600" : row.color && isMid ? "text-amber-600" : row.color ? "text-rose-600" : "text-foreground"
                          )}>
                            {val}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Card><CardContent>
                <EmptyState variant="data" title="Select reports to compare" description="Choose at least 2 reports using the compare button (columns icon) in the Browse tab." className="py-14" />
              </CardContent></Card>
            )}
          </TabsContent>

          <TabsContent value="explorer" className="mt-4">
            <div className="space-y-4">
              {/* Saved Views + Group By + Column Chooser bar */}
              <div className="flex items-center gap-2 flex-wrap">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
                      <Bookmark className="h-3.5 w-3.5" /> Saved Views {activeView ? `(1)` : ""}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {savedViews.length === 0 && (
                      <DropdownMenuItem disabled className="text-xs text-muted-foreground">No saved views yet</DropdownMenuItem>
                    )}
                    {savedViews.map(v => (
                      <div key={v.id} className="flex items-center justify-between px-2 py-1 hover:bg-accent rounded-sm cursor-pointer" onClick={() => loadView(v.id)}>
                        <span className={cn("text-xs", activeView === v.id ? "font-medium text-foreground" : "text-muted-foreground")}>{v.name}</span>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0 text-muted-foreground hover:text-rose-500"
                          onClick={e => { e.stopPropagation(); deleteView(v.id) }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => {
                      const name = window.prompt("Save current view as:")
                      if (name?.trim()) saveCurrentView(name.trim())
                    }}>
                      <Plus className="h-3.5 w-3.5" /> Save Current View
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Select value={groupBy} onValueChange={setGroupBy}>
                  <SelectTrigger className="h-8 text-xs w-44">
                    <Group className="h-3.5 w-3.5 mr-1" />
                    <SelectValue placeholder="Group by" />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUP_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
                      <SlidersHorizontal className="h-3.5 w-3.5" /> Columns ({colHeaders.length}/{ALL_COLUMNS.length})
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48 p-2">
                    <p className="text-xs font-medium text-foreground px-1 pb-1">Visible Columns</p>
                    {ALL_COLUMNS.map(c => (
                      <div key={c} className="flex items-center justify-between px-1 py-1">
                        <Label htmlFor={`col-${c}`} className="text-xs cursor-pointer">{FIELD_LABELS[c] || c}</Label>
                        <Switch id={`col-${c}`} checked={visibleColumns[c]} onCheckedChange={v => setVisibleColumns(prev => ({ ...prev, [c]: v }))} />
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="text-xs text-muted-foreground ml-auto">
                  {recordsTotal > 0 && `${recordsTotal} record${recordsTotal !== 1 ? "s" : ""}`}
                  {groupedRecords && ` in ${groupedRecords.length} group${groupedRecords.length !== 1 ? "s" : ""}`}
                </div>
              </div>

              {validation && (
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">Data Trust Report</span>
                      <Badge variant={getDqVariant(validation.extractionAccuracy.accuracyScore)} className="text-[10px] ml-auto">
                        {validation.extractionAccuracy.accuracyScore}% accuracy
                      </Badge>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-4 mb-3">
                      <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-200/30">
                        <div className="text-[11px] text-muted-foreground">Trust Score</div>
                        <div className={cn("text-base font-bold", validation.sellableProductTest.trustScore >= 80 ? "text-emerald-600" : validation.sellableProductTest.trustScore >= 60 ? "text-amber-600" : "text-rose-600")}>
                          {validation.sellableProductTest.trustScore}/100
                        </div>
                        <div className={cn("text-[10px] font-medium mt-0.5", validation.sellableProductTest.verdict === "TRUSTED" ? "text-emerald-600" : validation.sellableProductTest.verdict === "CONDITIONAL" ? "text-amber-600" : "text-rose-600")}>
                          {validation.sellableProductTest.verdict}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-muted">
                        <div className="text-[11px] text-muted-foreground">Duplicates</div>
                        <div className="text-base font-bold text-foreground">{validation.duplicates.duplicatePercentage}%</div>
                        <div className="text-[10px] text-muted-foreground">{validation.duplicates.totalDuplicateRecords} duplicate records</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-muted">
                        <div className="text-[11px] text-muted-foreground">Field Confidence</div>
                        <div className="text-base font-bold text-foreground">{Math.round((validation.fieldConfidence.phone.confidence + validation.fieldConfidence.email.confidence + validation.fieldConfidence.price.confidence) / 3)}%</div>
                        <div className="text-[10px] text-muted-foreground">Phone / Email / Price avg</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-muted">
                        <div className="text-[11px] text-muted-foreground">Completeness</div>
                        <div className="text-base font-bold text-foreground">{validation.extractionAccuracy.accuracyScore}%</div>
                        <div className="text-[10px] text-muted-foreground">{validation.extractionAccuracy.totalRecords} records evaluated</div>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-6 text-center">
                      {[
                        { label: "Phone", pct: validation.extractionAccuracy.phonePct, total: validation.extractionAccuracy.totalRecords, missing: validation.extractionAccuracy.missingPhone },
                        { label: "Email", pct: validation.extractionAccuracy.emailPct, total: validation.extractionAccuracy.totalRecords, missing: validation.extractionAccuracy.missingEmail },
                        { label: "Price", pct: validation.extractionAccuracy.pricePct, total: validation.extractionAccuracy.totalRecords, missing: validation.extractionAccuracy.missingPrice },
                        { label: "Category", pct: validation.extractionAccuracy.categoryPct, total: validation.extractionAccuracy.totalRecords, missing: validation.extractionAccuracy.missingCategory },
                        { label: "Title", pct: validation.extractionAccuracy.titlePct, total: validation.extractionAccuracy.totalRecords, missing: validation.extractionAccuracy.missingTitle },
                        { label: "Location", pct: validation.extractionAccuracy.locationPct, total: validation.extractionAccuracy.totalRecords, missing: validation.extractionAccuracy.missingLocation },
                      ].map(f => (
                        <div key={f.label} className="p-2 rounded border border-border/40">
                          <div className="text-[11px] text-muted-foreground">{f.label}</div>
                          <div className={cn("text-sm font-bold tabular-nums", f.pct >= 80 ? "text-emerald-600" : f.pct >= 50 ? "text-amber-600" : "text-rose-600")}>{f.pct}%</div>
                          <div className={cn("text-[10px]", f.missing > 0 ? "text-rose-500/70" : "text-emerald-500/70")}>{f.missing} missing</div>
                        </div>
                      ))}
                    </div>
                    {validation.crawlQuality.improvements.length > 0 && (
                      <div className="mt-3 p-2.5 rounded-lg bg-amber-500/5 border border-amber-200/30">
                        <div className="text-xs font-medium text-amber-700 mb-1">Improvement suggestions</div>
                        {validation.crawlQuality.improvements.slice(0, 2).map((imp, i) => (
                          <p key={i} className="text-[11px] text-amber-600/80">{imp}</p>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="p-0">
                  {recordsLoading ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">Loading records...</div>
                  ) : records.length > 0 ? (
                    groupedRecords ? (
                      <div className="divide-y divide-border/30">
                        {groupedRecords.map(([groupName, groupItems]) => (
                          <div key={groupName}>
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40">
                              <LayoutGrid className="h-3.5 w-3.5 text-primary" />
                              <span className="text-sm font-medium text-foreground">{groupName}</span>
                              <Badge variant="outline" className="text-[10px] ml-auto">{groupItems.length}</Badge>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-border/50">
                                    {colHeaders.map(c => (
                                      <th key={c} className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{FIELD_LABELS[c] || c}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {groupItems.map((rec, i) => (
                                    <tr key={rec.id || i} className="border-b border-border/20 hover:bg-accent/30 transition-colors">
                                      {colHeaders.map(c => (
                                        <td key={c} className="px-3 py-2 text-xs">
                                          {c === "title" ? (rec.title || rec.name || "Untitled")
                                            : c === "price" ? (rec.price ? `$${rec.price}` : "—")
                                            : c === "location" ? (rec.location || rec.city || "—")
                                            : c === "phones" ? (rec.phones?.[0] || rec.phone || <span className="text-rose-500/50">—</span>)
                                            : c === "emails" ? (rec.emails?.[0] || rec.email || <span className="text-rose-500/50">—</span>)
                                            : c === "company" ? (rec.company || "—")
                                            : c === "category" ? (rec.category || "—")
                                            : "—"}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border/50">
                              {colHeaders.map(c => (
                                <th key={c} className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{FIELD_LABELS[c] || c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {records.map((rec, i) => (
                              <tr key={rec.id || i} className="border-b border-border/20 hover:bg-accent/30 transition-colors">
                                {colHeaders.map(c => (
                                  <td key={c} className="px-3 py-2 text-xs">
                                    {c === "title" ? (rec.title || rec.name || "Untitled")
                                      : c === "price" ? (rec.price ? `$${rec.price}` : "—")
                                      : c === "location" ? (rec.location || rec.city || "—")
                                      : c === "phones" ? (rec.phones?.[0] || rec.phone || <span className="text-rose-500/50">—</span>)
                                      : c === "emails" ? (rec.emails?.[0] || rec.email || <span className="text-rose-500/50">—</span>)
                                      : c === "company" ? (rec.company || "—")
                                      : c === "category" ? (rec.category || "—")
                                      : "—"}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : (
                    <div className="p-8 text-center">
                      <p className="text-sm text-muted-foreground">No records available.</p>
                      <p className="text-xs text-muted-foreground mt-1">Launch a campaign and view results here after records are extracted.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
