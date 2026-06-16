import { NextRequest } from "next/server"
import type { Session } from "./saas-types"

export const ENGINE = `http://localhost:${process.env.CSI_PORT || 3030}`

export async function getSessionFromReq(req: NextRequest): Promise<Session | null> {
  let token: string | null = null

  token = req.headers.get("authorization")?.replace("Bearer ", "") || null

  if (!token) {
    token = req.cookies.get("csi-session")?.value || null
  }

  if (!token) {
    token = req.nextUrl.searchParams.get("token") || null
  }

  if (!token) return null

  const { getSession } = await import("@/lib/saas-store")
  return getSession(token)
}

export function getSessionCookieHeader(token: string): string {
  return `csi-session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
}

export function clearSessionCookieHeader(): string {
  return `csi-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}
