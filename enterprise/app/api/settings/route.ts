import { NextRequest, NextResponse } from "next/server"
import { getSessionFromReq, ENGINE } from "@/lib/api-auth"

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const res = await fetch(`${ENGINE}/api/settings`)
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ error: "Engine unavailable" }, { status: 503 })
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await req.json()
    const res = await fetch(`${ENGINE}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json({ error: "Engine unavailable" }, { status: 503 })
  }
}
