import { NextRequest, NextResponse } from "next/server"

async function getSessionFromReq(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "")
  if (!token) return null
  const { getSession } = await import("@/lib/saas-store")
  return getSession(token)
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { getUsage } = await import("@/lib/saas-store")
  const { getOrg } = await import("@/lib/saas-store")
  const { getPlan } = await import("@/lib/plans")

  const org = await getOrg(session.orgId)
  const usage = await getUsage(session.orgId)
  const plan = org ? getPlan(org.plan) : null

  return NextResponse.json({ usage, plan: plan ? { id: plan.id, sources: plan.sources, maxCrawls: plan.maxCrawls, records: plan.records, users: plan.users, exports: plan.exports } : null })
}
