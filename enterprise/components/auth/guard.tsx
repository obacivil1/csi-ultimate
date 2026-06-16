"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"

export function AuthGuard({ children, requiredRole }: { children: React.ReactNode; requiredRole?: string }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login")
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-sm text-muted-foreground animate-pulse">Loading...</div>
      </div>
    )
  }

  if (!user) return null

  if (requiredRole) {
    const roleHierarchy: Record<string, number> = { viewer: 0, analyst: 1, admin: 2, owner: 3 }
    if ((roleHierarchy[user.role] || 0) < (roleHierarchy[requiredRole] || 0)) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-sm text-rose-600">You do not have permission to access this page.</div>
        </div>
      )
    }
  }

  return <>{children}</>
}
