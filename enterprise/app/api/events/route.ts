import { NextRequest, NextResponse } from "next/server"
import { getSessionFromReq, ENGINE } from "@/lib/api-auth"

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req)
  if (!session) return new NextResponse("Unauthorized", { status: 401 })

  const controller = new AbortController()
  req.signal.addEventListener("abort", () => controller.abort())

  const res = await fetch(`${ENGINE}/api/events`, {
    signal: controller.signal,
    headers: { Accept: "text/event-stream" },
  })

  return new Response(res.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
