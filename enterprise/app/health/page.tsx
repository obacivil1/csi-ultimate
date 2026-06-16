"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { HeartPulse, Globe, Database } from "lucide-react"
import { cn, safeFetch } from "@/lib/utils"
import { EngineOffline } from "@/components/engine-offline"
import { Skeleton } from "@/components/ui/skeleton"

export default function SystemHealth() {
  const [healthScores, setHealthScores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)

  useEffect(() => {
    safeFetch("/api/health").then(d => {
      setHealthScores(d)
      setEngineOnline(d.length > 0)
      setLoading(false)
    })
  }, [])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">System Health</h1>
        <p className="text-sm text-muted-foreground">Real-time system diagnostics and resource monitoring</p>
      </div>

      {loading ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : healthScores.length > 0 && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><HeartPulse className="h-4 w-4 text-primary" /> Site Health Scores</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {healthScores.map(s => (
                  <div key={s.site} className="flex items-center gap-3">
                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{s.site}</div>
                      <div className="text-[11px] text-muted-foreground">{s.totalAds} ads · {s.issues} issues</div>
                    </div>
                    <div className="h-2 w-24 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${s.healthScore}%`, background: s.healthScore >= 80 ? "#22c55e" : s.healthScore >= 50 ? "#eab308" : "#ef4444" }} />
                    </div>
                    <span className={cn("text-sm font-mono w-12 text-right", s.healthScore >= 80 ? "text-emerald-500" : s.healthScore >= 50 ? "text-amber-500" : "text-rose-500")}>
                      {s.healthScore}%
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Data Quality Scores</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {healthScores.map(s => (
                  <div key={s.site} className="flex items-center gap-3">
                    <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{s.site}</div>
                    </div>
                    <div className="h-2 w-24 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${s.dataQualityScore}%`, background: s.dataQualityScore >= 80 ? "#22c55e" : s.dataQualityScore >= 50 ? "#eab308" : "#ef4444" }} />
                    </div>
                    <span className={cn("text-sm font-mono w-12 text-right", s.dataQualityScore >= 80 ? "text-emerald-500" : s.dataQualityScore >= 50 ? "text-amber-500" : "text-rose-500")}>
                      {s.dataQualityScore}%
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}


