"use client"

import { createContext, useContext, useState, ReactNode } from "react"

export interface Workspace {
  id: string
  name: string
  client: string
  sites: string[]
  createdAt: string
}

interface WorkspaceContextType {
  workspaces: Workspace[]
  currentWorkspace: Workspace | null
  setCurrentWorkspace: (id: string) => void
  createWorkspace: (name: string, client: string, sites: string[]) => void
  deleteWorkspace: (id: string) => void
}

const defaultWorkspaces: Workspace[] = [
  { id: "w-default", name: "Primary Intelligence", client: "Internal", sites: ["gumtree.com", "preloved.co.uk", "olx.com.pk", "london.craigslist.org"], createdAt: "2026-06-01T00:00:00Z" },
  { id: "w-client-a", name: "Client A — Market Research", client: "Client A", sites: ["gumtree.com", "expatriates.com"], createdAt: "2026-06-05T00:00:00Z" },
]

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("csi-workspaces")
      if (stored) try { return JSON.parse(stored) } catch {}
    }
    return defaultWorkspaces
  })
  const [currentId, setCurrentId] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("csi-workspace-id") || "w-default"
    return "w-default"
  })

  const currentWorkspace = workspaces.find(w => w.id === currentId) || workspaces[0] || null

  const setCurrentWorkspace = (id: string) => {
    setCurrentId(id)
    localStorage.setItem("csi-workspace-id", id)
  }

  const createWorkspace = (name: string, client: string, sites: string[]) => {
    const w: Workspace = {
      id: `w-${Date.now()}`,
      name, client, sites,
      createdAt: new Date().toISOString(),
    }
    const updated = [...workspaces, w]
    setWorkspaces(updated)
    localStorage.setItem("csi-workspaces", JSON.stringify(updated))
    setCurrentId(w.id)
    localStorage.setItem("csi-workspace-id", w.id)
  }

  const deleteWorkspace = (id: string) => {
    const updated = workspaces.filter(w => w.id !== id)
    setWorkspaces(updated)
    localStorage.setItem("csi-workspaces", JSON.stringify(updated))
    if (currentId === id) {
      const next = updated[0]?.id || ""
      setCurrentId(next)
      localStorage.setItem("csi-workspace-id", next)
    }
  }

  return (
    <WorkspaceContext.Provider value={{ workspaces, currentWorkspace, setCurrentWorkspace, createWorkspace, deleteWorkspace }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider")
  return ctx
}
