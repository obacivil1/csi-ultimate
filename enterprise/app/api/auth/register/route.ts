import { NextRequest, NextResponse } from "next/server"
import { createUser, createOrg, getUserByEmail } from "@/lib/saas-store"
import { hashPassword, createSession } from "@/lib/saas-store"
import crypto from "crypto"

export async function POST(req: NextRequest) {
  try {
    const { email, password, name, orgName } = await req.json()
    if (!email || !password || !name) {
      return NextResponse.json({ error: "Email, password, and name required" }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }

    const existing = await getUserByEmail(email)
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 })
    }

    const orgId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    const now = new Date().toISOString()

    await createOrg({ id: orgId, name: orgName || `${name}'s Organization`, plan: "starter", createdAt: now, updatedAt: now })
    await createUser({ id: userId, orgId, email, name, passwordHash: hashPassword(password), role: "owner", createdAt: now })

    const session = await createSession({ id: userId, orgId, email, name, passwordHash: "", role: "owner", createdAt: now })

    const { getSessionCookieHeader } = await import("@/lib/api-auth")

    return NextResponse.json({
      token: session.token,
      user: { id: userId, email, name, role: "owner" },
      org: { id: orgId, name: orgName || `${name}'s Organization`, plan: "starter" },
    }, { headers: { "Set-Cookie": getSessionCookieHeader(session.token) } })
  } catch {
    return NextResponse.json({ error: "Registration failed" }, { status: 500 })
  }
}
