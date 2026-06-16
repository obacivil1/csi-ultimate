import { NextRequest, NextResponse } from "next/server"
import { getSessionFromReq, ENGINE } from "@/lib/api-auth"

export async function POST(req: NextRequest) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await req.json()
    const res = await fetch(`${ENGINE}/api/crawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: "Engine unavailable" }, { status: 503 })
  }
}
