"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { X, CheckCircle2, AlertTriangle, Play, Radio } from "lucide-react"
import { cn } from "@/lib/utils"
import { EmptyState } from "./empty-states"
import Link from "next/link"

interface Notification {
  id: string
  type: "crawl_started" | "crawl_completed" | "crawl_cancelled" | "issue_detected" | "quality_alert"
  site: string
  message: string
  timestamp: string
  jobId?: string
}

const NOTIFICATION_ICONS = {
  crawl_started: { icon: Play, color: "text-blue-500", bg: "bg-blue-500/10" },
  crawl_completed: { icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  crawl_cancelled: { icon: X, color: "text-amber-500", bg: "bg-amber-500/10" },
  issue_detected: { icon: AlertTriangle, color: "text-rose-500", bg: "bg-rose-500/10" },
  quality_alert: { icon: Radio, color: "text-violet-500", bg: "bg-violet-500/10" },
}

interface NotificationCenterProps {
  open: boolean
  onClose: () => void
}

export function NotificationCenter({ open, onClose }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource("/api/events")
    esRef.current = es

    es.addEventListener("notification", (e) => {
      try {
        const notif: Notification = JSON.parse(e.data)
        setNotifications((prev) => [notif, ...prev].slice(0, 50))
        setUnreadCount((c) => c + 1)
      } catch { }
    })

    es.onerror = () => { }

    return () => es.close()
  }, [])

  const markAllRead = useCallback(() => {
    setUnreadCount(0)
  }, [])

  if (!open) return null

  return (
    <div className="absolute top-full right-0 mt-1 w-80 rounded-lg border border-border bg-popover shadow-xl overflow-hidden animate-scale-in z-50">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Notifications</span>
          {unreadCount > 0 && (
            <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
              {unreadCount} new
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
            Mark all read
          </button>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto">
        {notifications.length === 0 ? (
          <EmptyState
            variant="notifications"
            title="No notifications yet"
            description="Notifications about crawls, issues, and quality alerts will appear here in real time."
            className="py-8"
          />
        ) : (
          <div className="divide-y divide-border/30">
            {notifications.map((n) => {
              const meta = NOTIFICATION_ICONS[n.type] || NOTIFICATION_ICONS.crawl_completed
              const Icon = meta.icon
              return (
                <Link
                  key={n.id}
                  href={n.jobId ? `/jobs/${n.jobId}` : "#"}
                  className="flex items-start gap-3 p-3 hover:bg-accent/50 transition-colors"
                  onClick={onClose}
                >
                  <div className={cn("p-1.5 rounded-full shrink-0", meta.bg)}>
                    <Icon className={cn("h-3.5 w-3.5", meta.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{n.site}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    <span className="text-[9px] text-muted-foreground/60 mt-0.5 block">
                      {new Date(n.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export function useNotifications() {
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    const es = new EventSource("/api/events")
    es.addEventListener("notification", () => {
      setUnreadCount((c) => c + 1)
    })
    es.onerror = () => { }
    return () => es.close()
  }, [])

  return { unreadCount, markAllRead: () => setUnreadCount(0) }
}
