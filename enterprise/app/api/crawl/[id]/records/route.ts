import { NextRequest, NextResponse } from "next/server"
import { getSessionFromReq, ENGINE } from "@/lib/api-auth"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  try {
    const url = new URL(`${ENGINE}/api/crawl/${id}/records`)
    url.searchParams.set("page", req.nextUrl.searchParams.get("page") || "1")
    url.searchParams.set("limit", req.nextUrl.searchParams.get("limit") || "50")
    const res = await fetch(url.toString(), { cache: "no-store" })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ error: "Engine unavailable" }, { status: 503 })
  }
}
