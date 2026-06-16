"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import type { AuthState } from "@/lib/saas-types"

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  register: (email: string, password: string, name: string, orgName?: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  checkSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, org: null, token: null, loading: true })

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { credentials: "same-origin" })
      if (!res.ok) {
        setState({ user: null, org: null, token: null, loading: false })
        return
      }
      const data = await res.json()
      setState({ user: data.user, org: data.org, token: null, loading: false })
    } catch {
      setState({ user: null, org: null, token: null, loading: false })
    }
  }, [])

  useEffect(() => { checkSession() }, [checkSession])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) return { ok: false, error: data.error || "Login failed" }
      setState({ user: data.user, org: data.org, token: data.token, loading: false })
      return { ok: true }
    } catch { return { ok: false, error: "Network error" } }
  }, [])

  const register = useCallback(async (email: string, password: string, name: string, orgName?: string) => {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, orgName }),
      })
      const data = await res.json()
      if (!res.ok) return { ok: false, error: data.error || "Registration failed" }
      setState({ user: data.user, org: data.org, token: data.token, loading: false })
      return { ok: true }
    } catch { return { ok: false, error: "Network error" } }
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
    } catch { /* swallow */ }
    setState({ user: null, org: null, token: null, loading: false })
  }, [])

  return <AuthContext.Provider value={{ ...state, login, register, logout, checkSession }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
