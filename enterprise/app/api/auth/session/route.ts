import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const { getSessionFromReq } = await import("@/lib/api-auth")
  const session = await getSessionFromReq(req)

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }

  const { getOrg } = await import("@/lib/saas-store")
  const org = await getOrg(session.orgId)
  return NextResponse.json({
    authenticated: true,
    user: { id: session.userId, email: session.email, role: session.role },
    org: org ? { id: org.id, name: org.name, plan: org.plan } : null,
  })
}
