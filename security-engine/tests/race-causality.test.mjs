/** Phase 4 causality — every non-causal case fails closed to INCONCLUSIVE/WITHIN. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentity, createSession, bindSession } from "../models/identity.mjs";
import { createAuthenticatedContext } from "../execution/context.mjs";
import { createExecution } from "../execution/contract.mjs";
import { executeRaceRun, confirmOrdering, adjudicateRace } from "../race/runs.mjs";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const SCOPE = { decision: "allow" };
const BUDGET = { maxRequests: 60, timeoutMs: 2000 };
const DESC_AMT = { endpoint_id: "ep_vault", method: "POST", params_metadata: [{ name: "amount", location: "body" }] };
const mkIdn = (id) => createIdentity({ identity_id: id, label: id });
const mkCtx = (idn, sid) => {
  const ses = bindSession(createSession({ session_id: sid, target_id: "tgt_1" }), idn);
  const exec = createExecution({ correlation_id: "corr_t", target: { target_id: "tgt_1" }, scopeDecision: { ...SCOPE, reason: "t", checks: [], target_id: "tgt_1", correlation_id: "corr_t" }, budget: { maxRequests: 60, timeoutMs: 5000 } });
  return createAuthenticatedContext({ execution: exec, identity: idn, session: ses, nowMs: NOW });
};
function makeVault(initial = 100) {
  let balance = initial;
  const granted = {};
  return {
    async reset() { balance = initial; for (const k of Object.keys(granted)) delete granted[k]; return { reset: true, initial_state: { balance: initial } }; },
    async snapshot() { return { balance, granted: { ...granted } }; },
    withdraw: async ({ participant_id, bindings }) => {
      const g = Math.min(bindings.amount, balance);
      balance -= g;
      granted[participant_id] = (granted[participant_id] || 0) + g;
      return { status: "complete", attemptCount: 1, state_digest: { balance } };
    },
  };
}
const partsOf = (vault, amt = 60) => {
  const a = mkIdn("idn_a", "A");
  const b = mkIdn("idn_b", "B");
  const mk = (idn, sid) => ({ context: mkCtx(idn, sid), operation: vault.withdraw, descriptor: DESC_AMT, bindings: { amount: amt }, transport: { retries: 0 } });
  return [mk(a, "ses_a"), mk(b, "ses_b")];
};
const BOUND = { statement: "owner-only access", source: "conservative-inference", applies: true };
const RES = { resource_id: "res_doc7", owner_identity: "idn_owner", tenant_id: "tenant-a", type: "document" };
const runOrdering = (vault, order, boundary = BOUND, resource = RES) => confirmOrdering({
  name: order,
  repetitions: 2,
  budget: { ...BUDGET },
  runOnce: async ({ tracker }) => executeRaceRun({
    participants: partsOf(vault),
    fixture: vault,
    hooks: null,
    budget: tracker,
    scope: SCOPE,
    release_order: order === "ba" ? ["idn_b|ses_b", "idn_a|ses_a"] : null,
  }),
}).then((c) => ({ ordering: order, ...c }));
const adj = (confs, boundary = BOUND, resource = RES, claim = "race") =>
  adjudicateRace({ orderings: confs, boundary, resource, claim });

test("legitimate transition without boundary is INCONCLUSIVE, not a finding", async () => {
  const ab = await runOrdering(makeVault(), "ab");
  const ba = await runOrdering(makeVault(), "ba");
  assert.equal(ab.unanimous, true);
  // Same actor owns the resource: no mismatch, no manifest — unknown boundary.
  const out = adj([ab, ba], { statement: null, source: "unknown", applies: false });
  assert.equal(out.verdict, "INCONCLUSIVE");
});

test("response-only differences without state transition stay WITHIN", async () => {
  const fx = makeVault();
  const noisy = async ({ participant_id, bindings }) => {
    const r = await fx.withdraw({ participant_id, bindings });
    return { ...r, note: `seen-by-${participant_id}` };
  };
  const a = mkIdn("idn_a", "A");
  const b = mkIdn("idn_b", "B");
  const mk = (idn, sid) => ({ context: mkCtx(idn, sid), operation: noisy, descriptor: DESC_AMT, bindings: { amount: 0 }, transport: { retries: 0 } });
  const run = (order) => confirmOrdering({
    name: order,
    repetitions: 2,
    budget: { ...BUDGET },
    runOnce: async ({ tracker }) => executeRaceRun({ participants: [mk(a, "ses_a"), mk(b, "ses_b")], fixture: fx, hooks: null, budget: tracker, scope: SCOPE }),
  });
  const ab = await run("ab");
  const ba = await run("ba");
  assert.equal(ab.unanimous, true);
  // Extra per-response fields change nothing: signatures agree → WITHIN.
  assert.equal(adj([ab, ba]).verdict, "WITHIN-BOUNDARY");
});

test("eventual consistency (disagreeing runs) is INCONCLUSIVE", async () => {
  let n = 0;
  const flip = { async reset() { return { reset: true, initial_state: {} }; }, async snapshot() { n += 1; return { tick: n }; } };
  const a = mkIdn("idn_a", "A");
  const b = mkIdn("idn_b", "B");
  const mk = (idn, sid) => ({ context: mkCtx(idn, sid), operation: async () => ({ status: "complete", attemptCount: 1 }), descriptor: { endpoint_id: "ep_x", method: "GET" }, bindings: {}, transport: { retries: 0 } });
  const out = await confirmOrdering({
    name: "flip",
    repetitions: 2,
    budget: { ...BUDGET },
    runOnce: async ({ tracker }) => executeRaceRun({ participants: [mk(a, "ses_a"), mk(b, "ses_b")], fixture: flip, hooks: null, budget: tracker, scope: SCOPE }),
  });
  assert.equal(out.unanimous, false);
  assert.equal(adj([{ ordering: "flip", ...out }]).verdict, "INCONCLUSIVE");
});

test("hook success without differential is not a candidate", async () => {
  const ab = await runOrdering(makeVault(), "ab");
  const ba = await runOrdering(makeVault(), "ab");
  const out = adj([ab, ba]);
  assert.equal(out.verdict, "WITHIN-BOUNDARY");
});

test("no-boundary and no-reset cases fail closed", async () => {
  const ab = await runOrdering(makeVault(), "ab");
  const ba = await runOrdering(makeVault(), "ba");
  const noBoundary = adj([ab, ba], { statement: null, source: "unknown", applies: false }, null);
  assert.equal(noBoundary.verdict, "INCONCLUSIVE");
  const noResetFx = { async reset() { return { reset: false }; }, async snapshot() { return {}; } };
  const a = mkIdn("idn_a", "A");
  const b = mkIdn("idn_b", "B");
  const mk = (idn, sid) => ({ context: mkCtx(idn, sid), operation: async () => ({ status: "complete", attemptCount: 1 }), descriptor: { endpoint_id: "ep_x", method: "GET" }, bindings: {}, transport: { retries: 0 } });
  const bad = await confirmOrdering({
    name: "noreset",
    repetitions: 2,
    budget: { ...BUDGET },
    runOnce: async ({ tracker }) => executeRaceRun({ participants: [mk(a, "ses_a"), mk(b, "ses_b")], fixture: noResetFx, hooks: null, budget: tracker, scope: SCOPE }),
  });
  assert.equal(bad.unanimous, false);
  assert.equal(adj([{ ordering: "noreset", ...bad }]).verdict, "INCONCLUSIVE");
});

test("dispatch-vs-processing divergence does not drive verdicts", async () => {
  const fx = makeVault();
  const slow = (ms, base) => async (args) => {
    await new Promise((r) => setTimeout(r, ms));
    return base(args);
  };
  const a = mkIdn("idn_a", "A");
  const b = mkIdn("idn_b", "B");
  const opA = slow(30, fx.withdraw);
  const opB = fx.withdraw;
  const mk = (idn, sid, op) => ({ context: mkCtx(idn, sid), operation: op, descriptor: DESC_AMT, bindings: { amount: 10 }, transport: { retries: 0 } });
  const rec = await executeRaceRun({
    participants: [mk(a, "ses_a", opA), mk(b, "ses_b", opB)],
    fixture: fx,
    hooks: null,
    budget: { ...BUDGET },
    scope: SCOPE,
  });
  assert.equal(rec.status, "complete");
  const dispatchOrder = rec.ordering.filter((e) => e.type === "dispatch").map((e) => e.participant_id);
  const completionOrder = rec.ordering.filter((e) => e.type === "completion").map((e) => e.participant_id);
  assert.deepEqual(dispatchOrder, ["idn_a|ses_a", "idn_b|ses_b"]);
  assert.deepEqual(completionOrder, ["idn_b|ses_b", "idn_a|ses_a"]);
});
