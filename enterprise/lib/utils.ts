import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date))
}

export function duration(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export const ENGINE_URL = `http://localhost:${process.env.NEXT_PUBLIC_CSI_PORT || process.env.CSI_PORT || 3030}`

export async function safeFetch<T = any>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export async function safeFetchOne<T = any>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    return (data && typeof data === "object" && !Array.isArray(data) && !data.error) ? data : null
  } catch {
    return null
  }
}
