import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { getSessionFromReq } from "@/lib/api-auth"

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { getOrgUsers } = await import("@/lib/saas-store")
  const users = await getOrgUsers(session.orgId)
  return NextResponse.json(users.map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt })))
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "owner" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { email, name, role } = await req.json()
  if (!email || !name) {
    return NextResponse.json({ error: "Email and name required" }, { status: 400 })
  }

  const invitedRole = role || "analyst"
  if (invitedRole === "owner") {
    return NextResponse.json({ error: "Cannot invite an owner" }, { status: 400 })
  }

  const { getUserByEmail, createUser, hashPassword, getOrg } = await import("@/lib/saas-store")
  const existing = await getUserByEmail(email)
  if (existing) return NextResponse.json({ error: "User already exists" }, { status: 409 })

  const org = await getOrg(session.orgId)
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 })

  const { getOrgUsers } = await import("@/lib/saas-store")
  const currentUsers = await getOrgUsers(session.orgId)
  const { getPlan } = await import("@/lib/plans")
  const plan = getPlan(org.plan)
  if (plan.users !== -1 && currentUsers.length >= plan.users) {
    return NextResponse.json({ error: "User limit reached for your plan" }, { status: 403 })
  }

  const defaultPassword = crypto.randomUUID().slice(0, 12)
  await createUser({
    id: crypto.randomUUID(),
    orgId: session.orgId,
    email, name,
    passwordHash: hashPassword(defaultPassword),
    role: invitedRole,
    createdAt: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true })
}
