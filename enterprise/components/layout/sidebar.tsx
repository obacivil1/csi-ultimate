"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Play,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  Globe,
  Download,
  Calendar,
  Settings,
  ChevronLeft,
  ChevronRight,
  Command,
  BarChart3,
  Rocket,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConnectionStatus } from "@/components/connection-status"
import { useState, useEffect } from "react"

const primaryNav = [
  { href: "/campaigns", label: "Campaigns", icon: Rocket },
  { href: "/", label: "Executive Dashboard", icon: LayoutDashboard },
  { href: "/competitive-intelligence", label: "Competitive Intel", icon: BarChart3 },
  { href: "/crawl-studio", label: "Crawl Studio", icon: Play },
  { href: "/operations", label: "Live Operations", icon: Radio },
  { href: "/results", label: "Results Explorer", icon: Search },
  { href: "/data-quality", label: "Data Quality Lab", icon: ShieldCheck },
  { href: "/ai-copilot", label: "AI Copilot", icon: Sparkles },
]

const systemNav = [
  { href: "/sites", label: "Sites", icon: Globe },
  { href: "/exports", label: "Exports", icon: Download },
  { href: "/scheduler", label: "Scheduler", icon: Calendar },
  { href: "/admin", label: "Admin", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const active = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname.startsWith(href)
  }

  const NavItem = ({ href, label, icon: Icon }: { href: string; label: string; icon: React.ElementType }) => {
    const isActive = active(href)
    return (
      <Link
        href={href}
        className={cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
          isActive
            ? "bg-primary/10 text-foreground shadow-sm"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
          collapsed && "justify-center px-2"
        )}
        title={collapsed ? label : undefined}
      >
        <Icon className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
        )} />
        {!collapsed && <span>{label}</span>}
        {isActive && !collapsed && (
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
        )}
      </Link>
    )
  }

  return (
    <aside
      className={cn(
        "flex flex-col border-r transition-all duration-300 relative z-50",
        "bg-[var(--sidebar)]",
        collapsed ? "w-[64px]" : "w-[240px]"
      )}
    >
      {/* Brand header */}
      <div className={cn(
        "flex h-14 items-center border-b",
        collapsed ? "justify-center px-2" : "gap-3 px-4"
      )}>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        {!collapsed && (
          <div className="flex items-center gap-1">
            <span className="font-bold text-sm tracking-tight text-foreground">CSI</span>
            <span className="text-xs text-muted-foreground font-normal">Ultimate</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 w-6 text-muted-foreground hover:text-foreground",
            collapsed ? "ml-0" : "ml-auto"
          )}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Primary navigation */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-0.5">
        <div className={cn(
          "text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 pb-1 pt-2",
          collapsed && "text-center px-0"
        )}>
          {collapsed ? "..." : "Modules"}
        </div>
        {primaryNav.map(item => (
          <NavItem key={item.href} {...item} />
        ))}

        <div className={cn(
          "text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 pb-1 pt-4",
          collapsed && "text-center px-0"
        )}>
          {collapsed ? "..." : "System"}
        </div>
        {systemNav.map(item => (
          <NavItem key={item.href} {...item} />
        ))}
      </div>

      {/* Footer */}
      <div className="border-t p-3 space-y-2">
        <ConnectionStatus />
        {!collapsed && (
          <div className="flex items-center justify-center gap-1 text-[9px] text-muted-foreground">
            <Command className="h-2.5 w-2.5" />
            <span>K to search</span>
          </div>
        )}
      </div>
    </aside>
  )
}
