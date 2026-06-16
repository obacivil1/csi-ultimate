"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Globe, ExternalLink, RefreshCw, BarChart3 } from "lucide-react"
import Link from "next/link"
import { cn, safeFetch } from "@/lib/utils"
import { EngineOffline } from "@/components/engine-offline"
import { Skeleton } from "@/components/ui/skeleton"

const SITE_TIERS: Record<string, { tier: string; label: string; color: string }> = {
  "gumtree.com": { tier: "A", label: "High Performance", color: "text-emerald-500" },
  "preloved.co.uk": { tier: "A", label: "High Performance", color: "text-emerald-500" },
  "olx.com.pk": { tier: "A", label: "High Performance", color: "text-emerald-500" },
  "london.craigslist.org": { tier: "B", label: "Moderate", color: "text-amber-500" },
  "expatriates.com": { tier: "B", label: "Moderate", color: "text-amber-500" },
  "bayt.com": { tier: "C", label: "Cloudflare Blocked", color: "text-rose-500" },
  "sa.opensooq.com": { tier: "D", label: "Structure Changed", color: "text-rose-500" },
}

export default function SitesManagement() {
  const [sites, setSites] = useState<any[]>([])
  const [healthScores, setHealthScores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)

  useEffect(() => {
    Promise.all([
      safeFetch("/api/sites"),
      safeFetch("/api/health"),
    ]).then(([s, h]) => {
      setSites(s)
      setHealthScores(h)
      setEngineOnline(s.length > 0)
      setLoading(false)
    })
  }, [])

  const getHealth = (hostname: string) => healthScores.find((h: any) => h.site === hostname)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="gradient-text">Intelligence Sources</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage all configured extraction targets</p>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 animate-fade-in-up stagger-1">
          {sites.map((site, i) => {
            const tierInfo = SITE_TIERS[site.hostname] || { tier: "?", label: "Unknown", color: "text-muted-foreground" }
            const health = getHealth(site.hostname)
            const status = health ? "active" : "pending"
            return (
              <Card key={site.hostname} className={cn("glass-card animate-fade-in-up", `stagger-${i + 1}`)}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="h-5 w-5 text-primary shrink-0" />
                      <div className="min-w-0">
                        <CardTitle className="text-sm truncate">{site.name}</CardTitle>
                        <p className="text-xs text-muted-foreground truncate">{site.hostname}</p>
                      </div>
                    </div>
                    <Badge variant={status === "active" ? "success" : "outline"} className="text-[10px] shrink-0">
                      {status === "active" ? "Active" : "Pending"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Health bar */}
                  {health && (
                    <div className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Health</span>
                        <span className={cn(
                          "font-semibold",
                          health.healthScore >= 80 ? "text-emerald-500" : health.healthScore >= 50 ? "text-amber-500" : "text-rose-500"
                        )}>
                          {health.healthScore}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${health.healthScore}%`,
                          background: health.healthScore >= 80 ? "oklch(0.55 0.18 160)" : health.healthScore >= 50 ? "oklch(0.6 0.2 80)" : "oklch(0.58 0.24 30)"
                        }} />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tier</span>
                      <span className={cn("font-medium", tierInfo.color)}>{tierInfo.tier} — {tierInfo.label}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Selectors</span>
                      <span>{site.extractionSelectors?.length || 0} configured</span>
                    </div>
                    {health && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Records</span>
                        <span>{health.totalAds || 0}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Endpoint</span>
                      <span className="font-mono">{site.searchEndpoint?.slice(0, 24)}...</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Language</span>
                      <span>{site.language === "ar" ? "Arabic" : "English"}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Link href={`/crawl-studio?site=${site.hostname}`} className="flex-[2]">
                      <Button size="sm" className="w-full h-8 text-xs gap-1">
                        <ExternalLink className="h-3.5 w-3.5" /> Extract
                      </Button>
                    </Link>
                    <Link href="/competitive-intelligence" className="flex-1">
                      <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1">
                        <BarChart3 className="h-3.5 w-3.5" /> Compare
                      </Button>
                    </Link>
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
