import { NextRequest, NextResponse } from "next/server"
import { getSessionFromReq, ENGINE } from "@/lib/api-auth"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const format = req.nextUrl.searchParams.get("format") || "xlsx"
  try {
    const res = await fetch(`${ENGINE}/api/crawl/${id}/export?format=${format}`, { cache: "no-store" })
    if (!res.ok) return NextResponse.json({ error: "Export not found" }, { status: 404 })
    const blob = await res.blob()
    return new NextResponse(blob, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
        "Content-Disposition": res.headers.get("Content-Disposition") || `attachment; filename="export_${id}.${format}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: "Engine unavailable" }, { status: 503 })
  }
}
