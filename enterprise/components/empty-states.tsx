"use client"

import { cn } from "@/lib/utils"

interface EmptyStateProps {
  variant?: "search" | "data" | "sites" | "notifications" | "quality" | "general"
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

function SearchSvg() {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="h-32 w-32" aria-hidden>
      <circle cx="52" cy="48" r="28" stroke="currentColor" strokeWidth="2.5" className="text-muted-foreground/20" />
      <circle cx="52" cy="48" r="16" stroke="currentColor" strokeWidth="2" className="text-primary/30" />
      <line x1="72" y1="68" x2="92" y2="88" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-muted-foreground/20" />
      <rect x="40" y="78" width="40" height="30" rx="4" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/15" />
      <line x1="48" y1="86" x2="72" y2="86" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground/20" />
      <line x1="48" y1="92" x2="66" y2="92" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground/15" />
      <circle cx="52" cy="48" r="4" fill="currentColor" className="text-primary/40" />
    </svg>
  )
}

function DataSvg() {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="h-32 w-32" aria-hidden>
      <rect x="24" y="20" width="72" height="18" rx="4" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/20" />
      <rect x="24" y="44" width="72" height="18" rx="4" stroke="currentColor" strokeWidth="2" className="text-primary/20" />
      <rect x="24" y="68" width="72" height="18" rx="4" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/15" />
      <line x1="36" y1="29" x2="84" y2="29" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground/20" />
      <line x1="36" y1="53" x2="72" y2="53" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-primary/30" />
      <line x1="36" y1="77" x2="60" y2="77" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground/15" />
      <circle cx="90" cy="53" r="12" fill="currentColor" className="text-primary/10" />
      <circle cx="90" cy="53" r="6" fill="currentColor" className="text-primary/30" />
    </svg>
  )
}

function SitesSvg() {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="h-32 w-32" aria-hidden>
      <circle cx="60" cy="60" r="44" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/15" />
      <circle cx="60" cy="60" r="28" stroke="currentColor" strokeWidth="1.5" className="text-primary/20" />
      <ellipse cx="60" cy="60" rx="44" ry="18" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/15" />
      <line x1="16" y1="60" x2="104" y2="60" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/10" />
      <circle cx="60" cy="24" r="5" fill="currentColor" className="text-primary/40" />
      <circle cx="60" cy="96" r="5" fill="currentColor" className="text-primary/20" />
      <circle cx="24" cy="60" r="4" fill="currentColor" className="text-muted-foreground/20" />
      <circle cx="96" cy="60" r="4" fill="currentColor" className="text-muted-foreground/20" />
    </svg>
  )
}

function NotificationsSvg() {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="h-32 w-32" aria-hidden>
      <path d="M36 52a24 24 0 0 1 48 0v16l6 14H30l6-14V52z" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/20" />
      <line x1="52" y1="16" x2="52" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground/20" />
      <line x1="68" y1="16" x2="68" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground/20" />
      <path d="M48 88a12 12 0 0 0 24 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground/20" />
      <circle cx="60" cy="44" r="12" stroke="currentColor" strokeWidth="1.5" className="text-primary/20" />
      <circle cx="60" cy="44" r="5" fill="currentColor" className="text-primary/30" />
      <path d="M40 60l-6 8h52l-6-8" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/15" />
    </svg>
  )
}

function QualitySvg() {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="h-32 w-32" aria-hidden>
      <path d="M60 12l14 28 31 4-23 22 6 30-28-14-28 14 6-30-23-22 31-4L60 12z" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/20" />
      <path d="M60 20l11 22 24 3-18 17 4 23-21-11-21 11 4-23-18-17 24-3L60 20z" stroke="currentColor" strokeWidth="1.5" className="text-primary/20" />
      <path d="M52 58l6 6 12-12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary/40" />
    </svg>
  )
}

function GeneralSvg() {
  return (
    <svg viewBox="0 0 120 120" fill="none" className="h-32 w-32" aria-hidden>
      <circle cx="60" cy="60" r="40" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/15" />
      <circle cx="60" cy="60" r="28" stroke="currentColor" strokeWidth="1.5" className="text-primary/20" strokeDasharray="4 4" />
      <path d="M60 30v-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground/20" />
      <path d="M60 98v-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground/20" />
      <path d="M30 60h-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground/20" />
      <path d="M98 60h-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted-foreground/20" />
      <circle cx="60" cy="60" r="14" fill="currentColor" className="text-primary/10" />
      <circle cx="60" cy="60" r="7" fill="currentColor" className="text-primary/30" />
      <path d="M60 44l4 8 8 1-6 6 2 9-8-4-8 4 2-9-6-6 8-1 4-8z" fill="currentColor" className="text-primary/15" />
    </svg>
  )
}

const VARIANT_MAP = {
  search: SearchSvg,
  data: DataSvg,
  sites: SitesSvg,
  notifications: NotificationsSvg,
  quality: QualitySvg,
  general: GeneralSvg,
}

export function EmptyState({ variant = "general", title, description, action, className }: EmptyStateProps) {
  const SvgComponent = VARIANT_MAP[variant] || GeneralSvg

  return (
    <div className={cn("flex flex-col items-center justify-center py-14 px-6 text-center", className)}>
      <div className="mb-5 text-muted-foreground/40">
        <SvgComponent />
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-5 leading-relaxed">{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  )
}
