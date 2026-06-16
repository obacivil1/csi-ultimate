"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  BarChart3,
  Globe,
  ShieldCheck,
  Download,
  Calendar,
  Lightbulb,
  HeartPulse,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Radio,
  Play,
  ScanSearch,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConnectionStatus } from "@/components/connection-status"
import { useState } from "react"

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/operations", label: "Live Operations", icon: Radio },
  { href: "/crawl-studio", label: "Crawls", icon: Play },
  { href: "/results", label: "Results", icon: ScanSearch },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/sites", label: "Sites", icon: Globe },
  { href: "/data-quality", label: "Data Quality", icon: ShieldCheck },
  { href: "/exports", label: "Exports", icon: Download },
  { href: "/scheduler", label: "Scheduler", icon: Calendar },
  { href: "/ai-insights", label: "AI Insights", icon: Lightbulb },
  { href: "/health", label: "System Health", icon: HeartPulse },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function AppSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const active = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname.startsWith(href)
  }

  return (
    <aside
      className={cn(
        "flex flex-col border-r transition-all duration-300 relative z-50",
        "bg-[var(--sidebar)] text-[var(--sidebar-foreground)]",
        collapsed ? "w-[64px]" : "w-[240px]"
      )}
    >
      <div className={cn(
        "flex h-14 items-center border-b border-white/5",
        collapsed ? "justify-center px-2" : "gap-2 px-4"
      )}>
        <div className={cn(
          "flex items-center justify-center rounded-lg bg-primary/10",
          collapsed ? "h-8 w-8" : "h-8 w-8"
        )}>
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        {!collapsed && (
          <span className="font-bold text-sm tracking-tight">
            <span className="gradient-text">CSI</span>
            <span className="text-foreground/60 ml-1 font-normal">Ultimate</span>
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 w-6 text-[var(--sidebar-muted)] hover:text-[var(--sidebar-foreground)]",
            collapsed ? "ml-0" : "ml-auto"
          )}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-0.5">
        <div className={cn(
          "text-[10px] font-semibold uppercase tracking-widest text-[var(--sidebar-muted)] px-3 pb-1",
          collapsed && "text-center px-0"
        )}>
          {collapsed ? "..." : "Navigation"}
        </div>
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = active(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-foreground)]"
                  : "text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]",
                collapsed && "justify-center px-2"
              )}
              title={collapsed ? label : undefined}
            >
              <Icon className={cn(
                "h-4 w-4 shrink-0",
                isActive && "text-primary"
              )} />
              {!collapsed && <span>{label}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-white/5 p-3 space-y-2">
        <ConnectionStatus />
        {!collapsed && (
          <p className="text-[9px] text-center text-[var(--sidebar-muted)]">
            Enterprise Intelligence v2.0
          </p>
        )}
      </div>
    </aside>
  )
}
