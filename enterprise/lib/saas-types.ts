export type PlanId = "starter" | "professional" | "ultimate"
export type UserRole = "owner" | "admin" | "analyst" | "viewer"

export interface PlanDef {
  id: PlanId
  name: string
  price: number
  sources: number
  maxCrawls: number
  records: number
  scheduledJobs: number
  users: number
  exports: number
  features: string[]
  description: string
}

export interface Organization {
  id: string
  name: string
  plan: PlanId
  createdAt: string
  updatedAt: string
}

export interface User {
  id: string
  orgId: string
  email: string
  name: string
  passwordHash: string
  role: UserRole
  createdAt: string
}

export interface Session {
  token: string
  userId: string
  orgId: string
  email: string
  role: UserRole
  createdAt: string
}

export interface UsageRecord {
  orgId: string
  crawlsUsed: number
  recordsCollected: number
  exportsGenerated: number
  storageConsumed: number
  lastUpdated: string
}

export interface AuthState {
  user: { id: string; email: string; name: string; role: UserRole } | null
  org: { id: string; name: string; plan: PlanId } | null
  token: string | null
  loading: boolean
}
