"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { cn, safeFetch } from "@/lib/utils"
import {
  Play, ArrowLeft, ArrowRight, Check, Globe, Loader2,
  Search, Link2, Layers, Settings2, ShieldCheck, Zap, AlertTriangle,
  Bookmark, Clock, Gauge, Save,
  Sparkles, Star, Tag, DollarSign, MapPin,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { EngineOffline } from "@/components/engine-offline"
import { Skeleton } from "@/components/ui/skeleton"

const MODES = [
  { id: "keyword", label: "Keyword Search", desc: "Search by keywords across the site", icon: Search, color: "text-blue-400" },
  { id: "category", label: "Category Browse", desc: "Extract from predefined categories", icon: Layers, color: "text-purple-400" },
  { id: "url", label: "URL List", desc: "Extract from specific listing URLs", icon: Link2, color: "text-emerald-400" },
]

const PRESETS = [
  { id: "quick", label: "Quick Scan", desc: "50 records, 5 workers, 0.5s delay", icon: Zap, maxAds: 50, concurrency: 5, delay: 500 },
  { id: "balanced", label: "Deep Extraction", desc: "200 records, 3 workers, 1.5s delay", icon: Layers, maxAds: 200, concurrency: 3, delay: 1500 },
  { id: "full", label: "Full Audit", desc: "500 records, 2 workers, 3s delay", icon: ShieldCheck, maxAds: 500, concurrency: 2, delay: 3000 },
  { id: "custom", label: "Custom Config", desc: "Full control over all parameters", icon: Settings2, maxAds: 100, concurrency: 3, delay: 1500 },
]

const CATEGORY_ICONS: Record<string, { icon: any; color: string }> = {
  electronics: { icon: Zap, color: "text-blue-400" },
  vehicles: { icon: Gauge, color: "text-emerald-400" },
  property: { icon: MapPin, color: "text-purple-400" },
  jobs: { icon: Star, color: "text-amber-400" },
  services: { icon: Tag, color: "text-rose-400" },
  pets: { icon: Zap, color: "text-amber-400" },
  furniture: { icon: Zap, color: "text-orange-400" },
  fashion: { icon: Zap, color: "text-pink-400" },
  books: { icon: Zap, color: "text-cyan-400" },
  sports: { icon: Zap, color: "text-lime-400" },
  default: { icon: Layers, color: "text-muted-foreground" },
}

function getCategoryIcon(id: string) {
  return CATEGORY_ICONS[id] || CATEGORY_ICONS.default
}

const SPEED_OPTIONS = [
  { value: "1", label: "Careful", desc: "1 worker, maximum politeness" },
  { value: "3", label: "Balanced", desc: "3 workers, recommended" },
  { value: "5", label: "Fast", desc: "5 workers, higher throughput" },
  { value: "10", label: "Turbo", desc: "10 workers, maximum speed" },
]

const DELAY_OPTIONS = [
  { value: "500", label: "Aggressive", desc: "0.5s between requests" },
  { value: "1500", label: "Normal", desc: "1.5s between requests" },
  { value: "3000", label: "Polite", desc: "3s between requests" },
  { value: "5000", label: "Stealth", desc: "5s between requests" },
]

export default function CrawlStudio() {
  const router = useRouter()
  const [sites, setSites] = useState<any[]>([])
  const [healthScores, setHealthScores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(false)
  const [siteSearch, setSiteSearch] = useState("")

  const [step, setStep] = useState(0)
  const [site, setSite] = useState("")
  const [mode, setMode] = useState<"keyword" | "category" | "url">("keyword")
  const [keywords, setKeywords] = useState("")
  const [category, setCategory] = useState("")
  const [url, setUrl] = useState("")
  const [maxAds, setMaxAds] = useState("100")
  const [concurrency, setConcurrency] = useState("3")
  const [delay, setDelay] = useState("1500")
  const [selectedPreset, setSelectedPreset] = useState<string>("balanced")
  const [templateName, setTemplateName] = useState("")
  const [running, setRunning] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [discoveredCategories, setDiscoveredCategories] = useState<string[]>([])
  const [discoveryCache] = useState(() => new Map<string, string[]>())
  const [savedTemplates, setSavedTemplates] = useState<any[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("crawl-templates")
      if (stored) try { return JSON.parse(stored) } catch {}
    }
    return []
  })

  useEffect(() => {
    Promise.all([
      safeFetch("/api/sites"),
      safeFetch("/api/health"),
    ]).then(([siteList, scores]) => {
      setSites(siteList)
      setHealthScores(scores)
      setEngineOnline(siteList.length > 0)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!site || mode !== "category") return
    setDiscovering(true) // eslint-disable-line react-hooks/set-state-in-effect
    fetch(`/api/sites/${site}/discover`)
      .then(r => r.json())
      .then(data => {
        const cats = data.categories || []
        discoveryCache.set(site, cats)
        setDiscoveredCategories(cats)
      })
      .catch(() => setDiscoveredCategories([]))
      .finally(() => setDiscovering(false))
  }, [site, mode])

  const selectedSite = sites.find((s: any) => s.hostname === site)
  const siteHealth = healthScores.find((h: any) => h.site === site)

  const filteredSites = sites.filter((s: any) =>
    s.name?.toLowerCase().includes(siteSearch.toLowerCase()) ||
    s.hostname?.toLowerCase().includes(siteSearch.toLowerCase())
  )

  const applyPreset = (presetId: string) => {
    const preset = PRESETS.find(p => p.id === presetId)
    if (!preset) return
    setSelectedPreset(presetId)
    setMaxAds(String(preset.maxAds))
    setConcurrency(String(preset.concurrency))
    setDelay(String(preset.delay))
  }

  const saveAsTemplate = () => {
    if (!templateName.trim()) return
    const tmpl = {
      id: Date.now().toString(),
      name: templateName,
      site, mode, keywords, category, url,
      maxAds: parseInt(maxAds), concurrency: parseInt(concurrency), delay: parseInt(delay),
    }
    const updated = [...savedTemplates, tmpl]
    setSavedTemplates(updated)
    localStorage.setItem("crawl-templates", JSON.stringify(updated))
    setTemplateName("")
  }

  const loadTemplate = (tmpl: any) => {
    setSite(tmpl.site)
    setMode(tmpl.mode)
    setKeywords(tmpl.keywords || "")
    setCategory(tmpl.category || "")
    setUrl(tmpl.url || "")
    setMaxAds(String(tmpl.maxAds))
    setConcurrency(String(tmpl.concurrency))
    setDelay(String(tmpl.delay))
  }

  const deleteTemplate = (id: string) => {
    const updated = savedTemplates.filter(t => t.id !== id)
    setSavedTemplates(updated)
    localStorage.setItem("crawl-templates", JSON.stringify(updated))
  }

  const canNext = () => {
    if (step === 0) return !!site
    if (step === 1) return true
    if (step === 2) {
      if (mode === "keyword") return keywords.trim().length > 0
      if (mode === "url") return url.trim().length > 0
      return true
    }
    return true
  }

  const handleLaunch = async () => {
    setRunning(true)
    try {
      const search = mode === "keyword" ? keywords : mode === "category" ? category : undefined
      const r = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://www.${site}`,
          search,
          maxAds: parseInt(maxAds),
          concurrency: parseInt(concurrency),
          delay: parseInt(delay),
        }),
      })
      const job = await r.json()
      setJobId(job.jobId)
      setStep(4)
      setTimeout(() => router.push(`/jobs/${job.jobId}`), 2000)
    } catch (e: any) {
      console.error(e)
    }
    setRunning(false)
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!engineOnline) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <EngineOffline />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="gradient-text">Crawl Studio</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Configure and launch intelligence campaigns</p>
        </div>
        {savedTemplates.length > 0 && (
          <div className="flex items-center gap-2">
            <Select onValueChange={(v) => {
              const tmpl = savedTemplates.find(t => t.id === v)
              if (tmpl) loadTemplate(tmpl)
            }}>
              <SelectTrigger className="w-40 h-8 text-xs">
                <Bookmark className="h-3 w-3 mr-1" />
                <SelectValue placeholder="Load template" />
              </SelectTrigger>
              <SelectContent>
                {savedTemplates.map(t => (
                  <SelectItem key={t.id} value={t.id} className="flex items-center justify-between">
                    <span>{t.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 animate-fade-in-up stagger-1">
        {["Site", "Mode", "Configure", "Review", "Launch"].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
              i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-emerald-500/20 text-emerald-500" : "bg-muted text-muted-foreground"
            )}>
              {i < step ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
              <span className="hidden sm:inline">{s}</span>
            </div>
            {i < 4 && <div className="h-px w-6 bg-border" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="animate-fade-in-up stagger-2 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  Select Intelligence Source
                </CardTitle>
                <div className="relative w-56">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search sources..." className="pl-8 h-8 text-xs" value={siteSearch} onChange={e => setSiteSearch(e.target.value)} />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredSites.map((s: any) => {
                  const health = healthScores.find((h: any) => h.site === s.hostname)
                  const tier = !health ? "D" : health.healthScore >= 80 ? "A" : health.healthScore >= 50 ? "B" : "C"
                  return (
                    <div
                      key={s.hostname}
                      onClick={() => setSite(s.hostname)}
                      className={cn(
                        "relative p-4 rounded-lg border cursor-pointer transition-all",
                        site === s.hostname
                          ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                          : "border-border hover:border-primary/50 bg-card"
                      )}
                    >
                      {site === s.hostname && (
                        <div className="absolute top-2 right-2">
                          <Check className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <div className="flex items-center gap-2 mb-2">
                        <Globe className={cn("h-5 w-5 shrink-0", site === s.hostname ? "text-primary" : "text-muted-foreground")} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{s.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{s.hostname}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium",
                          tier === "A" ? "bg-emerald-500/10 text-emerald-500" : tier === "B" ? "bg-amber-500/10 text-amber-500" : "bg-rose-500/10 text-rose-500"
                        )}>Tier {tier}</span>
                        {health && (
                          <span className={cn(
                            "text-[10px] font-medium",
                            health.healthScore >= 80 ? "text-emerald-500" : health.healthScore >= 50 ? "text-amber-500" : "text-rose-500"
                          )}>
                            {health.healthScore}% health
                          </span>
                        )}
                      </div>
                      {health && (
                        <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{
                            width: `${health.healthScore}%`,
                            background: health.healthScore >= 80 ? "oklch(0.55 0.18 160)" : health.healthScore >= 50 ? "oklch(0.6 0.2 80)" : "oklch(0.58 0.24 30)"
                          }} />
                        </div>
                      )}
                      <div className="mt-2 text-[10px] text-muted-foreground">
                        {s.language === "ar" ? "Arabic" : "English"} &middot; {s.extractionSelectors?.length || 0} selectors
                      </div>
                    </div>
                  )
                })}
              </div>
              {filteredSites.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">No sources match your search</div>
              )}
            </CardContent>
          </Card>

          {savedTemplates.length > 0 && (
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bookmark className="h-4 w-4 text-primary" />
                  Saved Templates
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 flex-wrap">
                  {savedTemplates.map(t => (
                    <Badge key={t.id} variant="outline" className="gap-1.5 cursor-pointer hover:bg-accent" onClick={() => loadTemplate(t)}>
                      <Bookmark className="h-3 w-3" />
                      {t.name}
                      <button className="ml-1 hover:text-rose-500" onClick={e => { e.stopPropagation(); deleteTemplate(t.id) }}>&times;</button>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="animate-fade-in-up stagger-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Choose Extraction Mode
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                {MODES.map(m => (
                  <div
                    key={m.id}
                    onClick={() => setMode(m.id as any)}
                    className={cn(
                      "flex flex-col items-center gap-3 p-6 rounded-lg border cursor-pointer text-center transition-all",
                      mode === m.id ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20" : "border-border hover:border-primary/50"
                    )}
                  >
                    <m.icon className={cn("h-8 w-8", mode === m.id ? m.color : "text-muted-foreground")} />
                    <div>
                      <div className="text-sm font-medium">{m.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{m.desc}</div>
                    </div>
                    {mode === m.id && <Check className="h-4 w-4 text-primary" />}
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg bg-muted/50 p-3 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Pro Tip:</span> Keyword search works best for known products. Category browse is ideal for market-wide analysis. URL list is for targeted extraction.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="animate-fade-in-up stagger-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-primary" />
                Campaign Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {mode === "keyword" && (
                <div className="space-y-2">
                  <Label>Search Keywords <span className="text-muted-foreground">(comma separated)</span></Label>
                  <Input
                    placeholder="sofa, iphone, car, laptop"
                    value={keywords}
                    onChange={e => setKeywords(e.target.value)}
                    className="h-10"
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter keywords to search for across {selectedSite?.name || "the selected site"}
                  </p>
                </div>
              )}
              {mode === "category" && (
                <div className="space-y-2">
                  <Label>Category</Label>
                  {discovering ? (
                    <div className="flex items-center gap-2 p-4 rounded-lg border border-border bg-muted/20 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      Discovering categories from {selectedSite?.name || site}...
                    </div>
                  ) : discoveredCategories.length === 0 ? (
                    <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 text-sm text-amber-500">
                      No categories could be discovered for this site. Try keyword search mode instead.
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      {discoveredCategories.map((cat: string) => {
                        const iconDef = getCategoryIcon(cat.toLowerCase())
                        const Icon = iconDef.icon
                        return (
                          <div
                            key={cat}
                            onClick={() => setCategory(cat)}
                            className={cn(
                              "flex flex-col items-center gap-2 p-4 rounded-lg border cursor-pointer text-center transition-all",
                              category === cat ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border hover:border-primary/50"
                            )}
                          >
                            <Icon className={cn("h-6 w-6", iconDef.color)} />
                            <span className="text-xs font-medium capitalize">{cat.replace(/-/g, " ")}</span>
                            {category === cat && <Check className="h-3 w-3 text-primary" />}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
              {mode === "url" && (
                <div className="space-y-2">
                  <Label>Listing URLs <span className="text-muted-foreground">(one per line)</span></Label>
                  <textarea
                    className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder={"https://www.gumtree.com/p/item1\nhttps://www.gumtree.com/p/item2"}
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                  />
                </div>
              )}

              <Separator />

              <div>
                <Label className="mb-2 block text-sm">Quick Presets</Label>
                <div className="grid gap-3 sm:grid-cols-4">
                  {PRESETS.map(p => (
                    <div
                      key={p.id}
                      onClick={() => applyPreset(p.id)}
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                        selectedPreset === p.id ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border hover:border-primary/50"
                      )}
                    >
                      <p.icon className={cn("h-5 w-5 mt-0.5 shrink-0", selectedPreset === p.id ? "text-primary" : "text-muted-foreground")} />
                      <div>
                        <div className="text-sm font-medium">{p.label}</div>
                        <div className="text-[10px] text-muted-foreground">{p.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Max Records</Label>
                  <Input type="number" value={maxAds} onChange={e => setMaxAds(e.target.value)} min={1} max={1000} className="h-10" />
                </div>
                <div className="space-y-2">
                  <Label>Speed</Label>
                  <Select value={concurrency} onValueChange={v => { setConcurrency(v); setSelectedPreset("custom") }}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SPEED_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value}>
                          <span className="flex items-center gap-2">
                            <Zap className="h-3.5 w-3.5" />
                            {o.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Politeness Delay</Label>
                  <Select value={delay} onValueChange={v => { setDelay(v); setSelectedPreset("custom") }}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DELAY_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value}>
                          <span className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5" />
                            {o.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-lg bg-muted/50 p-3 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Intelligence Note:</span> Higher speed settings may trigger rate limiting. Start with Balanced for best results. Deep Extraction preset is recommended for comprehensive market analysis.
                </div>
              </div>

              <Separator />

              <div className="flex items-center gap-3">
                <Input
                  placeholder="Name this configuration (optional)"
                  className="h-9 text-sm flex-1"
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                />
                <Button variant="outline" size="sm" className="gap-1.5" onClick={saveAsTemplate} disabled={!templateName.trim()}>
                  <Save className="h-4 w-4" /> Save Template
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 3 && (
        <div className="animate-fade-in-up stagger-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Review Campaign
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-border divide-y divide-border">
                <div className="grid grid-cols-2 gap-2 p-4 text-sm">
                  <span className="text-muted-foreground">Intelligence Source</span>
                  <span className="font-medium">{selectedSite?.name} ({site})</span>
                  <span className="text-muted-foreground">Extraction Mode</span>
                  <span className="font-medium capitalize">{mode === "keyword" ? "Keyword Search" : mode === "category" ? "Category Browse" : "URL List"}</span>
                  {mode === "keyword" && <><span className="text-muted-foreground">Keywords</span><span className="font-medium">{keywords}</span></>}
                  {mode === "category" && <><span className="text-muted-foreground">Category</span><span className="font-medium capitalize">{category.replace(/-/g, " ")}</span></>}
                  <span className="text-muted-foreground">Max Records</span><span className="font-medium">{maxAds}</span>
                  <span className="text-muted-foreground">Speed</span><span className="font-medium">{concurrency} workers</span>
                  <span className="text-muted-foreground">Delay</span><span className="font-medium">{delay}ms</span>
                </div>
                {siteHealth && (
                  <div className="px-4 py-3 flex items-center gap-3">
                    <span className={cn(
                      "text-sm font-medium",
                      siteHealth.healthScore >= 80 ? "text-emerald-500" : siteHealth.healthScore >= 50 ? "text-amber-500" : "text-rose-500"
                    )}>
                      Site Health: {siteHealth.healthScore}%
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-[120px]">
                      <div className="h-full rounded-full" style={{
                        width: `${siteHealth.healthScore}%`,
                        background: siteHealth.healthScore >= 80 ? "oklch(0.55 0.18 160)" : siteHealth.healthScore >= 50 ? "oklch(0.6 0.2 80)" : "oklch(0.58 0.24 30)"
                      }} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {siteHealth.totalAds || 0} records collected
                    </span>
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Save className="h-3 w-3" />
                  Estimated duration: {Math.ceil(parseInt(maxAds) / parseInt(concurrency) * parseInt(delay) / 1000 / 60)} minutes
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {selectedPreset === "custom" ? "Custom Configuration" : `${PRESETS.find(p => p.id === selectedPreset)?.label || ""}`}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 4 && (
        <div className="animate-fade-in-up stagger-2">
          <Card>
            <CardContent className="py-12 text-center">
              {running ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-muted-foreground">Launching campaign...</p>
                </div>
              ) : jobId ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="h-14 w-14 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Check className="h-7 w-7 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">Campaign Launched</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Job ID: <span className="font-mono text-foreground">{jobId}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {selectedSite?.name} &middot; {mode} extraction &middot; max {maxAds} records
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button onClick={() => router.push(`/jobs/${jobId}`)}>
                      <Play className="mr-1.5 h-4 w-4" /> Live Monitor
                    </Button>
                    <Button variant="outline" onClick={() => {
                      setStep(0); setJobId(null); setSite(""); setKeywords(""); setUrl(""); setCategory("")
                    }}>
                      New Campaign
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex justify-between animate-fade-in-up">
        <Button
          variant="outline"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0 || step === 4}
          className="gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="flex gap-2">
          {step < 3 && (
            <Button onClick={() => setStep(step + 1)} disabled={!canNext()} className="gap-1.5">
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          )}
          {step === 3 && (
            <Button onClick={handleLaunch} disabled={running} className="gap-1.5">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Launch Campaign
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
