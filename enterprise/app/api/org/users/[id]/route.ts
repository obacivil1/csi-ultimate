import { NextRequest, NextResponse } from "next/server"
import { getSessionFromReq } from "@/lib/api-auth"

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "owner" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const { role } = await req.json()
  if (!role) return NextResponse.json({ error: "Role required" }, { status: 400 })

  const { getOrgUsers } = await import("@/lib/saas-store")
  const targetUser = (await getOrgUsers(session.orgId)).find(u => u.id === id)
  if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 })

  if (targetUser.role === "owner" && session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can change the owner's role" }, { status: 403 })
  }
  if (role === "owner" && session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can assign owner role" }, { status: 403 })
  }

  const { updateUserRole } = await import("@/lib/saas-store")
  await updateUserRole(id, role)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromReq(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "owner" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  if (id === session.userId) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 })
  }

  const { getOrgUsers } = await import("@/lib/saas-store")
  const targetUser = (await getOrgUsers(session.orgId)).find(u => u.id === id)
  if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 })
  if (targetUser.role === "owner") {
    return NextResponse.json({ error: "Cannot delete the organization owner" }, { status: 403 })
  }

  const { deleteUser } = await import("@/lib/saas-store")
  await deleteUser(id)
  return NextResponse.json({ ok: true })
}
