"use client"

import { useState, useEffect } from "react"
import { useTheme } from "@/components/theme-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Globe, Download, Palette, Bell, Shield, Save, Loader2 } from "lucide-react"
import { safeFetch } from "@/lib/utils"

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

export default function SettingsPage() {
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<Record<string, any>>({})
  const [loaded, setLoaded] = useState(false)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    safeFetch("/api/settings").then(data => { setSettings(data); setLoaded(true) }).catch(() => setLoaded(true))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
    } catch {}
    setTimeout(() => setSaving(false), 400)
  }

  const update = (key: string, value: any) => setSettings(prev => ({ ...prev, [key]: value }))

  if (!loaded) return null

  return (
    <div className="p-6 space-y-6 max-w-4xl animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="gradient-text">Settings</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure platform preferences and defaults</p>
      </div>

      <Tabs defaultValue="crawler">
        <TabsList>
          <TabsTrigger value="crawler"><Globe className="mr-1.5 h-3.5 w-3.5" /> Crawler</TabsTrigger>
          <TabsTrigger value="proxy"><Shield className="mr-1.5 h-3.5 w-3.5" /> Proxy</TabsTrigger>
          <TabsTrigger value="export"><Download className="mr-1.5 h-3.5 w-3.5" /> Export</TabsTrigger>
          <TabsTrigger value="theme"><Palette className="mr-1.5 h-3.5 w-3.5" /> Theme</TabsTrigger>
          <TabsTrigger value="notifications"><Bell className="mr-1.5 h-3.5 w-3.5" /> Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="crawler">
          <SectionCard title="Crawler Settings" icon={Globe}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2"><Label>Max Records Per Crawl</Label><Input type="number" value={settings.maxRecords ?? 100} onChange={e => update("maxRecords", Number(e.target.value))} /></div>
              <div className="space-y-2"><Label>Default Speed</Label>
                <Select value={String(settings.defaultSpeed ?? 3)} onValueChange={v => update("defaultSpeed", Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Careful (1 worker)</SelectItem>
                    <SelectItem value="3">Balanced (3 workers)</SelectItem>
                    <SelectItem value="5">Fast (5 workers)</SelectItem>
                    <SelectItem value="10">Turbo (10 workers)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Politeness Delay</Label>
                <Select value={String(settings.politenessDelay ?? 1500)} onValueChange={v => update("politenessDelay", Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="500">0.5s</SelectItem>
                    <SelectItem value="1500">1.5s</SelectItem>
                    <SelectItem value="3000">3s</SelectItem>
                    <SelectItem value="5000">5s</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>User Agent</Label><Input value={settings.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"} onChange={e => update("userAgent", e.target.value)} /></div>
            <div className="flex items-center justify-between">
              <div><div className="text-sm font-medium">Retry Failed Pages</div><div className="text-xs text-muted-foreground">Automatically retry up to 2 times on failure</div></div>
              <Switch checked={settings.retryFailed ?? true} onCheckedChange={v => update("retryFailed", v)} />
            </div>
            <div className="flex items-center justify-between">
              <div><div className="text-sm font-medium">Respect robots.txt</div><div className="text-xs text-muted-foreground">Honor robots.txt extraction directives</div></div>
              <Switch checked={settings.respectRobots ?? true} onCheckedChange={v => update("respectRobots", v)} />
            </div>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving..." : "Save Changes"}</Button>
          </SectionCard>
        </TabsContent>

        <TabsContent value="proxy">
          <SectionCard title="Proxy Settings" icon={Shield}>
            <div className="flex items-center justify-between">
              <div><div className="text-sm font-medium">Use Proxy</div><div className="text-xs text-muted-foreground">Route traffic through a proxy server</div></div>
              <Switch checked={settings.useProxy ?? false} onCheckedChange={v => update("useProxy", v)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Host</Label><Input placeholder="proxy.example.com" value={settings.proxyHost || ""} onChange={e => update("proxyHost", e.target.value)} /></div>
              <div className="space-y-2"><Label>Port</Label><Input type="number" placeholder="8080" value={settings.proxyPort || ""} onChange={e => update("proxyPort", e.target.value)} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Username</Label><Input placeholder="Optional" value={settings.proxyUsername || ""} onChange={e => update("proxyUsername", e.target.value)} /></div>
              <div className="space-y-2"><Label>Password</Label><Input type="password" placeholder="Optional" value={settings.proxyPassword || ""} onChange={e => update("proxyPassword", e.target.value)} /></div>
            </div>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving..." : "Save Changes"}</Button>
          </SectionCard>
        </TabsContent>

        <TabsContent value="export">
          <SectionCard title="Export Settings" icon={Download}>
            <div className="space-y-2"><Label>Default Format</Label>
              <Select value={settings.defaultExportFormat || "excel"} onValueChange={v => update("defaultExportFormat", v)}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="excel">Excel (.xlsx)</SelectItem>
                  <SelectItem value="json">JSON (.json)</SelectItem>
                  <SelectItem value="csv">CSV (.csv)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Output Directory</Label><Input value={settings.outputDir || "./exports"} onChange={e => update("outputDir", e.target.value)} /></div>
            <div className="flex items-center justify-between">
              <div><div className="text-sm font-medium">Auto-Export on Complete</div><div className="text-xs text-muted-foreground">Automatically generate exports after each crawl</div></div>
              <Switch checked={settings.autoExport ?? true} onCheckedChange={v => update("autoExport", v)} />
            </div>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving..." : "Save Changes"}</Button>
          </SectionCard>
        </TabsContent>

        <TabsContent value="theme">
          <SectionCard title="Theme Settings" icon={Palette}>
            <div className="space-y-2"><Label>Appearance</Label>
              <Select value={theme} onValueChange={(v) => setTheme(v as "dark" | "light" | "system")}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark Mode</SelectItem>
                  <SelectItem value="light">Light Mode</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div><div className="text-sm font-medium">Glass Effects</div><div className="text-xs text-muted-foreground">Enable glass-morphism UI effects</div></div>
              <Switch checked={settings.glassEffects ?? true} onCheckedChange={v => update("glassEffects", v)} />
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="notifications">
          <SectionCard title="Notification Preferences" icon={Bell}>
            {["Crawl Completed", "Crawl Failed", "Schedule Triggered", "Health Score Dropped", "New Recommendation"].map(n => (
              <div key={n} className="flex items-center justify-between">
                <span className="text-sm">{n}</span>
                <Switch checked={settings[`notify_${n}`] ?? true} onCheckedChange={v => update(`notify_${n}`, v)} />
              </div>
            ))}
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving..." : "Save Changes"}</Button>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  )
}
