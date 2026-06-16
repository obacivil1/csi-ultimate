"use client"

import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

interface TrendBadgeProps {
  value: number
  suffix?: string
  className?: string
  inverse?: boolean
}

export function TrendBadge({ value, suffix = "%", className, inverse }: TrendBadgeProps) {
  if (value === 0) {
    return (
      <span className={cn("inline-flex items-center gap-0.5 text-[10px] text-muted-foreground", className)}>
        <Minus className="h-2.5 w-2.5" /> 0{suffix}
      </span>
    )
  }

  const isPositive = inverse ? value < 0 : value > 0
  const absValue = Math.abs(value)

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[10px] font-medium",
        isPositive ? "text-emerald-500" : "text-rose-500",
        className,
      )}
    >
      {isPositive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {absValue}{suffix}
    </span>
  )
}
