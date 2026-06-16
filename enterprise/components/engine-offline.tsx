"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Terminal, RefreshCw, Copy, Check } from "lucide-react"
import { useState } from "react"

export function EngineOffline() {
  const [copied, setCopied] = useState(false)

  const copyCommand = () => {
    navigator.clipboard.writeText("node web/server.mjs")
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardContent className="py-16 text-center">
        <div className="p-3 rounded-full bg-amber-500/10 w-fit mx-auto mb-4">
          <Terminal className="h-8 w-8 text-amber-400" />
        </div>
        <h2 className="text-xl font-semibold mb-2">CSI Engine Offline</h2>
        <p className="text-muted-foreground mb-1">The Enterprise UI is running</p>
        <p className="text-muted-foreground mb-4">but the CSI Engine is not reachable.</p>
        <div className="text-sm text-muted-foreground mb-6">
          Expected Engine URL:
          <code className="block mt-1 bg-muted px-4 py-2 rounded-lg text-foreground text-xs w-fit mx-auto">
            http://localhost:3030
          </code>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={copyCommand}>
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? "Copied!" : "Start Engine"}
          </Button>
          <Button onClick={() => location.reload()}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> Retry Connection
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
