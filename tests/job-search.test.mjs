import { test } from "node:test"
import assert from "node:assert/strict"

import {
  PLANNING_RE,
  ROLE_PHRASE_RE,
  OTHER_CITY_RE,
  FOREIGN_CITY_RE,
  JOB_SEEKER_RE,
  TARGET_REGION_RE,
  isTargetRole,
  isPlanningAdjacent,
  isJobSeeker,
  isServiceOffer,
  isBlockedPage,
  regionGate,
  normalizeLoc,
  OFF_DOMAIN_RE,
  TARGET_ROLE_PHRASES,
} from "../core/job-scan.mjs"

import { scoreJobTitle } from "../n8n-workflow/pipeline.mjs"

const ROLE_TESTS = [
  ["Senior Planning Engineer", true],
  ["Senior Planning Lead", true],
  ["Senior Planning & Cost Control Lead", true],
  ["Senior Planning and Cost Control Lead", true],
  ["Project Control Lead", true],
  ["Senior Control Lead", true],
  ["Cost Control Engineer", true],
  ["Planning Engineer - HVAC", true],
  ["Senior Scheduler - Primavera P6", true],
  ["مهندس تخطيط", true],
  ["مدير تخطيط", true],
  ["مراقب تكاليف", true],
  ["Planning Engineer - Manama", true],
  ["Planning Manager - Jubail", true],
]

const NOT_ROLE_TESTS = [
  ["Urban Planner", false],
  ["Financial Planner", false],
  ["Marketing Manager", false],
  ["Accountant", false],
  ["Receptionist", false],
  ["Software Engineer", false],
  ["Mechanical Engineer", false],
  ["Site Engineer", false],
]

test("PLANNING_RE / ROLE_PHRASE_RE match planning/control titles", () => {
  for (const [title, expected] of ROLE_TESTS) {
    const got = ROLE_PHRASE_RE.test(title)
    assert.equal(got, expected, `ROLE_PHRASE_RE(${JSON.stringify(title)}) → ${got}, expected ${expected}`)
    assert.ok(PLANNING_RE.test(title), `PLANNING_RE should match ${title}`)
  }
})

test("isTargetRole accepts planning/control roles + rejects non-roles", () => {
  for (const [title] of ROLE_TESTS) {
    assert.ok(isTargetRole(title), `isTargetRole should accept: ${title}`)
  }
  for (const [title] of NOT_ROLE_TESTS) {
    assert.ok(!isTargetRole(title), `isTargetRole should reject: ${title}`)
  }
})

test("ROLE_PHRASE_RE accepts user's exact specialty titles", () => {
  const exact = [
    "Senior Planning & Cost Control Lead",
    "Senior Planning and Cost Control Lead",
    "Senior Planning Engineer",
    "Senior Control Lead",
    "Project Control Lead",
    "Senior Planning Lead",
    "Cost Control Lead",
  ]
  for (const t of exact) {
    assert.ok(ROLE_PHRASE_RE.test(t), `ROLE_PHRASE_RE should accept: ${t}`)
    assert.ok(isTargetRole(t), `isTargetRole should accept: ${t}`)
  }
})

test("pipeline scoring gates the exact titles", () => {
  for (const t of [
    "Senior Planning & Cost Control Lead",
    "Senior Planning Engineer",
    "Senior Control Lead",
    "Project Control Lead",
    "Planning Engineer - HVAC",
    "Senior Scheduler",
  ]) {
    const r = scoreJobTitle(t)
    assert.ok(r.approved, `should approve (score=${r.score}): ${t} | ${r.breakdown}`)
  }
  for (const t of [
    "Marketing Manager",
    "Accountant",
    "Software Engineer",
    "Receptionist",
    "Data Scientist",
  ]) {
    const r = scoreJobTitle(t)
    assert.ok(!r.approved, `should REJECT (score=${r.score}): ${t} | ${r.breakdown}`)
  }
})

test("regionGate rejects off-target Saudi cities that mention 'Saudi Arabia'", () => {
  for (const s of [
    "Saudi Arabia, Jeddah. We are hiring a Senior Planning Engineer",
    "Dammam - Eastern Province, Saudi Arabia",
    "Khobar, Saudi Arabia — Planning Engineer",
    "Tabuk, Saudi Arabia",
    "Jubail, Saudi Arabia",
  ]) {
    const g = regionGate(s)
    assert.equal(g.ok, false, `regionGate should reject: ${s} (got ${JSON.stringify(g)})`)
  }
})

test("regionGate rejects foreign-city ads, accepts Riyadh/Saudi", () => {
  assert.equal(regionGate("Location: Riyadh, Saudi Arabia").ok, true)
  assert.equal(regionGate("Riyadh - Saudi Arabia").ok, true)
  assert.equal(regionGate("Dammam - Eastern Province").ok, false)
  assert.equal(regionGate("Manama, Bahrain").ok, false)
  assert.equal(regionGate("Planning Engineer - Manama Jobs").ok, false)
  assert.equal(regionGate("Region: Jubail").ok, false)
  assert.equal(regionGate("Riyadh + Manama posting").ok, false, "foreign city must not sneak in even if Riyadh present")
  assert.equal(regionGate("").ok, true)
})

test("TARGET_REGION_RE matches Riyadh spellings only", () => {
  for (const s of ["Riyadh", "الرياض", "Riyadh, Saudi Arabia", "Near Riyadh"]) {
    assert.ok(TARGET_REGION_RE.test(s), `TARGET_REGION_RE should accept ${s}`)
  }
  for (const s of ["Saudi Arabia", "السعودية", "Jeddah, Saudi Arabia"]) {
    assert.ok(!TARGET_REGION_RE.test(s), `TARGET_REGION_RE must NOT accept generic: ${s}`)
  }
})

test("PLANNING_RE does not match p6 inside unrelated words", () => {
  for (const s of ["ap6lication form", "HELP6 desk", "SAP6 ERP", "Top6 sales positions", "shop6 offers"]) {
    assert.ok(!PLANNING_RE.test(s), `PLANNING_RE must not match ${s}`)
  }
  assert.ok(PLANNING_RE.test("Senior Scheduler - Primavera P6"), "P6 as a token must still match")
  assert.ok(PLANNING_RE.test("experienced in P6 scheduling"))
})

test("OTHER_CITY_RE blocks off-target cities", () => {
  for (const s of ["Manama", "Doha", "Dubai", "Kuwait", "Dammam", "Jeddah", "Jubail", "Bahrain"]) {
    assert.ok(OTHER_CITY_RE.test(s), `OTHER_CITY_RE should block ${s}`)
  }
})

test("isJobSeeker flags CV/posters, not company listings", () => {
  assert.equal(isJobSeeker("Planning Engineer job seekers"), true)
  assert.equal(isJobSeeker("باحث عن عمل تخطيط"), true)
  assert.equal(isJobSeeker("Job Seekers - Riyadh"), true)
  assert.equal(isJobSeeker("Planning Engineer vacancy - MEP"), false)
  assert.equal(isJobSeeker("Planning Engineer"), false)
})

test("isServiceOffer flags service/quantity-take-off ads, not genuine job posts", () => {
  assert.equal(isServiceOffer("Estimating Services Offer (Quantity Take-Off) & BBS (Bar Bending Schedule) Cutting List"), true)
  assert.equal(isServiceOffer("Quantity Take-Off and cost estimation services"), true)
  assert.equal(isServiceOffer("Planning Engineer vacancy - construction EPC"), false)
  assert.equal(isServiceOffer("URGENT HIRING – COST ESTIMATOR / ESTIMATION ENGINEER (Transferable Iqama)"), false)
  assert.equal(isServiceOffer("COST CONTROL ENGINEER"), false)
  assert.equal(isTargetRole("Estimating Services Offer (Quantity Take-Off) & BBS Cutting List"), false)
  assert.equal(isTargetRole("CAFM PLANNER - Facility Management"), false)
  assert.equal(isTargetRole("URGENT HIRING – COST ESTIMATOR / ESTIMATION ENGINEER"), true)
})

test("isBlockedPage rejects challenge pages but keeps short legit text", () => {
  assert.equal(isBlockedPage("Please enable JavaScript and try again"), true)
  assert.equal(isBlockedPage("Checking your browser before accessing."), true)
  assert.equal(isBlockedPage("just a moment..."), true)
  assert.equal(isBlockedPage("short"), false, "a short page is not a blocked page")
  assert.equal(isBlockedPage(""), true)
  assert.equal(isBlockedPage("Planning Engineer"), false)
  assert.equal(isBlockedPage(
    "Planning Engineer job with a full description of duties, responsibilities, and requirements in Riyadh, Saudi Arabia with relevant construction EPC contractor experience. " +
    "The candidate will be responsible for baseline schedules, progress reporting, cost monitoring, monthly reports, and coordinating with project controls teams across the program."), false)
})

test("FOREIGN_CITY_RE blocks foreign gulf cites regardless of target mention", () => {
  for (const s of ["Manama", "Doha", "Dubai", "Kuwait", "Bahrain", "Muscat", "Oman"]) {
    assert.ok(FOREIGN_CITY_RE.test(s), `FOREIGN_CITY_RE should block ${s}`)
  }
})

test("job-scan phrase list contains no empty/duplicate entries", () => {
  const seen = new Map()
  for (const p of TARGET_ROLE_PHRASES) {
    assert.ok(p && p.length > 0, `empty phrase: ${p}`)
    assert.equal(typeof p, "string")
    seen.set(p.toLowerCase(), (seen.get(p.toLowerCase()) || 0) + 1)
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
  assert.deepEqual(dups, [], `duplicate phrases: ${dups.join(", ")}`)
})

test("normalizeLoc collapses duplicated city names", () => {
  assert.equal(normalizeLoc("Riyadh (Riyadh)"), "Riyadh")
  assert.equal(normalizeLoc("  Riyadh  (Riyadh)"), "Riyadh")
  assert.equal(normalizeLoc("Riyadh"), "Riyadh")
  assert.equal(normalizeLoc("الرياض"), "الرياض")
  assert.equal(normalizeLoc(""), "")
  assert.equal(normalizeLoc(null), "")
})

test("normalizeLoc keeps a real district qualifier", () => {
  assert.equal(normalizeLoc("Riyadh (Utaiqah)"), "Riyadh (Utaiqah)")
  assert.equal(normalizeLoc("Riyadh (Al Olaya)"), "Riyadh (Al Olaya)")
  assert.equal(normalizeLoc("Jeddah"), "Jeddah")
})

test("OFF_DOMAIN_RE blocks non-construction trades, keeps EPC planning roles", () => {
  for (const s of [
    "COST ESTIMATOR / ESTIMATION ENGINEER (Exp. In Events, Fit-Out, Signage, Advertising)",
    "Cost Estimator - Exhibition & Events",
    "Signage Estimator",
    "Store Manager - Retail",
    "Front Desk Receptionist",
  ]) {
    assert.ok(OFF_DOMAIN_RE.test(s), `OFF_DOMAIN_RE should block ${s}`)
  }
  for (const s of [
    "COST CONTROL ENGINEER",
    "HIRING COST ESTIMATOR for Construction EPC projects",
    "Cost Estimator required for building construction",
    "Senior Planning Engineer - mega project",
    "Planning Manager",
  ]) {
    assert.ok(!OFF_DOMAIN_RE.test(s), `OFF_DOMAIN_RE must not block ${s}`)
  }
})

test("isPlanningAdjacent is a true superset of isTargetRole", () => {
  for (const p of TARGET_ROLE_PHRASES) {
    assert.ok(isPlanningAdjacent(p), `isPlanningAdjacent should accept phrase: ${p}`)
  }
})