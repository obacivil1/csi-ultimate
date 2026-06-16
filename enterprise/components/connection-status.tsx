"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

type EngineState = "connected" | "connecting" | "degraded" | "offline"

export function ConnectionStatus() {
  const [state, setState] = useState<EngineState>("connecting")

  useEffect(() => {
    let mounted = true
    let consecutiveFailures = 0

    const check = async () => {
      try {
        const res = await fetch("/api/health")
        if (!mounted) return
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data) && data.length > 0) {
            setState("connected")
          } else {
            setState("degraded")
          }
          consecutiveFailures = 0
        } else {
          consecutiveFailures++
          setState(consecutiveFailures >= 3 ? "offline" : "degraded")
        }
      } catch {
        if (!mounted) return
        consecutiveFailures++
        setState(consecutiveFailures >= 3 ? "offline" : "connecting")
      }
    }

    check()
    const interval = setInterval(check, 10000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  const dot = {
    connected: "bg-emerald-500",
    connecting: "bg-amber-500 animate-pulse",
    degraded: "bg-amber-500",
    offline: "bg-rose-500",
  }

  const label = {
    connected: "Engine Connected",
    connecting: "Connecting...",
    degraded: "Engine Degraded",
    offline: "Engine Offline",
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all",
        "text-[var(--sidebar-muted)]"
      )}
      title={label[state]}
    >
      <span className={cn("h-2 w-2 rounded-full shrink-0", dot[state])} />
      <span>{label[state]}</span>
    </div>
  )
}
