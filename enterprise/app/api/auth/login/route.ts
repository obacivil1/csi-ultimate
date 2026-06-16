import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 })
    }

    const { getUserByEmail, verifyPassword, createSession } = await import("@/lib/saas-store")
    const user = await getUserByEmail(email)
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
    }

    const { getOrg } = await import("@/lib/saas-store")
    const org = await getOrg(user.orgId)
    const session = await createSession(user)

    const { getSessionCookieHeader } = await import("@/lib/api-auth")

    return NextResponse.json({
      token: session.token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      org: org ? { id: org.id, name: org.name, plan: org.plan } : null,
    }, { headers: { "Set-Cookie": getSessionCookieHeader(session.token) } })
  } catch (e: any) {
    return NextResponse.json({ error: "Invalid request" }, { status: 500 })
  }
}
