import { test } from "node:test"
import assert from "node:assert/strict"
import { parseDate, isWithinWindow } from "../scripts/job-hunter/dates.mjs"
import { regionGate } from "../core/job-scan.mjs"

test("parseDate keeps the time of day", () => {
  const en = parseDate("Thursday, Sep 24, 2026, 11:54:23 AM")
  const d = new Date(en)
  assert.equal(d.getHours(), 11)
  assert.equal(d.getMinutes(), 54)
  assert.equal(d.getSeconds(), 23)
  assert.equal(d.getDate(), 24)
})

test("parseDate handles Arabic digits + ص/م meridiem", () => {
  const ts = parseDate("الخميس، ٢٤ سبتمبر ٢٠٢٦، ١١:٥٤:٢٣ ص")
  const d = new Date(ts)
  assert.equal(d.getHours(), 11)
  assert.equal(d.getMinutes(), 54)
  assert.equal(d.getDate(), 24)
})

test("parseDate applies PM meridiem", () => {
  const d = new Date(parseDate("Sep 24, 2026, 11:54 PM"))
  assert.equal(d.getHours(), 23)
})

test("time-of-day prevents wrongly rejecting in-window ads", () => {
  const fourDaysAgo = new Date(Date.now() - 4 * 86400000)
  fourDaysAgo.setHours(23, 0, 0, 0)
  assert.equal(isWithinWindow(fourDaysAgo.getTime(), 5), true, "23:00 four days ago is inside a 5-day window")
  const floored = new Date(fourDaysAgo)
  floored.setHours(0, 0, 0, 0)
  assert.equal(isWithinWindow(floored.getTime(), 5), true)
})

test("bare dates still parse to midnight", () => {
  for (const s of ["2026-09-24", "24/09/2026", "Sep 24, 2026"]) {
    const d = new Date(parseDate(s))
    assert.equal(d.getHours(), 0, s)
    assert.equal(d.getDate(), 24, s)
  }
})

test("relative dates still resolve", () => {
  for (const [s, maxMs] of [["today", 1000], ["yesterday", 2 * 86400000], ["3 days ago", 4 * 86400000]]) {
    const diff = Date.now() - parseDate(s)
    assert.ok(diff >= 0 && diff <= maxMs, `${s} → ${diff}ms`)
  }
})

test("regionGate rejects an off-region ad that mentions Saudi Arabia", () => {
  const ad = "Saudi Arabia, Jeddah. We are hiring a Senior Planning Engineer for our mega project. Contact hr@company.com"
  const g = regionGate(ad)
  assert.equal(g.ok, false, `got ${JSON.stringify(g)}`)
})

test("regionGate accepts a Riyadh ad that also says Saudi Arabia", () => {
  assert.equal(regionGate("Riyadh, Saudi Arabia — Planning Engineer").ok, true)
  assert.equal(regionGate("الرياض، المملكة العربية السعودية — مهندس تخطيط").ok, true)
})