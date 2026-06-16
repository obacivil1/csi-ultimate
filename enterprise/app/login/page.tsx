"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ShieldCheck } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const { login, register, user, loading } = useAuth()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-sm text-muted-foreground animate-pulse">Loading...</div>
      </div>
    )
  }

  if (user) {
    router.replace("/")
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!email.trim() || !password) {
      setError("Email and password are required")
      return
    }

    if (mode === "register") {
      if (password.length < 8) {
        setError("Password must be at least 8 characters")
        return
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match")
        return
      }
      if (!name.trim()) {
        setError("Full name is required")
        return
      }
    }

    setSubmitting(true)
    const fn = mode === "login" ? login : register
    const args = mode === "login" ? [email, password] : [email, password, name]
    const result = await (fn as any)(...args)
    setSubmitting(false)
    if (result.ok) router.replace("/")
    else setError(result.error || "Something went wrong")
  }

  const switchMode = () => {
    setMode(mode === "login" ? "register" : "login")
    setError("")
    setConfirmPassword("")
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <span className="gradient-text">CSI Ultimate</span>
          </div>
          <p className="text-sm text-muted-foreground">Intelligence Platform</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{mode === "login" ? "Sign In" : "Create Account"}</CardTitle>
            <CardDescription className="text-xs">
              {mode === "login" ? "Enter your credentials to access the platform" : "Register to start your intelligence operations"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "register" && (
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" required className="h-9" />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" required className="h-9" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required className="h-9" minLength={8} />
              </div>
              {mode === "register" && (
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" required className="h-9" minLength={8} />
                </div>
              )}

              {error && <p className="text-xs text-rose-600">{error}</p>}

              <Button type="submit" className="w-full gap-1.5" disabled={submitting}>
                {submitting ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
              </Button>
            </form>

            <div className="mt-4 text-center text-xs text-muted-foreground">
              {mode === "login" ? (
                <>Don&apos;t have an account?{" "}<button onClick={switchMode} type="button" className="text-primary hover:underline font-medium">Register</button></>
              ) : (
                <>Already have an account?{" "}<button onClick={switchMode} type="button" className="text-primary hover:underline font-medium">Sign In</button></>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-[10px] text-center text-muted-foreground">
          By continuing, you agree to the terms of service.
        </p>
      </div>
    </div>
  )
}
