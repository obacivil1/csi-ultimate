"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Play, Square, Search, Eye } from "lucide-react"
import Link from "next/link"
import { EngineOffline } from "@/components/engine-offline"
import { EmptyState } from "@/components/empty-states"

interface JobInfo {
  id: string
  status: string
  progress: number
  adsScraped: number
  adsFailed: number
  linksFound: number
  retries: number
  startTime: string | null
  endTime: string | null
  error?: string
}

export default function ActiveJobs() {
  const [jobs, setJobs] = useState<Map<string, JobInfo>>(new Map())
  const [jobIdInput, setJobIdInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)

  const addJob = (id: string) => {
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`/api/crawl/${id}`)
        const j = await r.json()
        if (j && !j.error && j.status) {
          setJobs(prev => new Map(prev).set(id, j))
          if (j.status === "completed" || j.status === "failed") {
            clearInterval(interval)
          }
        }
      } catch { clearInterval(interval) }
    }, 2000)

    fetch(`/api/crawl/${id}`).then(r => r.json()).then(j => {
      if (j && !j.error && j.status) {
        setJobs(prev => new Map(prev).set(id, j))
        if (j.status === "completed" || j.status === "failed") {
          clearInterval(interval)
        }
      }
    })
  }

  useEffect(() => {
    fetch("/api/health").then(r => r.json()).then(d => {
      setEngineOnline(Array.isArray(d) && d.length > 0)
    }).catch(() => setEngineOnline(false)).finally(() => setLoading(false))

    const stored = sessionStorage.getItem("trackedJobs")
    if (stored) {
      try {
        const ids = JSON.parse(stored) as string[]
        ids.forEach(id => addJob(id))
      } catch {}
    }
  }, [])

  const trackJob = () => {
    if (!jobIdInput.trim()) return
    addJob(jobIdInput.trim())
    // persist
    const stored = JSON.parse(sessionStorage.getItem("trackedJobs") || "[]")
    if (!stored.includes(jobIdInput.trim())) {
      stored.push(jobIdInput.trim())
      sessionStorage.setItem("trackedJobs", JSON.stringify(stored))
    }
    setJobIdInput("")
  }

  const untrackJob = (id: string) => {
    setJobs(prev => { const m = new Map(prev); m.delete(id); return m })
    const stored = JSON.parse(sessionStorage.getItem("trackedJobs") || "[]").filter((s: string) => s !== id)
    sessionStorage.setItem("trackedJobs", JSON.stringify(stored))
  }

  const statusColor = (s: string) => {
    switch (s) {
      case "running": return "warning"
      case "completed": return "success"
      case "failed": return "destructive"
      case "queued": return "default"
      default: return "outline" as const
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Active Jobs</h1>
          <p className="text-sm text-muted-foreground">Monitor all running crawl operations</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Job ID..."
            className="w-44 font-mono text-xs"
            value={jobIdInput}
            onChange={e => setJobIdInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && trackJob()}
          />
          <Button onClick={trackJob} disabled={!jobIdInput.trim()}>
            <Search className="mr-1.5 h-4 w-4" /> Track
          </Button>
          <Link href="/crawl-studio">
            <Button variant="outline"><Play className="mr-1.5 h-4 w-4" /> New Crawl</Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : jobs.size === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              variant="general"
              title="No active jobs being tracked"
              description="Enter a Job ID above or launch a new campaign from the studio."
              action={
                <Link href="/crawl-studio">
                  <Button variant="outline" className="gap-1.5"><Play className="h-4 w-4" /> New Campaign</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {Array.from(jobs.entries()).map(([id, job]) => (
            <Card key={id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="text-sm font-mono text-muted-foreground">#{id.slice(-8)}</div>
                    <Badge variant={statusColor(job.status)}>{job.status}</Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Link href={`/jobs/${id}`}>
                      <Button variant="ghost" size="sm"><Eye className="h-3.5 w-3.5 mr-1" /> Monitor</Button>
                    </Link>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500" onClick={() => untrackJob(id)}>
                      <Square className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <Progress value={job.progress || 0} className="h-1.5 mb-3" />
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Progress</span><div className="font-medium">{job.progress || 0}%</div></div>
                  <div><span className="text-muted-foreground">Scraped</span><div className="font-medium text-emerald-500">{job.adsScraped || 0}</div></div>
                  <div><span className="text-muted-foreground">Failed</span><div className="font-medium text-rose-500">{job.adsFailed || 0}</div></div>
                  <div><span className="text-muted-foreground">Links</span><div className="font-medium">{job.linksFound || 0}</div></div>
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground flex gap-4">
                  <span>Start: {job.startTime ? new Date(job.startTime).toLocaleTimeString() : "-"}</span>
                  <span>End: {job.endTime ? new Date(job.endTime).toLocaleTimeString() : "In progress"}</span>
                  <span>Retries: {job.retries || 0}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
