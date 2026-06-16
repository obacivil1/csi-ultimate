"use client"

import { useState } from "react"
import { Sidebar } from "./sidebar"
import { TopBar } from "./topbar"
import { CommandPalette } from "./command-palette"
import { WorkspaceProvider } from "@/lib/workspace-context"
import { CampaignProvider } from "@/lib/campaign-store"
import { AuthProvider } from "@/lib/auth-context"

export function AppShell({ children }: { children: React.ReactNode }) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  return (
    <AuthProvider>
    <WorkspaceProvider>
      <CampaignProvider>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden">
            <TopBar onCommandPaletteOpen={() => setCommandPaletteOpen(true)} />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
          <CommandPalette
            key={String(commandPaletteOpen)}
            open={commandPaletteOpen}
            onClose={() => setCommandPaletteOpen(false)}
          />
        </div>
      </CampaignProvider>
    </WorkspaceProvider>
    </AuthProvider>
  )
}
