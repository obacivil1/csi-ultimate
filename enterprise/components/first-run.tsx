"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sparkles, Play, Globe, ArrowRight, BarChart3, Radio,
  Search, ShieldCheck, FileText, Rocket,
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

const steps = [
  { icon: Globe, label: "Configure Intelligence Sources", desc: "Select from marketplaces and configure extraction targets", color: "text-blue-400", bg: "bg-blue-500/10" },
  { icon: Play, label: "Launch Data Campaigns", desc: "Set keywords, categories, or URLs and start crawling", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  { icon: Sparkles, label: "Analyze & Export Intelligence", desc: "Review quality scores, compare sources, and export data", color: "text-purple-400", bg: "bg-purple-500/10" },
]

const features = [
  { href: "/competitive-intelligence", icon: BarChart3, label: "Competitive Intel", desc: "Compare sources side by side" },
  { href: "/operations", icon: Radio, label: "Live Operations", desc: "Monitor campaigns in real-time" },
  { href: "/results", icon: Search, label: "Results Explorer", desc: "Browse and filter extraction data" },
  { href: "/data-quality", icon: ShieldCheck, label: "Data Quality Lab", desc: "Audit field completeness" },
  { href: "/exports", icon: FileText, label: "Export Center", desc: "Download reports and schedule exports" },
]

export function FirstRun() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Card className="gradient-border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent overflow-hidden">
        <CardContent className="py-12 text-center relative">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="p-3 rounded-full bg-primary/10 w-fit mx-auto mb-4 relative">
            <Rocket className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold mb-2">
            <span className="gradient-text">CSI-Ultimate Enterprise</span>
          </h2>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto text-sm leading-relaxed">
            Your intelligence platform is ready. Launch your first campaign to start extracting, analyzing, and comparing market data across multiple sources.
          </p>
          <div className="flex gap-3 justify-center">
            <Link href="/crawl-studio">
              <Button size="lg" className="gap-2 shadow-lg shadow-primary/20">
                <Play className="h-5 w-5" /> Launch First Campaign
              </Button>
            </Link>
            <Link href="/competitive-intelligence">
              <Button size="lg" variant="outline" className="gap-2">
                <BarChart3 className="h-5 w-5" /> Explore Demo Data
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {steps.map(({ icon: Icon, label, desc, color, bg }, i) => (
          <Card key={label} className="glass-card group hover:border-primary/30 transition-all">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={cn("flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold", bg, color)}>
                  {i + 1}
                </div>
                <Icon className={cn("h-4 w-4", color)} />
              </div>
              <h3 className="font-medium text-sm mb-1">{label}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Explore the Platform</h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ href, icon: Icon, label, desc }) => (
              <Link key={href} href={href}>
                <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer group">
                  <Icon className="h-4 w-4 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium group-hover:text-foreground transition-colors">{label}</div>
                    <div className="text-[10px] text-muted-foreground">{desc}</div>
                  </div>
                  <ArrowRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground ml-auto shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card gradient-border">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Rocket className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <h3 className="text-sm font-medium">Quick Start Demo</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Run a pre-configured crawl to see the platform in action immediately</p>
              </div>
            </div>
            <Link href="/crawl-studio">
              <Button size="sm" className="gap-1.5 shrink-0">
                Start Demo <ArrowRight className="ml-0.5 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
