import { NextRequest, NextResponse } from "next/server"
import { getSessionFromReq } from "@/lib/api-auth"

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { getOrg } = await import("@/lib/saas-store")
  const org = await getOrg(session.orgId)
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 })

  return NextResponse.json(org)
}

export async function PUT(req: NextRequest) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "owner" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { updateOrg } = await import("@/lib/saas-store")
  const body = await req.json()
  const ok = await updateOrg(session.orgId, body)
  if (!ok) return NextResponse.json({ error: "Organization not found" }, { status: 404 })

  const { getOrg } = await import("@/lib/saas-store")
  const org = await getOrg(session.orgId)
  return NextResponse.json(org)
}
