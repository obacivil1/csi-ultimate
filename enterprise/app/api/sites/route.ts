import { NextRequest, NextResponse } from "next/server"
import { getSessionFromReq, ENGINE } from "@/lib/api-auth"

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const res = await fetch(`${ENGINE}/api/sites`, { cache: "no-store" })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Engine unavailable" }, { status: 503 })
  }
}
