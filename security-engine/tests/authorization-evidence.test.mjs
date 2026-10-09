/** Phase 3 T4/T5/T7 — evidence pack completeness, secret hygiene, negatives. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentity, createSession, bindSession } from "../models/identity.mjs";
import { createExecution } from "../execution/contract.mjs";
import { createAuthenticatedContext } from "../execution/context.mjs";
import { createSecurityResponse } from "../models/http.mjs";
import { analyzeComparison } from "../authorization/comparison.mjs";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const ALLOW_SCOPE = { decision: "allow", reason: "test", checks: [], target_id: "tgt_1", correlation_id: "corr_t" };
const mkIdn = (identity_id, label, role, tenant_id = "tenant-a") =>
  createIdentity({ identity_id, label, role, tenant_id });
const mkCtx = (idn, sid) => {
  const ses = bindSession(createSession({ session_id: sid, target_id: "tgt_1" }), idn);
  const exec = createExecution({ correlation_id: "corr_t", target: { target_id: "tgt_1" }, scopeDecision: ALLOW_SCOPE, budget: { maxRequests: 50, timeoutMs: 60000 } });
  return createAuthenticatedContext({ execution: exec, identity: idn, session: ses, nowMs: NOW });
};
const owner = mkIdn("idn_owner", "Owner", "member");
const peer = mkIdn("idn_peer", "Peer", "member");
const res = { resource_id: "res_doc7", owner_identity: "idn_owner", tenant_id: "tenant-a", type: "document" };
const crossing = () => analyzeComparison({
  dimension: "object-level",
  reference: { actor: { identity_id: "idn_owner", role: "member", tenant_id: "tenant-a" }, context: mkCtx(owner, "ses_o"), response: createSecurityResponse({ status: 200, body: "{}" }) },
  subject: { actor: { identity_id: "idn_peer", role: "member", tenant_id: "tenant-a" }, context: mkCtx(peer, "ses_p"), response: createSecurityResponse({ status: 200, body: "{}" }) },
  resource: res,
  endpoint_id: "ep_docs",
  target_id: "tgt_1",
  scope: ALLOW_SCOPE,
});

test("T4 — candidate pack: all 13 fields present and non-vacuous", () => {
  const { candidate: c, evidence } = crossing();
  assert.ok(c);
  assert.ok(c.title && c.expected_boundary && c.observed_behavior && c.security_relevance);
  assert.ok(c.state_before && c.state_after);
  assert.ok(c.confidence.score >= 0 && c.confidence.level && c.confidence.reasons.length && c.confidence.rationale);
  assert.ok(c.impact.level && c.impact.rationale && c.severity.level && c.severity.rationale);
  assert.ok(c.scope_status && c.scope_status.decision === "allow");
  assert.deepEqual(c.identity_references, ["idn_peer", "idn_owner"]);
  assert.equal(c.resource_reference, "res_doc7");
  assert.equal(c.endpoint_reference, "ep_docs");
  assert.equal(c.evidence_references.length, 3);
  assert.deepEqual(c.evidence_references, evidence.map((e) => e.evidence_id));
  assert.equal(c.reproduction_reference, null);
  assert.equal(c.status, "candidate");
  assert.deepEqual(c.status_history, []);
});

test("T5 — planted credential/response material appears nowhere", () => {
  const evil = (status) => createSecurityResponse({
    status,
    headers: { Authorization: "Bearer s3cr3t-AAA", "X-Key": "XKEY-999" },
    body: "password=hunter2-BBB",
    state_indicators: ["sess=CCC", "token=EEE"],
  });
  const out = analyzeComparison({
    dimension: "object-level",
    reference: { actor: { identity_id: "idn_owner", role: "member", tenant_id: "tenant-a" }, context: mkCtx(owner, "ses_o2"), response: evil(200) },
    subject: { actor: { identity_id: "idn_peer", role: "member", tenant_id: "tenant-a" }, context: mkCtx(peer, "ses_p2"), response: evil(200) },
    resource: res,
  });
  assert.equal(out.verdict, "BOUNDARY-CROSSING");
  const dumped = JSON.stringify({ o: out.observation, e: out.evidence, c: out.candidate });
  for (const secret of ["s3cr3t-AAA", "XKEY-999", "hunter2-BBB", "sess=CCC", "token=EEE"]) {
    assert.ok(!dumped.includes(secret), `leaked: ${secret}`);
  }
});

test("T7 — safe fixtures: zero candidates, zero validated, counts reported", () => {
  const denyResp = (s) => createSecurityResponse({ status: s, body: "{}" });
  const runs = [
    analyzeComparison({
      dimension: "object-level",
      reference: { actor: { identity_id: "idn_owner", role: "member", tenant_id: "tenant-a" }, context: mkCtx(owner, "ses_o3"), response: denyResp(200) },
      subject: { actor: { identity_id: "idn_peer", role: "member", tenant_id: "tenant-a" }, context: mkCtx(peer, "ses_p3"), response: denyResp(403) },
      resource: res,
    }),
    analyzeComparison({
      dimension: "horizontal",
      reference: { actor: { identity_id: "idn_owner", role: "member", tenant_id: "tenant-a" }, context: mkCtx(owner, "ses_o4"), response: denyResp(403) },
      subject: { actor: { identity_id: "idn_peer", role: "member", tenant_id: "tenant-a" }, context: mkCtx(peer, "ses_p4"), response: denyResp(403) },
      resource: res,
    }),
    analyzeComparison({
      dimension: "vertical",
      reference: { actor: { identity_id: "idn_owner", role: "member", tenant_id: "tenant-a" }, context: mkCtx(owner, "ses_o5"), response: denyResp(200) },
      subject: { actor: { identity_id: "idn_peer", role: "member", tenant_id: "tenant-a" }, context: mkCtx(peer, "ses_p5"), response: denyResp(200) },
      resource: { resource_id: "res_x", type: "console" },
    }),
  ];
  const verdicts = runs.map((r) => r.verdict);
  assert.deepEqual(verdicts, ["WITHIN-BOUNDARY", "WITHIN-BOUNDARY", "INCONCLUSIVE"]);
  const candidates = runs.map((r) => r.candidate).filter(Boolean);
  assert.equal(candidates.length, 0);
  const validated = candidates.filter((c) => c.status === "validated");
  assert.equal(validated.length, 0);
});
