"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { cn, safeFetch } from "@/lib/utils"
import { Calendar, Clock, Plus, Play, Trash2, RefreshCw, Timer, Sparkles, Loader2 } from "lucide-react"
import { EmptyState } from "@/components/empty-states"
import { Skeleton } from "@/components/ui/skeleton"
import { EngineOffline } from "@/components/engine-offline"

interface Schedule {
  id: string
  site: string
  keywords: string
  interval: string
  maxAds: number
  active: boolean
  lastRun: string | null
  nextRun: string
  runCount: number
}

const INTERVALS = [
  { value: "hourly", label: "Every Hour", icon: Timer },
  { value: "every6", label: "Every 6 Hours", icon: Clock },
  { value: "daily", label: "Daily", icon: Calendar },
  { value: "weekly", label: "Weekly", icon: Calendar },
  { value: "monthly", label: "Monthly", icon: Calendar },
]

export default function Scheduler() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [engineOnline, setEngineOnline] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newSite, setNewSite] = useState("")
  const [newKeywords, setNewKeywords] = useState("")
  const [newInterval, setNewInterval] = useState("daily")
  const [newMaxAds, setNewMaxAds] = useState(50)

  const loadSchedules = () => {
    safeFetch("/api/schedules").then(data => {
      setSchedules(data)
      setEngineOnline(true)
      setLoading(false)
    }).catch(() => { setEngineOnline(false); setLoading(false) })
  }

  useEffect(() => { loadSchedules() }, [])

  const toggleActive = async (id: string) => {
    await fetch(`/api/schedules/${id}/toggle`, { method: "PUT" }).catch(() => {})
    loadSchedules()
  }

  const deleteSchedule = async (id: string) => {
    await fetch(`/api/schedules/${id}`, { method: "DELETE" }).catch(() => {})
    loadSchedules()
  }

  const createSchedule = async () => {
    if (!newSite || !newKeywords.trim()) return
    setSaving(true)
    await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: newSite, keywords: newKeywords.trim(), interval: newInterval, maxAds: newMaxAds }),
    }).catch(() => {})
    setNewSite(""); setNewKeywords(""); setNewInterval("daily"); setNewMaxAds(50)
    setSaving(false)
    loadSchedules()
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="gradient-text">Scheduler</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Schedule recurring intelligence campaigns</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-64" />
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !engineOnline ? (
        <EngineOffline />
      ) : schedules.length === 0 ? (
        <Card className="glass-card"><CardContent>
          <EmptyState
            variant="general"
            title="No schedules configured"
            description="Create your first automated campaign to run on a recurring basis."
            className="py-10"
          />
        </CardContent></Card>
      ) : (
        <div className="space-y-3 animate-fade-in-up stagger-1">
          {schedules.map((s, i) => (
            <Card key={s.id} className={cn("glass-card animate-fade-in-up", `stagger-${i + 1}`)}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Switch checked={s.active} onCheckedChange={() => toggleActive(s.id)} />
                    <div>
                      <div className="font-medium text-sm">{s.site}</div>
                      <div className="text-xs text-muted-foreground">{s.keywords}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right text-xs">
                      <div className="flex items-center gap-1 justify-end text-muted-foreground">
                        <RefreshCw className="h-3 w-3" />
                        <span className="capitalize">{s.interval}</span>
                      </div>
                      <div className="text-muted-foreground">{s.maxAds} records</div>
                    </div>
                    <Badge variant={s.active ? "success" : "secondary"}>{s.active ? "Active" : "Paused"}</Badge>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500" onClick={() => deleteSchedule(s.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5"><Play className="h-3 w-3" /> Last run: {s.lastRun || "Never"}</div>
                  <div className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Next: {s.nextRun}</div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
                  <RefreshCw className="h-3 w-3" /> Run #{s.runCount} total
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="glass-card animate-fade-in-up stagger-3">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Create Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-2">
              <Label>Intelligence Source</Label>
              <Select value={newSite} onValueChange={setNewSite}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gumtree">Gumtree</SelectItem>
                  <SelectItem value="preloved">Preloved</SelectItem>
                  <SelectItem value="olx">OLX</SelectItem>
                  <SelectItem value="craigslist">Craigslist</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Keywords</Label>
              <Input placeholder="sofa, iphone" value={newKeywords} onChange={e => setNewKeywords(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select value={newInterval} onValueChange={setNewInterval}>
                <SelectTrigger><SelectValue placeholder="Frequency" /></SelectTrigger>
                <SelectContent>
                  {INTERVALS.map(i => (
                    <SelectItem key={i.value} value={i.value}>
                      <span className="flex items-center gap-2"><i.icon className="h-3.5 w-3.5" />{i.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Max Records</Label>
              <Input type="number" value={newMaxAds} onChange={e => setNewMaxAds(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>&nbsp;</Label>
              <Button className="w-full gap-1.5" onClick={createSchedule} disabled={!newSite || !newKeywords.trim() || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
