/** Phase 3 T9 + per-dimension detectors — disabled by default, lab-only enabling. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentity, createSession, bindSession } from "../models/identity.mjs";
import { createExecution } from "../execution/contract.mjs";
import { createAuthenticatedContext } from "../execution/context.mjs";
import { createSecurityResponse } from "../models/http.mjs";
import { createRegistry } from "../registry/registry.mjs";
import { createAuthorizationDetectors } from "../authorization/detectors.mjs";
import { DIMENSIONS } from "../authorization/semantics.mjs";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const ALLOW_SCOPE = { decision: "allow", reason: "test", checks: [], target_id: "tgt_1", correlation_id: "corr_t" };
const mkIdn = (identity_id, label, role, tenant_id = "tenant-a") =>
  createIdentity({ identity_id, label, role, tenant_id });
const mkCtx = (idn) => {
  const ses = bindSession(createSession({ session_id: `ses_${idn.identity_id}`, target_id: "tgt_1" }), idn);
  const exec = createExecution({ correlation_id: "corr_t", target: { target_id: "tgt_1" }, scopeDecision: ALLOW_SCOPE, budget: { maxRequests: 50, timeoutMs: 60000 } });
  return createAuthenticatedContext({ execution: exec, identity: idn, session: ses, nowMs: NOW });
};
const mkResp = (status) =>
  createSecurityResponse({ status, headers: { "Content-Type": "application/json" }, body: `{"s":${status}}`, timing_ms: 5 });
const owner = mkIdn("idn_owner", "Owner", "member");
const peer = mkIdn("idn_peer", "Peer", "member");
const res = { resource_id: "res_doc7", owner_identity: "idn_owner", tenant_id: "tenant-a", type: "document" };
const actorOf = (idn) => ({ identity_id: idn.identity_id, role: idn.role, tenant_id: idn.tenant_id });
const pair = (refStatus, subStatus, over = {}) => ({
  reference: { actor: actorOf(owner), context: mkCtx(owner), response: mkResp(refStatus) },
  subject: { actor: actorOf(peer), context: mkCtx(peer), response: mkResp(subStatus) },
  resource: res,
  ...over,
});

test("T9 — detectors ship disabled; zero-detector operation intact", async () => {
  const defs = createAuthorizationDetectors();
  assert.equal(defs.length, 6);
  assert.ok(Object.isFrozen(defs));
  const reg = createRegistry();
  assert.deepEqual(reg.list(), []);
  const empty = await reg.executeAll({});
  assert.equal(empty.status, "not_ready");
  for (const def of defs) {
    const snap = reg.register(def);
    assert.equal(snap.status, "disabled");
    const out = await reg.execute(def.detector_id, pair(200, 403));
    assert.equal(out.status, "not_ready");
    assert.equal(out.reason, "detector-disabled");
  }
});

test("per-dimension execution after explicit in-test enabling", async () => {
  const reg = createRegistry();
  for (const def of createAuthorizationDetectors()) reg.register(def);
  const run = async (id, input) => {
    reg.enable(id);
    try {
      return await reg.execute(id, input);
    } finally {
      reg.disable(id);
    }
  };
  const obj = await run("authz-object-level", pair(200, 200));
  assert.equal(obj.status, "complete");
  assert.equal(obj.verdict, "BOUNDARY-CROSSING");
  assert.ok(obj.candidate_id && obj.observation_id && obj.evidence_count === 3);
  const fn = await run("authz-function-level", {
    ...pair(200, 200),
    manifest: { privileged_functions: ["ep_admin"] },
    endpoint_id: "ep_admin",
  });
  assert.equal(fn.verdict, "BOUNDARY-CROSSING");
  const ct = await run("authz-cross-tenant", {
    reference: pair(200, 403).reference,
    subject: {
      actor: { identity_id: "idn_tb", role: "member", tenant_id: "tenant-b" },
      context: mkCtx(mkIdn("idn_tb", "TB", "member", "tenant-b")),
      response: mkResp(200),
    },
    resource: res,
  });
  assert.equal(ct.verdict, "BOUNDARY-CROSSING");
  const hz = await run("authz-horizontal", pair(200, 200));
  assert.equal(hz.verdict, "BOUNDARY-CROSSING");
  const vt = await run("authz-vertical", {
    ...pair(200, 200),
    manifest: { rules: [{ dimension: "vertical", when: { role: "member" }, boundary: "members kept out of console" }] },
  });
  assert.equal(vt.verdict, "BOUNDARY-CROSSING");
  const md = await run("authz-method-drift", {
    ...pair(200, 200),
    manifest: { rules: [{ dimension: "method-drift", boundary: "methods share one policy" }] },
  });
  assert.equal(md.verdict, "BOUNDARY-CROSSING");
});

test("negative manifests stay inconclusive (no guessing without basis)", async () => {
  const reg = createRegistry();
  for (const def of createAuthorizationDetectors()) { reg.register(def); reg.enable(def.detector_id); }
  const vt = await reg.execute("authz-vertical", pair(200, 200));
  assert.equal(vt.verdict, "INCONCLUSIVE");
  assert.equal(vt.candidate_id, null);
  const md = await reg.execute("authz-method-drift", pair(200, 200));
  assert.equal(md.verdict, "INCONCLUSIVE");
  const dims = createAuthorizationDetectors().map((d) => d.dimension).sort().join(",");
  assert.equal(dims, [...DIMENSIONS].sort().join(","));
});
