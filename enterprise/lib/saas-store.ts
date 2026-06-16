import "server-only"
import { promises as fs } from "fs"
import * as path from "path"
import crypto from "crypto"
import type { Organization, User, Session } from "./saas-types"

const STATE_DIR = path.resolve(process.cwd(), "..", "state", "saas")

async function ensureDir() {
  await fs.mkdir(STATE_DIR, { recursive: true })
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const data = await fs.readFile(path.join(STATE_DIR, file), "utf-8")
    return JSON.parse(data) as T
  } catch { return fallback }
}

async function writeJson(file: string, data: any): Promise<void> {
  await ensureDir()
  await fs.writeFile(path.join(STATE_DIR, file), JSON.stringify(data, null, 2), "utf-8")
}

// --- Users ---
export async function getUsers(): Promise<User[]> {
  return readJson<User[]>("users.json", [])
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const users = await getUsers()
  return users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null
}

export async function getUserById(id: string): Promise<User | null> {
  const users = await getUsers()
  return users.find(u => u.id === id) || null
}

export async function getOrgUsers(orgId: string): Promise<User[]> {
  const users = await getUsers()
  return users.filter(u => u.orgId === orgId)
}

export async function createUser(user: User): Promise<void> {
  const users = await getUsers()
  users.push(user)
  await writeJson("users.json", users)
}

export async function updateUserRole(id: string, role: User["role"]): Promise<boolean> {
  const users = await getUsers()
  const idx = users.findIndex(u => u.id === id)
  if (idx === -1) return false
  users[idx].role = role
  await writeJson("users.json", users)
  return true
}

export async function deleteUser(id: string): Promise<boolean> {
  const users = await getUsers()
  const filtered = users.filter(u => u.id !== id)
  if (filtered.length === users.length) return false
  await writeJson("users.json", filtered)
  return true
}

// --- Orgs ---
export async function getOrgs(): Promise<Organization[]> {
  return readJson<Organization[]>("orgs.json", [])
}

export async function getOrg(id: string): Promise<Organization | null> {
  const orgs = await getOrgs()
  return orgs.find(o => o.id === id) || null
}

export async function createOrg(org: Organization): Promise<void> {
  const orgs = await getOrgs()
  orgs.push(org)
  await writeJson("orgs.json", orgs)
}

export async function updateOrg(id: string, updates: Partial<Organization>): Promise<boolean> {
  const orgs = await getOrgs()
  const idx = orgs.findIndex(o => o.id === id)
  if (idx === -1) return false
  orgs[idx] = { ...orgs[idx], ...updates, updatedAt: new Date().toISOString() }
  await writeJson("orgs.json", orgs)
  return true
}

// --- Sessions ---
export async function getSessions(): Promise<Session[]> {
  return readJson<Session[]>("sessions.json", [])
}

export async function getSession(token: string): Promise<Session | null> {
  const sessions = await getSessions()
  const session = sessions.find(s => s.token === token)
  if (!session) return null
  const age = Date.now() - new Date(session.createdAt).getTime()
  if (age > 24 * 60 * 60 * 1000) {
    await deleteSession(token)
    return null
  }
  return session
}

export async function createSession(user: User): Promise<Session> {
  const sessions = await getSessions()
  const session: Session = {
    token: crypto.randomUUID(),
    userId: user.id,
    orgId: user.orgId,
    email: user.email,
    role: user.role,
    createdAt: new Date().toISOString(),
  }
  sessions.push(session)
  await writeJson("sessions.json", sessions)
  return session
}

export async function deleteSession(token: string): Promise<void> {
  const sessions = await getSessions()
  await writeJson("sessions.json", sessions.filter(s => s.token !== token))
}

export async function cleanupExpiredSessions(): Promise<void> {
  const sessions = await getSessions()
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const valid = sessions.filter(s => new Date(s.createdAt).getTime() > cutoff)
  if (valid.length !== sessions.length) {
    await writeJson("sessions.json", valid)
  }
}

// --- Auth ---
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex")
  const derivedKey = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512")
  return `${salt}:${derivedKey.toString("hex")}`
}

export function verifyPassword(password: string, hash: string): boolean {
  const [salt, key] = hash.split(":")
  const derivedKey = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512")
  return derivedKey.toString("hex") === key
}

// --- Usage ---
export async function getUsage(orgId: string) {
  const all = await readJson<Record<string, any>>("usage.json", {})
  return all[orgId] || { crawlsUsed: 0, recordsCollected: 0, exportsGenerated: 0, storageConsumed: 0, lastUpdated: new Date().toISOString() }
}

export async function incrementUsage(orgId: string, field: "crawlsUsed" | "recordsCollected" | "exportsGenerated" | "storageConsumed", amount: number): Promise<void> {
  const all = await readJson<Record<string, any>>("usage.json", {})
  if (!all[orgId]) all[orgId] = { crawlsUsed: 0, recordsCollected: 0, exportsGenerated: 0, storageConsumed: 0, lastUpdated: new Date().toISOString() }
  all[orgId][field] = (all[orgId][field] || 0) + amount
  all[orgId].lastUpdated = new Date().toISOString()
  await writeJson("usage.json", all)
}
