"use client"

import { useState, useEffect, useRef } from "react"
import { Search, Command, Bell, User, Sparkles, Grid3X3, Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { NotificationCenter, useNotifications } from "@/components/notification-center"
import { ThemeToggle } from "@/components/theme-toggle"
import { useWorkspace } from "@/lib/workspace-context"

interface TopBarProps {
  onCommandPaletteOpen: () => void
}

export function TopBar({ onCommandPaletteOpen }: TopBarProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [showNotifications, setShowNotifications] = useState(false)
  const [showWorkspaces, setShowWorkspaces] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const { unreadCount } = useNotifications()
  const { workspaces, currentWorkspace, setCurrentWorkspace } = useWorkspace()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        onCommandPaletteOpen()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => inputRef.current?.focus(), 50)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onCommandPaletteOpen])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (workspaceRef.current && !workspaceRef.current.contains(e.target as Node)) {
        setShowWorkspaces(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const quickPages: { href: string; label: string; keywords?: string }[] = [
    { href: "/", label: "Executive Dashboard", keywords: "dashboard home" },
    { href: "/competitive-intelligence", label: "Competitive Intel", keywords: "compare benchmark" },
    { href: "/crawl-studio", label: "Crawl Studio", keywords: "crawl scrape extract" },
    { href: "/operations", label: "Live Operations", keywords: "ops realtime live" },
    { href: "/results", label: "Results Explorer", keywords: "data results export" },
    { href: "/ai-copilot", label: "AI Insights Engine", keywords: "ai insights analysis anomalies" },
    { href: "/data-quality", label: "Data Quality Lab", keywords: "quality dq audit" },
    { href: "/sites", label: "Sites Management", keywords: "sources sites" },
    { href: "/exports", label: "Export & Reports", keywords: "export download pdf report" },
    { href: "/scheduler", label: "Scheduler", keywords: "schedule cron" },
    { href: "/settings", label: "Settings", keywords: "config preferences" },
  ]

  const filtered = searchQuery
    ? quickPages.filter(p =>
        p.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.keywords?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : quickPages

  return (
    <header className="relative flex h-14 items-center gap-3 border-b bg-background px-4 z-40">
      <Link href="/" className="flex items-center gap-2 lg:hidden">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </div>
      </Link>

      {/* Workspace Switcher */}
      <div className="relative" ref={workspaceRef}>
        <button
          onClick={() => setShowWorkspaces(!showWorkspaces)}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
        >
          <Grid3X3 className="h-3.5 w-3.5 text-primary" />
          <span className="hidden sm:inline max-w-[120px] truncate">{currentWorkspace?.name || "No workspace"}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>

        {showWorkspaces && (
          <div className="absolute top-full left-0 mt-1 w-64 rounded-lg border border-border bg-popover shadow-xl overflow-hidden animate-scale-in">
            <div className="p-1.5">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Workspaces</div>
              {workspaces.map(w => (
                <button
                  key={w.id}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    currentWorkspace?.id === w.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent"
                  )}
                  onClick={() => { setCurrentWorkspace(w.id); setShowWorkspaces(false) }}
                >
                  <div className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    currentWorkspace?.id === w.id ? "bg-primary" : "bg-muted-foreground/30"
                  )} />
                  <div className="flex-1 text-left min-w-0">
                    <div className="font-medium text-xs truncate">{w.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{w.client} · {w.sites.length} sources</div>
                  </div>
                  {currentWorkspace?.id === w.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Search bar */}
      <div className="relative flex-1 max-w-md">
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border bg-accent/50 px-3 py-1.5 text-sm transition-all cursor-pointer",
            searchOpen ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-muted-foreground/30"
          )}
          onClick={() => setSearchOpen(true)}
        >
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          {searchOpen ? (
            <input
              ref={inputRef}
              type="text"
              placeholder="Search pages, sources, reports..."
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground/50"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onBlur={() => { if (!searchQuery) setSearchOpen(false) }}
            />
          ) : (
            <>
              <span className="flex-1 text-muted-foreground/70 text-xs">Search pages, sources...</span>
              <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
                <Command className="h-2.5 w-2.5" />F
              </kbd>
            </>
          )}
        </div>

        {searchOpen && searchQuery && (
          <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-border bg-popover shadow-xl overflow-hidden animate-scale-in">
            <div className="p-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">No results</div>
              ) : (
                filtered.map(p => (
                  <Link key={p.href} href={p.href}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                    onClick={() => { setSearchOpen(false); setSearchQuery("") }}>
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    {p.label}
                  </Link>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onCommandPaletteOpen}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
          title="Command Palette (Ctrl+K)"
        >
          <Command className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">K</span>
        </button>

        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent transition-colors"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] flex items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground px-1">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          <NotificationCenter open={showNotifications} onClose={() => setShowNotifications(false)} />
        </div>

        <ThemeToggle />

        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary cursor-pointer hover:bg-primary/20 transition-colors">
          <User className="h-4 w-4" />
        </div>
      </div>
    </header>
  )
}
