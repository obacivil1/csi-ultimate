"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import {
  Plus, Play, Radio, CheckCircle2, XCircle, Clock, AlertTriangle,
  Sparkles, Globe, ArrowRight, ArrowLeft, Settings2, Target,
  Search, SlidersHorizontal, BarChart3, Rocket, Layers, Tag,
  FileText, Download, Trash2, ExternalLink, MoreHorizontal,
  Activity, Zap, ListChecks, ChevronRight, Hourglass,
} from "lucide-react"
import Link from "next/link"
import { cn, formatDate } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-states"
import { useCampaigns, Campaign, CampaignStrategy, CampaignFilters } from "@/lib/campaign-store"
import { useWorkspace } from "@/lib/workspace-context"

const CATEGORIES = ["All", "Jobs", "Real Estate", "Automotive", "Electronics", "Services", "Furniture", "Clothing", "Pets"]

const PRESETS = [
  { id: "balanced", label: "Balanced", description: "Quality & speed balanced" },
  { id: "deep", label: "Deep Crawl", description: "Maximum data extraction" },
  { id: "quick", label: "Quick Scan", description: "Fast overview results" },
  { id: "high-value", label: "High Value", description: "Focus on price data" },
]

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  draft: { label: "Draft", color: "text-zinc-500", bg: "bg-zinc-500/10", icon: FileText },
  ready: { label: "Ready", color: "text-blue-500", bg: "bg-blue-500/10", icon: ListChecks },
  running: { label: "Running", color: "text-emerald-500", bg: "bg-emerald-500/10", icon: Activity },
  completed: { label: "Completed", color: "text-emerald-500", bg: "bg-emerald-500/10", icon: CheckCircle2 },
  failed: { label: "Failed", color: "text-rose-500", bg: "bg-rose-500/10", icon: XCircle },
  cancelled: { label: "Cancelled", color: "text-zinc-500", bg: "bg-zinc-500/10", icon: XCircle },
}

const WIZARD_STEPS = ["Create Campaign", "Select Sources", "Search Strategy", "Advanced Filters", "Review & Launch"]

export default function CampaignsPage() {
  const { campaigns, createCampaign, deleteCampaign, setCurrentCampaign } = useCampaigns()
  const { workspaces, currentWorkspace } = useWorkspace()

  const [showWizard, setShowWizard] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)
  const [activeTab, setActiveTab] = useState("all")

  const [sites, setSites] = useState<any[]>([])
  const [healthScores, setHealthScores] = useState<any[]>([])

  useEffect(() => {
    Promise.all([
      fetch("/api/sites").then(r => r.ok ? r.json() : []),
      fetch("/api/health").then(r => r.ok ? r.json() : []),
    ]).then(([s, h]) => { setSites(s); setHealthScores(h) })
  }, [])

  const SOURCES = useMemo(() => sites.map(site => {
    const health = healthScores.find((h: any) => h.site === site.hostname)
    const score = health?.healthScore || 0
    const status = score >= 80 ? "healthy" as const : score >= 50 ? "warning" as const : "critical" as const
    return { hostname: site.hostname, name: site.name, health: score, status }
  }), [sites, healthScores])

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [workspaceId, setWorkspaceId] = useState(currentWorkspace?.id || "")
  const [tags, setTags] = useState("")
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [keywords, setKeywords] = useState("")
  const [directUrls, setDirectUrls] = useState("")
  const [preset, setPreset] = useState("balanced")
  const [categories, setCategories] = useState<string[]>([])
  const [dateStart, setDateStart] = useState("")
  const [dateEnd, setDateEnd] = useState("")
  const [priceMin, setPriceMin] = useState("")
  const [priceMax, setPriceMax] = useState("")
  const [location, setLocation] = useState("")
  const [adCategories, setAdCategories] = useState<string[]>([])
  const [maxAds, setMaxAds] = useState("200")
  const [exportFormat, setExportFormat] = useState("excel")

  const resetWizard = () => {
    setShowWizard(false)
    setWizardStep(0)
    setName("")
    setDescription("")
    setWorkspaceId(currentWorkspace?.id || "")
    setTags("")
    setSelectedSources([])
    setKeywords("")
    setDirectUrls("")
    setPreset("balanced")
    setCategories([])
    setDateStart("")
    setDateEnd("")
    setPriceMin("")
    setPriceMax("")
    setLocation("")
    setAdCategories([])
    setMaxAds("200")
    setExportFormat("excel")
  }

  const handleCreate = () => {
    const c = createCampaign({
      name: name || "Untitled Campaign",
      description,
      workspaceId: workspaceId || currentWorkspace?.id,
      tags: tags.split(",").map(t => t.trim()).filter(Boolean),
      sources: selectedSources,
      strategy: {
        keywords: keywords.split(",").map(k => k.trim()).filter(Boolean),
        categories,
        directUrls: directUrls.split("\n").map(u => u.trim()).filter(Boolean),
        preset,
      },
      filters: {
        dateRange: dateStart && dateEnd ? { start: dateStart, end: dateEnd } : null,
        priceRange: priceMin && priceMax ? { min: Number(priceMin), max: Number(priceMax) } : null,
        location,
        adCategories,
        maxAds: Number(maxAds) || 200,
        exportFormat,
      },
      status: selectedSources.length > 0 ? "ready" : "draft",
    })
    setCurrentCampaign(c.id)
    resetWizard()
  }

  const filteredCampaigns = activeTab === "all"
    ? campaigns
    : campaigns.filter(c => c.status === activeTab)

  const toggleSource = (hostname: string) => {
    setSelectedSources(prev =>
      prev.includes(hostname) ? prev.filter(s => s !== hostname) : [...prev, hostname]
    )
  }

  const toggleCategory = (cat: string) => {
    setCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  const toggleAdCategory = (cat: string) => {
    setAdCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  const canNextStep = () => {
    switch (wizardStep) {
      case 0: return name.trim().length > 0
      case 1: return selectedSources.length > 0
      case 2: return true
      case 3: return true
      default: return true
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="gradient-text">Intelligence Campaigns</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">End-to-end intelligence campaign lifecycle</p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="gap-1.5" onClick={() => { resetWizard(); setShowWizard(true) }}>
            <Plus className="h-4 w-4" /> New Campaign
          </Button>
        </div>
      </div>

      {/* Campaign List */}
      {campaigns.length === 0 && !showWizard ? (
        <Card>
          <CardContent>
            <EmptyState
              variant="data"
              title="No campaigns yet"
              description="Create your first intelligence campaign to start collecting data from multiple sources."
              action={
                <Button className="gap-1.5" onClick={() => setShowWizard(true)}>
                  <Rocket className="h-4 w-4" /> Create Campaign
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in-up">
            <TabsList>
              <TabsTrigger value="all" className="gap-1.5 text-xs">All ({campaigns.length})</TabsTrigger>
              <TabsTrigger value="draft" className="gap-1.5 text-xs">Draft ({campaigns.filter(c => c.status === "draft").length})</TabsTrigger>
              <TabsTrigger value="ready" className="gap-1.5 text-xs">Ready ({campaigns.filter(c => c.status === "ready").length})</TabsTrigger>
              <TabsTrigger value="running" className="gap-1.5 text-xs">Running ({campaigns.filter(c => c.status === "running").length})</TabsTrigger>
              <TabsTrigger value="completed" className="gap-1.5 text-xs">Completed ({campaigns.filter(c => c.status === "completed").length})</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredCampaigns.map(c => {
                  const sc = statusConfig[c.status] || statusConfig.draft
                  return (
                    <Link key={c.id} href={`/campaigns/${c.id}`}>
                      <Card className="glass-card hover:border-primary/30 transition-all cursor-pointer group h-full">
                        <CardContent className="p-5 flex flex-col h-full">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <sc.icon className={cn("h-4 w-4 shrink-0", sc.color)} />
                              <span className="text-sm font-medium truncate">{c.name}</span>
                            </div>
                            <Badge variant="outline" className={cn("text-[9px] border-0", sc.bg, sc.color)}>{sc.label}</Badge>
                          </div>
                          {c.description && (
                            <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{c.description}</p>
                          )}
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-3">
                            <Globe className="h-3 w-3" />
                            <span>{c.sources.length} source{c.sources.length !== 1 ? "s" : ""}</span>
                            {c.tags.length > 0 && (
                              <><span className="text-muted-foreground/40">&middot;</span>
                              <Tag className="h-3 w-3" /><span>{c.tags.length}</span></>
                            )}
                          </div>
                          <div className="mt-auto flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">{formatDate(c.createdAt)}</span>
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                          {c.status === "completed" && c.results && (
                            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30">
                              <span className="text-[10px] text-emerald-500">{c.results.totalAds} records</span>
                              <span className="text-[10px] text-blue-500">DQ: {c.results.dataQualityScore}%</span>
                            </div>
                          )}
                          {c.status === "running" && c.runtime && (
                            <div className="mt-2 pt-2 border-t border-border/30">
                              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                                <span>{c.runtime.activeSite || "..."}</span>
                                <span>{Math.round(c.runtime.progress)}%</span>
                              </div>
                              <div className="h-1 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${c.runtime.progress}%` }} />
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </Link>
                  )
                })}
                {filteredCampaigns.length === 0 && (
                  <div className="col-span-full">
                    <EmptyState variant="search" title="No campaigns" description="Create a campaign to get started." />
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Creation Wizard Overlay */}
      {showWizard && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[5vh] pb-[5vh]">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={resetWizard} />
          <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-popover shadow-2xl animate-scale-in">
            {/* Progress indicator */}
            <div className="flex items-center justify-between px-6 pt-5 pb-2">
              <div className="flex items-center gap-1.5">
                <Rocket className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">New Intelligence Campaign</span>
              </div>
              <div className="flex items-center gap-1">
                {WIZARD_STEPS.map((_, i) => (
                  <div key={i} className={cn(
                    "h-1.5 w-8 rounded-full transition-colors",
                    i < wizardStep ? "bg-primary" : i === wizardStep ? "bg-primary/60" : "bg-muted"
                  )} />
                ))}
              </div>
            </div>

            {/* Step label */}
            <div className="px-6 pb-4">
              <span className="text-xs text-muted-foreground">Step {wizardStep + 1} of 5</span>
              <span className="text-xs text-muted-foreground ml-2">&middot;</span>
              <span className="text-xs font-medium ml-2">{WIZARD_STEPS[wizardStep]}</span>
            </div>

            <Separator />

            <div className="p-6 space-y-5">
              {/* Step 1: Create Campaign */}
              {wizardStep === 0 && (
                <div className="space-y-4 animate-fade-in-up">
                  <div className="space-y-2">
                    <Label htmlFor="cmp-name" className="text-sm font-medium">Campaign Name <span className="text-rose-500">*</span></Label>
                    <Input id="cmp-name" placeholder="e.g. UK Classifieds Market Scan" className="h-10" value={name} onChange={e => setName(e.target.value)} autoFocus />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cmp-desc" className="text-sm font-medium">Description</Label>
                    <Textarea id="cmp-desc" placeholder="What is this campaign for?" className="min-h-[80px]" value={description} onChange={e => setDescription(e.target.value)} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Workspace</Label>
                      <Select value={workspaceId} onValueChange={setWorkspaceId}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {workspaces.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Tags</Label>
                      <Input placeholder="market, uk, classifieds" value={tags} onChange={e => setTags(e.target.value)} className="h-10" />
                      <p className="text-[10px] text-muted-foreground">Comma-separated tags</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Select Sources */}
              {wizardStep === 1 && (
                <div className="space-y-4 animate-fade-in-up">
                  <p className="text-xs text-muted-foreground">Select the intelligence sources for this campaign.</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {SOURCES.map(s => {
                      const selected = selectedSources.includes(s.hostname)
                      const statusColor = s.status === "healthy" ? "text-emerald-500" : s.status === "warning" ? "text-amber-500" : "text-rose-500"
                      const statusBg = s.status === "healthy" ? "bg-emerald-500/10" : s.status === "warning" ? "bg-amber-500/10" : "bg-rose-500/10"
                      return (
                        <button
                          key={s.hostname}
                          type="button"
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                            selected
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-muted-foreground/30 bg-transparent"
                          )}
                          onClick={() => toggleSource(s.hostname)}
                        >
                          <div className={cn(
                            "h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all shrink-0",
                            selected ? "border-primary bg-primary" : "border-muted-foreground/30"
                          )}>
                            {selected && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{s.name}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{s.hostname}</div>
                          </div>
                          <Badge variant="outline" className={cn("text-[9px] border-0", statusBg, statusColor)}>{s.health}%</Badge>
                        </button>
                      )
                    })}
                  </div>
                  {selectedSources.length > 0 && (
                    <p className="text-xs text-emerald-500">{selectedSources.length} source{selectedSources.length !== 1 ? "s" : ""} selected</p>
                  )}
                </div>
              )}

              {/* Step 3: Search Strategy */}
              {wizardStep === 2 && (
                <div className="space-y-4 animate-fade-in-up">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Keywords</Label>
                      <Input placeholder="ipad, furniture, laptop" value={keywords} onChange={e => setKeywords(e.target.value)} className="h-10" />
                      <p className="text-[10px] text-muted-foreground">Comma-separated keywords</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Crawl Strategy</Label>
                      <Select value={preset} onValueChange={setPreset}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PRESETS.map(p => <SelectItem key={p.id} value={p.id}>{p.label} — {p.description}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Direct URLs</Label>
                    <Textarea placeholder="https://www.gumtree.com/..."
                      className="min-h-[60px]" value={directUrls} onChange={e => setDirectUrls(e.target.value)} />
                    <p className="text-[10px] text-muted-foreground">One URL per line</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Source Categories</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIES.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          className={cn(
                            "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                            categories.includes(cat)
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-muted-foreground/30"
                          )}
                          onClick={() => toggleCategory(cat)}
                        >{cat}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Advanced Filters */}
              {wizardStep === 3 && (
                <div className="space-y-4 animate-fade-in-up">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Date Range Start</Label>
                      <Input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} className="h-10" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Date Range End</Label>
                      <Input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} className="h-10" />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Price Min ($)</Label>
                      <Input type="number" placeholder="0" value={priceMin} onChange={e => setPriceMin(e.target.value)} className="h-10" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Price Max ($)</Label>
                      <Input type="number" placeholder="10000" value={priceMax} onChange={e => setPriceMax(e.target.value)} className="h-10" />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Location</Label>
                      <Input placeholder="e.g. London, UK" value={location} onChange={e => setLocation(e.target.value)} className="h-10" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Max Ads to Collect</Label>
                      <Input type="number" value={maxAds} onChange={e => setMaxAds(e.target.value)} className="h-10" />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Ad Categories</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {["Jobs", "Housing", "For Sale", "Services", "Community"].map(cat => (
                          <button key={cat} type="button"
                            className={cn(
                              "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                              adCategories.includes(cat)
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:border-muted-foreground/30"
                            )}
                            onClick={() => toggleAdCategory(cat)}
                          >{cat}</button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Export Format</Label>
                      <Select value={exportFormat} onValueChange={setExportFormat}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="excel">Excel (.xlsx)</SelectItem>
                          <SelectItem value="csv">CSV (.csv)</SelectItem>
                          <SelectItem value="json">JSON (.json)</SelectItem>
                          <SelectItem value="pdf">Executive PDF</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 5: Review & Launch */}
              {wizardStep === 4 && (
                <div className="space-y-4 animate-fade-in-up">
                  <Card className="glass-card gradient-border">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-center gap-3">
                        <Rocket className="h-5 w-5 text-primary" />
                        <div>
                          <h3 className="font-semibold">{name}</h3>
                          {description && <p className="text-xs text-muted-foreground">{description}</p>}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="p-3 rounded-lg bg-muted/40">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                            <Globe className="h-3 w-3" /> Sources
                          </div>
                          <div className="font-medium text-sm">{selectedSources.length} selected</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{selectedSources.join(", ")}</div>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/40">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                            <Search className="h-3 w-3" /> Strategy
                          </div>
                          <div className="font-medium text-sm capitalize">{preset}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {keywords || "No keywords"} &middot; {categories.length} categories
                          </div>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/40">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                            <SlidersHorizontal className="h-3 w-3" /> Filters
                          </div>
                          <div className="font-medium text-sm">Max {maxAds} ads</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {exportFormat.toUpperCase()} export &middot; {location || "No location filter"}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 p-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          <div className="text-xs text-muted-foreground">
                            Estimated runtime: <strong>~{selectedSources.length * 15} seconds</strong> for {selectedSources.length} source{selectedSources.length !== 1 ? "s" : ""}.
                            Results will open automatically in the campaign view.
                          </div>
                        </div>
                      </div>

                      <Button className="w-full gap-2 h-11 text-sm" onClick={handleCreate}>
                        <Rocket className="h-4 w-4" /> Create & Launch Campaign
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>

            {/* Footer navigation */}
            <div className="flex items-center justify-between px-6 pb-5 pt-2">
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => { if (wizardStep === 0) resetWizard(); else setWizardStep(s => s - 1) }}>
                <ArrowLeft className="h-3.5 w-3.5" /> {wizardStep === 0 ? "Cancel" : "Back"}
              </Button>
              {wizardStep < 4 ? (
                <Button size="sm" className="gap-1.5" disabled={!canNextStep()} onClick={() => setWizardStep(s => s + 1)}>
                  Next <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
