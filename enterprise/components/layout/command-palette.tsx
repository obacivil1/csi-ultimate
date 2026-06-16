"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { cn, safeFetch } from "@/lib/utils"
import {
  LayoutDashboard, Play, Radio, Search, ShieldCheck, Sparkles,
  Globe, Download, Calendar, Settings, BarChart3,
  Command, ArrowRight, ExternalLink, Clock, AlertTriangle,
  TrendingUp, FileText,
} from "lucide-react"

interface CommandItem {
  id: string
  label: string
  description?: string
  href: string
  icon: any
  category: string
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentItems, setRecentItems] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("csi-recent-commands")
      if (stored && stored.startsWith("[")) try { return JSON.parse(stored) } catch {}
    }
    return []
  })
  const [sites, setSites] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    safeFetch("/api/sites").then(setSites).catch(() => {})
    safeFetch("/api/reports").then(setReports).catch(() => {})
  }, [open])

  const addRecent = (id: string) => {
    const updated = [id, ...recentItems.filter(r => r !== id)].slice(0, 10)
    setRecentItems(updated)
    localStorage.setItem("csi-recent-commands", JSON.stringify(updated))
  }

  const staticCommands: CommandItem[] = [
    { id: "dash", label: "Executive Dashboard", description: "Enterprise overview and KPIs", href: "/", icon: LayoutDashboard, category: "Pages" },
    { id: "comp", label: "Competitive Intelligence", description: "Compare, benchmark, rank sources", href: "/competitive-intelligence", icon: BarChart3, category: "Pages" },
    { id: "crawl", label: "Crawl Studio", description: "Configure and launch campaigns", href: "/crawl-studio", icon: Play, category: "Pages" },
    { id: "ops", label: "Live Operations", description: "Real-time campaign monitoring", href: "/operations", icon: Radio, category: "Pages" },
    { id: "results", label: "Results Intelligence Hub", description: "Browse, compare, export data", href: "/results", icon: Search, category: "Pages" },
    { id: "dq", label: "Data Quality Lab", description: "Quality analysis and field coverage", href: "/data-quality", icon: ShieldCheck, category: "Pages" },
    { id: "ai", label: "AI Insights Engine", description: "Anomalies, trends, health recommendations", href: "/ai-copilot", icon: Sparkles, category: "Pages" },
    { id: "sites", label: "Sites Management", description: "Manage intelligence sources", href: "/sites", icon: Globe, category: "System" },
    { id: "exports", label: "Export & Reporting Center", description: "PDF reports, Excel, schedules", href: "/exports", icon: Download, category: "System" },
    { id: "sched", label: "Scheduler", description: "Recurring intelligence campaigns", href: "/scheduler", icon: Calendar, category: "System" },
    { id: "settings", label: "Settings", description: "Platform configuration", href: "/settings", icon: Settings, category: "System" },
    { id: "new-crawl", label: "Launch New Crawl", description: "Start an intelligence campaign", href: "/crawl-studio", icon: Play, category: "Actions" },
    { id: "view-comp", label: "Compare Sources", description: "Open competitive intelligence", href: "/competitive-intelligence", icon: BarChart3, category: "Actions" },
    { id: "view-results", label: "View Latest Results", description: "Check recent extraction data", href: "/results", icon: Search, category: "Actions" },
    { id: "gen-report", label: "Generate PDF Report", description: "Create executive report", href: "/exports", icon: FileText, category: "Actions" },
  ]

  const siteCommands: CommandItem[] = sites.map(s => ({
    id: `site-${s.hostname}`,
    label: s.name || s.hostname,
    description: `${s.hostname} · Intelligence source`,
    href: `/crawl-studio?site=${s.hostname}`,
    icon: Globe,
    category: "Sources",
  }))

  const reportCommands: CommandItem[] = reports.slice(0, 8).map(r => ({
    id: `report-${r.reportId}`,
    label: `${r.site} Report`,
    description: `${r.totalAds || 0} records · DQ: ${r.metrics?.dataQualityScore || 0}%`,
    href: `/results`,
    icon: FileText,
    category: "Reports",
  }))

  const recentCommands = recentItems
    .map(id => [...staticCommands, ...siteCommands, ...reportCommands].find(c => c.id === id))
    .filter(Boolean) as CommandItem[]

  const allCommands = [...staticCommands, ...siteCommands, ...reportCommands]

  const filtered = query
    ? allCommands.filter(c =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.description?.toLowerCase().includes(query.toLowerCase())
      )
    : recentCommands.length > 0
      ? recentCommands
      : allCommands

  const categories = [...new Set(filtered.map(c => c.category))]

  const navigate = useCallback((item: CommandItem) => {
    addRecent(item.id)
    onClose()
    router.push(item.href)
  }, [router, onClose])

  useEffect(() => {
    if (!open) return
    setQuery("") // eslint-disable-line react-hooks/set-state-in-effect
    setSelectedIndex(0)  
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    setSelectedIndex(0) // eslint-disable-line react-hooks/set-state-in-effect
  }, [query])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)); return }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === "Enter" && filtered[selectedIndex]) {
        e.preventDefault()
        navigate(filtered[selectedIndex])
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, filtered, selectedIndex, navigate, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-popover shadow-2xl overflow-hidden animate-scale-in">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Command className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages, sources, reports, actions..."
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground/40"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <kbd className="text-[10px] text-muted-foreground font-mono border border-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            categories.map(cat => (
              <div key={cat}>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <span>{cat}</span>
                  <span className="text-[9px] text-muted-foreground/40">
                    ({filtered.filter(c => c.category === cat).length})
                  </span>
                </div>
                {filtered.filter(c => c.category === cat).map(cmd => {
                  const globalIndex = filtered.indexOf(cmd)
                  const isRecent = recentItems.includes(cmd.id) && !query
                  return (
                    <button
                      key={cmd.id}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-left transition-colors",
                        globalIndex === selectedIndex
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-accent"
                      )}
                      onClick={() => navigate(cmd)}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                    >
                      <cmd.icon className={cn(
                        "h-4 w-4 shrink-0",
                        globalIndex === selectedIndex ? "text-primary" : "text-muted-foreground"
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate flex items-center gap-2">
                          {cmd.label}
                          {isRecent && <Clock className="h-2.5 w-2.5 text-muted-foreground/40" />}
                        </div>
                        {cmd.description && (
                          <div className="text-xs text-muted-foreground truncate">{cmd.description}</div>
                        )}
                      </div>
                      <ArrowRight className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        globalIndex === selectedIndex ? "text-primary opacity-100" : "opacity-0"
                      )} />
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><kbd className="border border-border rounded px-1">↑↓</kbd> Navigate</span>
          <span className="flex items-center gap-1"><kbd className="border border-border rounded px-1">Enter</kbd> Open</span>
          <span className="flex items-center gap-1"><kbd className="border border-border rounded px-1">Esc</kbd> Close</span>
          {filtered.length > 0 && <span className="ml-auto">{filtered.length} results</span>}
        </div>
      </div>
    </div>
  )
}
