import { NextRequest, NextResponse } from "next/server"
import { getSessionFromReq, ENGINE } from "@/lib/api-auth"

export async function GET(req: NextRequest, { params }: { params: Promise<{ hostname: string }> }) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { hostname } = await params
  try {
    const res = await fetch(`${ENGINE}/api/sites/${hostname}/discover`, { cache: "no-store", signal: AbortSignal.timeout(30000) })
    if (!res.ok) return NextResponse.json({ error: "Discovery failed" }, { status: res.status })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ error: "Engine unavailable" }, { status: 503 })
  }
}
