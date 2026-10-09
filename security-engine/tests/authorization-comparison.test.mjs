/** Phase 3 T1/T2/T6 + refusals + lifecycle — comparison pipeline. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentity, createSession, bindSession } from "../models/identity.mjs";
import { createExecution } from "../execution/contract.mjs";
import { createAuthenticatedContext } from "../execution/context.mjs";
import { createSecurityRequest, createSecurityResponse } from "../models/http.mjs";
import { transitionFinding } from "../models/finding.mjs";
import { analyzeComparison } from "../authorization/comparison.mjs";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const ALLOW_SCOPE = { decision: "allow", reason: "test", checks: [], target_id: "tgt_1", correlation_id: "corr_t" };
const mkIdn = (identity_id, label, role, tenant_id = "tenant-a") =>
  createIdentity({ identity_id, label, role, tenant_id });
const mkSes = (sid, idn) => bindSession(createSession({ session_id: sid, target_id: "tgt_1" }), idn);
const mkExec = () =>
  createExecution({ correlation_id: "corr_t", target: { target_id: "tgt_1" }, scopeDecision: ALLOW_SCOPE, budget: { maxRequests: 50, timeoutMs: 60000 } });
const mkCtx = (idn, ses) =>
  createAuthenticatedContext({ execution: mkExec(), identity: idn, session: ses, nowMs: NOW });
const mkResp = (status, over = {}) =>
  createSecurityResponse({ status, headers: { "Content-Type": "application/json" }, body: `{"s":${status}}`, state_indicators: [], timing_ms: 10, ...over });
const actorOf = (idn) => ({ identity_id: idn.identity_id, role: idn.role, tenant_id: idn.tenant_id });

const owner = mkIdn("idn_owner", "Owner", "member");
const peer = mkIdn("idn_peer", "Peer", "member");
const res = { resource_id: "res_doc7", owner_identity: "idn_owner", tenant_id: "tenant-a", type: "document" };
const side = (idn, ses, status, over = {}) => ({
  actor: actorOf(idn),
  context: ses ? mkCtx(idn, ses) : null,
  response: mkResp(status, over.response || {}),
  ...(over.request_id ? { request_id: over.request_id } : {}),
});
const sesOwner = mkSes("ses_o", owner);
const sesPeer = mkSes("ses_p", peer);

test("T1a — owner ALLOW + peer DENY on owned resource: WITHIN-BOUNDARY, no candidate", () => {
  const out = analyzeComparison({
    dimension: "object-level",
    reference: side(owner, sesOwner, 200),
    subject: side(peer, sesPeer, 403),
    resource: res,
    endpoint_id: "ep_docs",
    target_id: "tgt_1",
  });
  assert.equal(out.verdict, "WITHIN-BOUNDARY");
  assert.equal(out.candidate, null);
  assert.equal(out.evidence.length, 2);
  assert.deepEqual(out.observation.signals, [
    "dimension:object-level",
    "reference:ALLOW",
    "subject:DENY",
    "boundary:conservative-inference",
    "verdict:WITHIN-BOUNDARY",
  ]);
});

test("T1b — owner ALLOW + peer ALLOW on peer-owned resource: candidate with full pack", () => {
  const req = createSecurityRequest({ method: "GET", url: "https://example.com/api/docs/7" });
  const subResp = mkResp(200);
  const out = analyzeComparison({
    dimension: "object-level",
    reference: side(owner, sesOwner, 200),
    subject: { actor: actorOf(peer), context: mkCtx(peer, sesPeer), response: subResp, request_id: req.request_id },
    resource: res,
    endpoint_id: "ep_docs",
    target_id: "tgt_1",
  });
  assert.equal(out.verdict, "BOUNDARY-CROSSING");
  assert.equal(out.evidence.length, 3);
  assert.equal(out.candidate.status, "candidate");
  assert.equal(out.observation.request_reference, req.request_id);
  assert.equal(out.observation.response_reference, subResp.response_id);
});

test("T1c — anonymous baseline: 401 is within-boundary; opt-in enforced", () => {
  const anon = { actor: { identity_id: "anon", role: "anonymous", tenant_id: null }, context: null, response: mkResp(401) };
  const out = analyzeComparison({
    dimension: "object-level",
    reference: side(owner, sesOwner, 200),
    subject: anon,
    resource: res,
    allowAnonymousSubject: true,
  });
  assert.equal(out.verdict, "WITHIN-BOUNDARY");
  assert.throws(
    () => analyzeComparison({ dimension: "object-level", reference: side(owner, sesOwner, 200), subject: anon, resource: res }),
    (e) => e?.code === "ANONYMOUS_NOT_ALLOWED"
  );
  const anonRef = { actor: actorOf(owner), context: null, response: mkResp(200) };
  assert.throws(
    () => analyzeComparison({ dimension: "object-level", reference: anonRef, subject: side(peer, sesPeer, 200), resource: res, allowAnonymousSubject: true }),
    (e) => e?.code === "ANONYMOUS_NOT_ALLOWED"
  );
});

test("T1d — cross-tenant ALLOW: candidate via conservative inference", () => {
  const tb = mkIdn("idn_tb", "Tenant-B-User", "member", "tenant-b");
  const out = analyzeComparison({
    dimension: "cross-tenant",
    reference: side(owner, sesOwner, 200),
    subject: side(tb, mkSes("ses_tb", tb), 200),
    resource: res,
  });
  assert.equal(out.verdict, "BOUNDARY-CROSSING");
  assert.equal(out.boundary.source, "conservative-inference");
  assert.ok(out.candidate.finding_id);
});

test("T2 — unknown boundary with subject ALLOW: INCONCLUSIVE, zero candidates", () => {
  const out = analyzeComparison({
    dimension: "vertical",
    reference: side(owner, sesOwner, 200),
    subject: side(peer, sesPeer, 200),
    resource: { resource_id: "res_x", type: "console" },
  });
  assert.equal(out.verdict, "INCONCLUSIVE");
  assert.equal(out.candidate, null);
});

test("refusals: mismatched context, contextless session, bad dimension", () => {
  // A hand-built context bypasses Phase 2 construction, so the comparison's
  // own guard must catch the mismatch (real Phase 2 contexts refuse earlier).
  const fakeCtx = { identity_id: "idn_owner", session_id: "ses_p", context_id: "ctx_fake" };
  assert.throws(
    () => analyzeComparison({
      dimension: "object-level",
      reference: { actor: actorOf(owner), context: mkCtx(owner, sesOwner), response: mkResp(200) },
      subject: { actor: actorOf(peer), context: fakeCtx, response: mkResp(200) },
      resource: res,
    }),
    (e) => e?.code === "CONTEXT_ACTOR_MISMATCH"
  );
  const noSes = { actor: actorOf(peer), context: { identity_id: "idn_peer", context_id: "ctx_x" }, response: mkResp(200) };
  assert.throws(
    () => analyzeComparison({ dimension: "object-level", reference: side(owner, sesOwner, 200), subject: noSes, resource: res }),
    (e) => e?.code === "INVALID_CONTEXT"
  );
  assert.throws(
    () => analyzeComparison({ dimension: "nope", reference: side(owner, sesOwner, 200), subject: side(peer, sesPeer, 200) }),
    /dimension/
  );
});

test("lifecycle: candidate integrates without auto-validation", () => {
  const out = analyzeComparison({
    dimension: "object-level",
    reference: side(owner, sesOwner, 200),
    subject: side(peer, sesPeer, 200),
    resource: res,
  });
  const c = out.candidate;
  assert.ok(c.evidence_references.length >= 1);
  assert.throws(() => transitionFinding(c, "validated", { reason: "x" }), (e) => e?.code === "LIFECYCLE");
});

test("T6 — repeated runs are identical (verdicts + evidence hashes)", () => {
  const run = () => analyzeComparison({
    dimension: "object-level",
    reference: side(owner, mkSes("ses_o2", owner), 200),
    subject: side(peer, mkSes("ses_p2", peer), 200),
    resource: res,
  });
  const a = run();
  const b = run();
  assert.equal(a.verdict, b.verdict);
  assert.deepEqual(a.evidence.map((e) => e.hash), b.evidence.map((e) => e.hash));
});

test("observation linkage: actors, responses, shared correlation", () => {
  const out = analyzeComparison({
    dimension: "object-level",
    reference: side(owner, sesOwner, 200),
    subject: side(peer, sesPeer, 403),
    resource: res,
  });
  assert.equal(out.observation.identity_id, "idn_peer");
  assert.equal(out.observation.metadata.subject_actor, "idn_peer");
  assert.equal(out.observation.metadata.reference_actor, "idn_owner");
  assert.equal(out.correlation_id, out.observation.correlation_id);
});
