import { test } from "node:test"
import assert from "node:assert/strict"
import { ACTIVITY_MAP, categorizeActivity, computeTenderAnalytics } from "../web/analytics.mjs"

test("categorizeActivity maps keywords and falls back to أخرى", () => {
  assert.equal(categorizeActivity("أعمال مقاولات وبناء"), "تشييد ومقاولات")
  assert.equal(categorizeActivity("صيانة ونظافة"), "صيانة وتشغيل")
  assert.equal(categorizeActivity("توريد أجهزة"), "توريدات")
  assert.equal(categorizeActivity(""), "أخرى")
  assert.equal(categorizeActivity(null), "أخرى")
  assert.equal(categorizeActivity("نشاط غير معروف"), "أخرى")
  assert.ok(Object.keys(ACTIVITY_MAP).length > 0)
})

test("computeTenderAnalytics aggregates a tender set in a single pass", () => {
  const day = ms => new Date(Date.now() + ms).toISOString()
  const D = 86400000
  const base = {
    agencyName: "جهة أ",
    tenderActivityName: "مقاولات",
    tenderTypeName: "منافسة عامة",
    condetionalBookletPrice: 0,
    submitionDate: "2026-05-01",
  }
  const tenders = [
    { ...base, lastOfferPresentationDate: day(3 * D) },
    { ...base, tenderStatusId: 2, condetionalBookletPrice: 2000, lastOfferPresentationDate: day(10 * D) },
    { ...base, condetionalBookletPrice: 1000, lastOfferPresentationDate: day(20 * D) },
    { ...base, agencyName: "جهة ب", tenderActivityName: "صيانة", tenderTypeName: "شراء مباشر", tenderStatusId: 3, lastOfferPresentationDate: day(-5 * D) },
  ]

  const r = computeTenderAnalytics(tenders)

  assert.equal(r.total, 4)
  assert.equal(r.active, 2)

  assert.equal(r.topAgencies[0].name, "جهة أ")
  assert.equal(r.topAgencies[0].count, 3)

  assert.deepEqual(r.topActivities[0], { name: "مقاولات", count: 3 })
  assert.deepEqual(r.types[0], { name: "منافسة عامة", count: 3 })

  const dist = Object.fromEntries(r.activityDist.map(a => [a.name, a.count]))
  assert.equal(dist["تشييد ومقاولات"], 3)
  assert.equal(dist["صيانة وتشغيل"], 1)

  assert.deepEqual(r.monthlyTrend, [{ month: "2026-05", count: 4 }])

  assert.deepEqual(r.booklet, {
    total: 4,
    free: 2,
    freePct: 50,
    paidAvg: 1500,
    paidCount: 2,
    max: 2000,
  })

  assert.deepEqual(r.urgency, { within7: 1, within14: 2, within30: 3 })
})

test("computeTenderAnalytics handles empty input and custom topN", () => {
  const empty = computeTenderAnalytics([])
  assert.equal(empty.total, 0)
  assert.equal(empty.active, 0)
  assert.deepEqual(empty.topAgencies, [])
  assert.deepEqual(empty.monthlyTrend, [])
  assert.equal(empty.booklet.freePct, 0)
  assert.equal(empty.booklet.paidAvg, 0)

  const many = Array.from({ length: 5 }, (_, i) => ({
    agencyName: `جهة ${i}`,
    tenderActivityName: "مقاولات",
    tenderTypeName: "منافسة عامة",
    condetionalBookletPrice: 0,
    submitionDate: "2026-05-01",
  }))
  const r = computeTenderAnalytics(many, { topN: 2 })
  assert.equal(r.topAgencies.length, 2)
})
