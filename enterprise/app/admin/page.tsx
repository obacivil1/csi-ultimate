"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/lib/auth-context"
import { AuthGuard } from "@/components/auth/guard"
import { PLANS } from "@/lib/plans"
import {
  Users, Building2, ShieldCheck, Activity, Globe,
  Zap, Trash2, ChevronRight, Plus, Key,
} from "lucide-react"
import type { PlanId, UserRole } from "@/lib/saas-types"

export default function AdminConsole() {
  return (
    <AuthGuard requiredRole="admin">
      <AdminPage />
    </AuthGuard>
  )
}

function AdminPage() {
  const { user, org, token } = useAuth()
  const [users, setUsers] = useState<any[]>([])
  const [usage, setUsage] = useState<any>(null)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteName, setInviteName] = useState("")
  const [inviteRole, setInviteRole] = useState<UserRole>("analyst")
  const [inviteResult, setInviteResult] = useState("")
  const [plan, setPlan] = useState<any>(null)

  const headers = { Authorization: `Bearer ${token}` }
  const isOwner = user?.role === "owner"

  useEffect(() => {
    if (!token) return
    fetch("/api/org/users", { headers }).then(r => r.json()).then(setUsers).catch(() => {})
    fetch("/api/usage", { headers }).then(r => r.json()).then(d => { setUsage(d.usage); setPlan(d.plan) }).catch(() => {})
  }, [token])

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) return
    setInviteResult("")
    const res = await fetch("/api/org/users", {
      method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ email: inviteEmail, name: inviteName, role: inviteRole }),
    })
    if (res.ok) {
      setInviteResult("User invited. They will receive login instructions.")
      setInviteEmail(""); setInviteName("")
      fetch("/api/org/users", { headers }).then(r => r.json()).then(setUsers)
    } else {
      const data = await res.json()
      setInviteResult(data.error || "Invitation failed")
    }
  }

  const handleRoleChange = async (userId: string, role: string) => {
    await fetch(`/api/org/users/${userId}`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ role }),
    })
    fetch("/api/org/users", { headers }).then(r => r.json()).then(setUsers)
  }

  const handleRemoveUser = async (userId: string) => {
    await fetch(`/api/org/users/${userId}`, { method: "DELETE", headers })
    fetch("/api/org/users", { headers }).then(r => r.json()).then(setUsers)
  }

  const planInfo = org?.plan ? PLANS[org.plan] : null

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Admin Console</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage organization, users, and plan</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 animate-fade-in-up">
        {/* Organization */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" /> Organization
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{org?.name || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Plan</span><Badge variant="outline">{planInfo?.name || org?.plan || "—"}</Badge></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Users</span><span className="font-medium">{users.length}</span></div>
          </CardContent>
        </Card>

        {/* Plan Details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" /> Plan Limits
            </CardTitle>
          </CardHeader>
          <CardContent>
            {planInfo && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded bg-muted/40"><span className="text-muted-foreground">Sources</span><div className="font-medium tabular-nums">{usage ? `${usage.crawlsUsed} / ${planInfo.sources === -1 ? "∞" : planInfo.sources}` : "—"}</div></div>
                <div className="p-2 rounded bg-muted/40"><span className="text-muted-foreground">Crawls</span><div className="font-medium tabular-nums">{usage ? `${usage.crawlsUsed} / ${planInfo.maxCrawls === -1 ? "∞" : planInfo.maxCrawls}` : "—"}</div></div>
                <div className="p-2 rounded bg-muted/40"><span className="text-muted-foreground">Records</span><div className="font-medium tabular-nums">{usage ? `${usage.recordsCollected} / ${planInfo.records === -1 ? "∞" : planInfo.records.toLocaleString()}` : "—"}</div></div>
                <div className="p-2 rounded bg-muted/40"><span className="text-muted-foreground">Exports</span><div className="font-medium tabular-nums">{usage ? `${usage.exportsGenerated} / ${planInfo.exports === -1 ? "∞" : planInfo.exports}` : "—"}</div></div>
              </div>
            )}
            {!planInfo && <p className="text-xs text-muted-foreground">No plan data available</p>}
          </CardContent>
        </Card>
      </div>

      {/* Users */}
      <Card className="animate-fade-in-up stagger-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Team Members ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border/50">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{u.name}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  {u.role === "owner" && !isOwner ? (
                    <span className="text-xs font-medium text-muted-foreground px-2">Owner</span>
                  ) : (
                    <Select value={u.role} onValueChange={v => handleRoleChange(u.id, v)}>
                      <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {isOwner && <SelectItem value="owner">Owner</SelectItem>}
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="analyst">Analyst</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {u.role !== "owner" && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-500" onClick={() => handleRemoveUser(u.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border/30 pt-3">
            <p className="text-xs font-medium text-foreground mb-2">Invite Team Member</p>
            <div className="flex gap-2 flex-wrap">
              <Input placeholder="Name" className="h-8 text-xs w-32" value={inviteName} onChange={e => setInviteName(e.target.value)} />
              <Input placeholder="Email" type="email" className="h-8 text-xs w-44" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
              <Select value={inviteRole} onValueChange={v => setInviteRole(v as UserRole)}>
                <SelectTrigger className="h-8 text-xs w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="analyst">Analyst</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 text-xs gap-1" onClick={handleInvite}><Plus className="h-3 w-3" /> Invite</Button>
            </div>
            {inviteResult && <p className="text-xs text-amber-600 mt-1">{inviteResult}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Usage */}
      <Card className="animate-fade-in-up stagger-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Usage Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          {usage ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-muted text-center">
                <Zap className="h-4 w-4 mx-auto mb-1 text-primary" />
                <div className="text-lg font-bold">{usage.crawlsUsed}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Crawls</div>
              </div>
              <div className="p-3 rounded-lg bg-muted text-center">
                <Globe className="h-4 w-4 mx-auto mb-1 text-primary" />
                <div className="text-lg font-bold">{usage.recordsCollected.toLocaleString()}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Records</div>
              </div>
              <div className="p-3 rounded-lg bg-muted text-center">
                <Zap className="h-4 w-4 mx-auto mb-1 text-primary" />
                <div className="text-lg font-bold">{usage.exportsGenerated}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Exports</div>
              </div>
              <div className="p-3 rounded-lg bg-muted text-center">
                <Activity className="h-4 w-4 mx-auto mb-1 text-primary" />
                <div className="text-lg font-bold">{usage.storageConsumed}MB</div>
                <div className="text-[10px] text-muted-foreground uppercase">Storage</div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No usage data yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
