/** Phase 3 semantics — verdict discipline, boundary precedence, grading. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyOutcome,
  deriveExpectedBoundary,
  evaluateCrossing,
  gradeConfidence,
  UNKNOWN_IMPACT,
  UNKNOWN_SEVERITY,
} from "../authorization/semantics.mjs";

test("classify: only 2xx ALLOW, only 401/403 DENY, rest AMBIGUOUS", () => {
  assert.equal(classifyOutcome({ status: 200 }).outcome, "ALLOW");
  assert.equal(classifyOutcome({ status: 201 }).outcome, "ALLOW");
  assert.equal(classifyOutcome({ status: 401 }).outcome, "DENY");
  assert.equal(classifyOutcome({ status: 403 }).outcome, "DENY");
  for (const s of [302, 404, 429, 500, 502]) {
    assert.equal(classifyOutcome({ status: s }).outcome, "AMBIGUOUS", `status ${s}`);
  }
  assert.throws(() => classifyOutcome({}), (e) => e?.code === "AUTHZ_VALIDATION");
  assert.throws(() => classifyOutcome({ status: "200" }), (e) => e?.code === "AUTHZ_VALIDATION");
});

test("derive: explicit rules win; ownership/tenant mismatch infers; else unknown", () => {
  const sub = { identity_id: "idn_b", role: "member", tenant_id: "tenant-a" };
  const manifest = {
    rules: [{ dimension: "object-level", when: { role: "member" }, boundary: "members read only own docs" }],
  };
  const ruled = deriveExpectedBoundary({ dimension: "object-level", subject: sub, manifest });
  assert.deepEqual([ruled.statement, ruled.source, ruled.applies], ["members read only own docs", "explicit-rules", true]);
  const inferred = deriveExpectedBoundary({
    dimension: "object-level",
    subject: sub,
    resource: { resource_id: "r", owner_identity: "idn_a", tenant_id: "tenant-a" },
    manifest: { rules: [{ dimension: "object-level", when: { role: "admin" }, boundary: "x" }] },
  });
  assert.deepEqual([inferred.source, inferred.applies], ["conservative-inference", true]);
  const tenant = deriveExpectedBoundary({
    dimension: "cross-tenant",
    subject: sub,
    resource: { resource_id: "r", owner_identity: "idn_x", tenant_id: "tenant-b" },
  });
  assert.equal(tenant.source, "conservative-inference");
  const observed = deriveExpectedBoundary({ dimension: "vertical", subject: sub, observedDeny: true });
  assert.equal(observed.source, "observed-denial");
  const unknown = deriveExpectedBoundary({ dimension: "vertical", subject: sub });
  assert.deepEqual([unknown.statement, unknown.source, unknown.applies], [null, "unknown", false]);
  assert.throws(() => deriveExpectedBoundary({ dimension: "nope", subject: sub }), /dimension/);
});

test("derive: no URL-keyword guessing — admin-looking endpoint without manifest is unknown", () => {
  const sub = { identity_id: "idn_b", role: "member", tenant_id: "tenant-a" };
  const d = deriveExpectedBoundary({ dimension: "function-level", subject: sub, endpoint_id: "ep_admin_console" });
  assert.equal(d.source, "unknown");
  const listed = deriveExpectedBoundary({
    dimension: "function-level",
    subject: sub,
    endpoint_id: "ep_admin_console",
    manifest: { privileged_functions: ["ep_admin_console"] },
  });
  assert.deepEqual([listed.source, listed.applies], ["explicit-rules", true]);
});

test("evaluate: crossing needs subject-ALLOW plus applying boundary", () => {
  const applying = { statement: "b", source: "conservative-inference", applies: true };
  const cross = evaluateCrossing({ dimension: "object-level", referenceOutcome: "ALLOW", subjectOutcome: "ALLOW", boundary: applying });
  assert.equal(cross.verdict, "BOUNDARY-CROSSING");
  const within = evaluateCrossing({ dimension: "object-level", referenceOutcome: "ALLOW", subjectOutcome: "DENY", boundary: applying });
  assert.equal(within.verdict, "WITHIN-BOUNDARY");
  const amb = evaluateCrossing({ dimension: "object-level", referenceOutcome: "ALLOW", subjectOutcome: "AMBIGUOUS", boundary: applying });
  assert.equal(amb.verdict, "INCONCLUSIVE");
  const unknown = evaluateCrossing({
    dimension: "object-level",
    referenceOutcome: "ALLOW",
    subjectOutcome: "ALLOW",
    boundary: { statement: null, source: "unknown", applies: false },
  });
  assert.equal(unknown.verdict, "INCONCLUSIVE");
  assert.throws(
    () => evaluateCrossing({ dimension: "object-level", referenceOutcome: "OK", subjectOutcome: "ALLOW", boundary: applying }),
    /referenceOutcome/
  );
});

test("grade: fixed evidence-derived table; impact/severity stay unknown", () => {
  const hi = gradeConfidence({ source: "explicit-rules", dimension: "object-level" });
  assert.deepEqual([hi.level, hi.score], ["high", 0.9]);
  const mid = gradeConfidence({ source: "conservative-inference", dimension: "cross-tenant" });
  assert.deepEqual([mid.level, mid.score], ["medium", 0.6]);
  assert.ok(mid.reasons.length >= 2 && mid.rationale.length > 0);
  assert.throws(() => gradeConfidence({ source: "unknown", dimension: "object-level" }), (e) => e?.code === "AUTHZ_VALIDATION");
  assert.deepEqual([UNKNOWN_IMPACT.level, UNKNOWN_SEVERITY.level], ["unknown", "unknown"]);
  assert.ok(UNKNOWN_IMPACT.rationale.length > 0 && UNKNOWN_SEVERITY.rationale.length > 0);
});
