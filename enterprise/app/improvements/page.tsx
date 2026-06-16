"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Lightbulb, AlertTriangle, CheckCircle2, ArrowRight, ThumbsUp, RefreshCw, Wrench } from "lucide-react"
import Link from "next/link"
import { safeFetch } from "@/lib/utils"
import { EngineOffline } from "@/components/engine-offline"
import { Skeleton } from "@/components/ui/skeleton"

export default function SelfImprovementCenter() {
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)

  useEffect(() => {
    safeFetch("/api/reports").then(d => {
      setReports(d)
      setEngineOnline(d.length > 0)
      setLoading(false)
    })
  }, [])

  const allIssues = reports.flatMap(r => (r.issues || []).map((i: string) => ({ site: r.site, issue: i, date: r.generatedAt, id: r.reportId })))
  const allSuggestions = reports.flatMap(r => (r.configSuggestions || []).map((s: string) => ({ site: r.site, suggestion: s, date: r.generatedAt, id: r.reportId })))

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Self Improvement Center</h1>
        <p className="text-sm text-muted-foreground">Automatically detected issues and suggested fixes</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-64" />
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : reports.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground"><Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-30" /><p>Run a crawl to generate self-improvement data.</p></CardContent></Card>
      ) : (
        <Tabs defaultValue="issues">
          <TabsList>
            <TabsTrigger value="issues" className="gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Issues {allIssues.length > 0 && `(${allIssues.length})`}
            </TabsTrigger>
            <TabsTrigger value="suggestions" className="gap-1.5">
              <Lightbulb className="h-3.5 w-3.5" /> Suggestions {allSuggestions.length > 0 && `(${allSuggestions.length})`}
            </TabsTrigger>
            <TabsTrigger value="fixes" className="gap-1.5">
              <Wrench className="h-3.5 w-3.5" /> Auto-Fixes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="issues">
            <Card>
              <CardHeader><CardTitle className="text-sm">Detected Quality Issues</CardTitle></CardHeader>
              <CardContent>
                {allIssues.length === 0 ? (
                  <div className="text-muted-foreground text-sm py-8 text-center"><CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" /><p>No issues detected — all systems nominal.</p></div>
                ) : (
                  <div className="space-y-2">
                    {allIssues.map((s, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">{s.issue}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{s.site} · {new Date(s.date).toLocaleDateString()}</div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="outline" size="sm" className="h-7 text-xs"><Wrench className="h-3 w-3 mr-1" /> Fix</Button>
                          <Link href={`/data-quality`}><Button variant="ghost" size="sm" className="h-7 text-xs"><ArrowRight className="h-3 w-3" /></Button></Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="suggestions">
            <Card>
              <CardHeader><CardTitle className="text-sm">Config Improvement Suggestions</CardTitle></CardHeader>
              <CardContent>
                {allSuggestions.length === 0 ? (
                  <div className="text-muted-foreground text-sm py-8 text-center"><CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" /><p>No suggestions — all configurations optimal.</p></div>
                ) : (
                  <div className="space-y-2">
                    {allSuggestions.map((s, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                        <Lightbulb className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">{s.suggestion}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{s.site} · {new Date(s.date).toLocaleDateString()}</div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="outline" size="sm" className="h-7 text-xs"><ThumbsUp className="h-3 w-3 mr-1" /> Apply</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fixes">
            <Card>
              <CardHeader><CardTitle className="text-sm">Auto-Fixes Applied</CardTitle></CardHeader>
              <CardContent>
                <div className="text-muted-foreground text-sm py-8 text-center">
                  <Wrench className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>Auto-fix system ready. Issues detected above can be fixed automatically.</p>
                  <Button variant="outline" className="mt-4" disabled={allIssues.length === 0}>
                    <RefreshCw className="mr-1.5 h-4 w-4" /> Apply All Fixes ({allIssues.length})
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
