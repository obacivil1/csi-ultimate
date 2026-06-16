import { NextResponse } from "next/server"
import { PLANS } from "@/lib/plans"

export async function GET() {
  const publicPlans = Object.values(PLANS).map(p => ({
    id: p.id, name: p.name, price: p.price,
    sources: p.sources, maxCrawls: p.maxCrawls, records: p.records,
    scheduledJobs: p.scheduledJobs, users: p.users, exports: p.exports,
    features: p.features, description: p.description,
  }))
  return NextResponse.json(publicPlans)
}
