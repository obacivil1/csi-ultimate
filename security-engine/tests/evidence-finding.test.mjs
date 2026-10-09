/** Phase 1 §25 — evidence traceability + finding lifecycle and separation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEvidence, EXCERPT_LIMIT } from "../models/evidence.mjs";
import { createFinding, transitionFinding } from "../models/finding.mjs";

const grading = (level = "medium") => ({ level, score: 0.6, reasons: ["repeated"], rationale: "why" });

function candidate(over = {}) {
  return createFinding({
    finding_type: "authorization",
    title: "cross-tenant read",
    expected_boundary: "tenant A must not read tenant B",
    observed_behavior: "200 with tenant B body hash",
    security_relevance: "confidentiality boundary crossed",
    confidence: grading(),
    impact: { level: "high", rationale: "tenant data" },
    severity: { level: "high", rationale: "exploitable" },
    scope_status: { decision: "allow", reference: "scope:lab-01" },
    ...over,
  });
}

test("evidence: bound to observation, hash preserved, truncation explicit", () => {
  assert.throws(() => createEvidence({ type: "hash-only", hash: "ab" }), /observation_id/);
  const long = "x".repeat(EXCERPT_LIMIT + 100);
  const e = createEvidence({ observation_id: "obs_1", type: "redacted-excerpt", description: long, redaction_status: "redacted" });
  assert.equal(e.truncated, true);
  assert.equal(e.description.length, EXCERPT_LIMIT);
  assert.equal(e.hash.length, 64);
  // Hash is over the FULL source, not the excerpt.
  const short = createEvidence({ observation_id: "obs_1", type: "hash-only", description: "abc" });
  assert.equal(short.truncated, false);
  assert.equal(short.hash_source, "computed");
});

test("finding: required boundary fields enforced", () => {
  assert.throws(() => candidate({ expected_boundary: "" }), /expected_boundary/);
  assert.throws(() => candidate({ confidence: { level: "high", score: 1.5, reasons: [], rationale: "x" } }), /score/);
  assert.throws(() => candidate({ impact: { level: "high" } }), /rationale/);
  assert.throws(() => candidate({ scope_status: { decision: "maybe" } }), /scope_status/);
});

test("finding: confidence / impact / severity stay separate", () => {
  const f = candidate({
    confidence: { level: "low", score: 0.2, reasons: ["single-run"], rationale: "weak" },
    impact: { level: "critical", rationale: "admin takeover" },
    severity: { level: "medium", rationale: "needs auth" },
  });
  assert.equal(f.confidence.level, "low");
  assert.equal(f.impact.level, "critical");
  assert.equal(f.severity.level, "medium");
  assert.notDeepEqual(Object.keys(f.confidence).sort(), Object.keys(f.severity).sort());
});

test("finding: lifecycle — validated needs evidence + reproduction + reason", () => {
  const c = candidate();
  assert.throws(() => transitionFinding(c, "validated", { reason: "looks bad" }), (e) => e?.code === "LIFECYCLE");
  const withEv = candidate({ evidence_references: ["ev_1"], reproduction_reference: "repro:01" });
  const v = transitionFinding(withEv, "validated", { reason: "reproduced twice" });
  assert.equal(v.status, "validated");
  assert.equal(v.status_history.length, 1);
  assert.equal(c.status, "candidate"); // immutable: original untouched
  assert.throws(() => transitionFinding(v, "rejected", { reason: "x" }), (e) => e?.code === "LIFECYCLE");
  assert.throws(() => transitionFinding(c, "rejected", { reason: "" }), /reason/);
  const r = transitionFinding(c, "rejected", { reason: "duplicate of known behavior" });
  assert.equal(r.status, "rejected");
});
