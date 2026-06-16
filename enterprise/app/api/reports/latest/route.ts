import { NextRequest, NextResponse } from "next/server"
import { getSessionFromReq, ENGINE } from "@/lib/api-auth"

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const site = req.nextUrl.searchParams.get("site")
    const qs = site ? `?site=${encodeURIComponent(site)}` : ""
    const res = await fetch(`${ENGINE}/api/reports/latest${qs}`, { cache: "no-store" })
    if (!res.ok) return NextResponse.json(null)
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json(null)
  }
}
