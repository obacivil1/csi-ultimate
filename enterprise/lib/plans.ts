import type { PlanId, PlanDef } from "./saas-types"

export const PLANS: Record<PlanId, PlanDef> = {
  starter: {
    id: "starter",
    name: "Starter",
    price: 0,
    sources: 3,
    maxCrawls: 50,
    records: 5000,
    scheduledJobs: 0,
    users: 2,
    exports: 10,
    features: ["basic-crawling"],
    description: "For individuals and small evaluations",
  },
  professional: {
    id: "professional",
    name: "Professional",
    price: 99,
    sources: 10,
    maxCrawls: 500,
    records: 50000,
    scheduledJobs: 10,
    users: 5,
    exports: 100,
    features: ["basic-crawling", "scheduler", "exports", "sse-notifications", "data-validation"],
    description: "For growing teams with recurring intelligence needs",
  },
  ultimate: {
    id: "ultimate",
    name: "Ultimate",
    price: 299,
    sources: -1,
    maxCrawls: -1,
    records: -1,
    scheduledJobs: -1,
    users: -1,
    exports: -1,
    features: ["basic-crawling", "scheduler", "exports", "sse-notifications", "data-validation", "admin-api", "audit-logs", "priority-support", "multi-workspace"],
    description: "For enterprises requiring full platform access",
  },
}

export function getPlan(id: PlanId): PlanDef {
  return PLANS[id]
}

export function hasFeature(planId: PlanId, feature: string): boolean {
  return PLANS[planId].features.includes(feature)
}

export function isUnlimited(val: number): boolean {
  return val === -1
}

export function getLimitDisplay(planId: PlanId, key: keyof PlanDef): string {
  const val = PLANS[planId][key]
  if (typeof val === "number" && val === -1) return "Unlimited"
  if (typeof val === "number") return val.toLocaleString()
  return String(val)
}

export function checkLimit(planId: PlanId, key: keyof PlanDef, current: number): { allowed: boolean; remaining: number; limit: number } {
  const limit = PLANS[planId][key] as number
  if (isUnlimited(limit)) return { allowed: true, remaining: -1, limit: -1 }
  return { allowed: current < limit, remaining: Math.max(0, limit - current), limit }
}
