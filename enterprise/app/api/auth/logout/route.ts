import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("csi-session")?.value
    if (token) {
      const { deleteSession } = await import("@/lib/saas-store")
      await deleteSession(token)
    }
    const { clearSessionCookieHeader } = await import("@/lib/api-auth")
    return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookieHeader() } })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
