/** Phase 4 runs — repetition accounting, adjudication, reset/scope/budget gates. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentity, createSession, bindSession } from "../models/identity.mjs";
import { createAuthenticatedContext } from "../execution/context.mjs";
import { createExecution } from "../execution/contract.mjs";
import {
  executeRaceRun,
  confirmOrdering,
  adjudicateRace,
  createBudgetTracker,
  stableDigest,
} from "../race/runs.mjs";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const SCOPE = { decision: "allow" };
const BUDGET = { maxRequests: 50, timeoutMs: 2000 };
const DESC_AMT = { endpoint_id: "ep_vault", method: "POST", params_metadata: [{ name: "amount", location: "body" }] };
const mkIdn = (id) => createIdentity({ identity_id: id, label: id });
const mkCtx = (idn, sid) => {
  const ses = bindSession(createSession({ session_id: sid, target_id: "tgt_1" }), idn);
  const exec = createExecution({ correlation_id: "corr_t", target: { target_id: "tgt_1" }, scopeDecision: { ...SCOPE, reason: "t", checks: [], target_id: "tgt_1", correlation_id: "corr_t" }, budget: { maxRequests: 50, timeoutMs: 5000 } });
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
const runTwice = (vault, order) => confirmOrdering({
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
});

test("repetition: unanimous agreement with signature and spent accounting", async () => {
  const out = await runTwice(makeVault(), "ab");
  assert.equal(out.unanimous, true);
  assert.equal(out.reason, "unanimous");
  assert.ok(out.signature && out.signature.includes(">"));
  assert.equal(out.excluded.length, 0);
  assert.equal(out.runs.length, 2);
  assert.ok(out.runs[0].spent >= 2);
  assert.equal(out.trivial, false);
});

test("repetition: disagreement, N=1 ban, budget ceiling", async () => {
  const flip = { n: 0 };
  const out = await confirmOrdering({
    name: "flip",
    repetitions: 2,
    budget: { ...BUDGET },
    runOnce: async ({ tracker }) => {
      flip.n += 1;
      const fx = makeVault(flip.n === 1 ? 100 : 200);
      return executeRaceRun({ participants: partsOf(fx), fixture: fx, hooks: null, budget: tracker, scope: SCOPE });
    },
  });
  assert.equal(out.unanimous, false);
  assert.equal(out.reason, "disagreement-across-runs");
  await assert.rejects(
    confirmOrdering({ name: "x", repetitions: 1, budget: { ...BUDGET }, runOnce: async () => ({}) }),
    (e) => e?.code === "MODEL_VALIDATION"
  );
  const tracker = createBudgetTracker({ maxRequests: 4, timeoutMs: 2000 });
  assert.equal(tracker.tryConsume(2), true);
  assert.equal(tracker.tryConsume(2), true);
  assert.equal(tracker.tryConsume(1), false);
  assert.equal(tracker.spent(), 4);
  assert.throws(() => createBudgetTracker({ maxRequests: 0, timeoutMs: 1 }), (e) => e?.code === "MODEL_VALIDATION");
});

test("excluded runs recorded; budget exhaustion breaks unanimity explicitly", async () => {
  const out = await confirmOrdering({
    name: "tight",
    repetitions: 2,
    budget: { maxRequests: 2, timeoutMs: 2000 },
    runOnce: async ({ tracker }) => executeRaceRun({ participants: partsOf(makeVault()), fixture: makeVault(), hooks: null, budget: tracker, scope: SCOPE }),
  });
  assert.equal(out.unanimous, false);
  assert.equal(out.reason, "insufficient-valid-runs:1/2");
  assert.equal(out.excluded[0].status, "budget-exhausted");
});

test("adjudicate: non-unanimous, unknown boundary, trivial, identical, differing", () => {
  const applying = { ...BOUND };
  const conf = (over) => ({ ordering: "ab", unanimous: true, reason: "unanimous", signature: "s1", trivial: false, runs: [], excluded: [], ...over });
  assert.deepEqual(adjudicateRace({ orderings: [{ ...conf(), unanimous: false }], boundary: applying, claim: "race" }).verdict, "INCONCLUSIVE");
  assert.deepEqual(
    adjudicateRace({ orderings: [conf({ signature: "a" }), conf({ signature: "b" })], boundary: { statement: null, source: "unknown", applies: false }, claim: "race" }).verdict,
    "INCONCLUSIVE"
  );
  assert.deepEqual(
    adjudicateRace({ orderings: [conf({ signature: "x", trivial: true }), conf({ signature: "x", trivial: true })], boundary: applying, claim: "race" }).verdict,
    "WITHIN-BOUNDARY"
  );
  assert.deepEqual(
    adjudicateRace({ orderings: [conf({ signature: "x" }), conf({ signature: "x" })], boundary: applying, claim: "race" }).verdict,
    "WITHIN-BOUNDARY"
  );
  const cross = adjudicateRace({ orderings: [conf({ signature: "x" }), conf({ signature: "y" })], boundary: applying, claim: "race" });
  assert.equal(cross.verdict, "RACE-CANDIDATE");
  const tcross = adjudicateRace({
    orderings: [conf({ signature: "x", runs: [{ hooks: { supported: true, complete: true } }] }), conf({ signature: "y", runs: [{ hooks: { supported: true, complete: true } }] })],
    boundary: applying, claim: "toctou",
  });
  assert.equal(tcross.verdict, "TOCTOU-CANDIDATE");
  const tholed = adjudicateRace({
    orderings: [conf({ signature: "x", runs: [{ hooks: { supported: false } }] }), conf({ signature: "y", runs: [{ hooks: { supported: true, complete: true } }] })],
    boundary: applying, claim: "toctou",
  });
  assert.equal(tholed.verdict, "INCONCLUSIVE");
  const base = adjudicateRace({
    baseline: { signature: "z", status: "complete", resetAttestation: { valid: true } },
    orderings: [conf({ signature: "x" }), conf({ signature: "x" })],
    boundary: applying, claim: "race",
  });
  assert.equal(base.verdict, "RACE-CANDIDATE");
  assert.throws(() => adjudicateRace({ orderings: [], boundary: applying, claim: "race" }), (e) => e?.code === "MODEL_VALIDATION");
  assert.throws(() => adjudicateRace({ orderings: [conf()], boundary: applying, claim: "x" }), (e) => e?.code === "MODEL_VALIDATION");
});

test("reset and scope gates fail closed with explicit outcomes", async () => {
  const badReset = { async reset() { return { reset: false }; }, async snapshot() { return {}; } };
  const r1 = await executeRaceRun({ participants: partsOf(makeVault()), fixture: badReset, hooks: null, budget: { ...BUDGET }, scope: SCOPE });
  assert.equal(r1.status, "reset-invalid");
  const throwing = { async reset() { throw Object.assign(new Error("down"), { code: "FIX_DOWN" }); }, async snapshot() { return {}; } };
  const r2 = await executeRaceRun({ participants: partsOf(makeVault()), fixture: throwing, hooks: null, budget: { ...BUDGET }, scope: SCOPE });
  assert.equal(r2.status, "reset-invalid");
  const noInit = { async reset() { return { reset: true }; }, async snapshot() { return {}; } };
  const r3 = await executeRaceRun({ participants: partsOf(makeVault()), fixture: noInit, hooks: null, budget: { ...BUDGET }, scope: SCOPE });
  assert.equal(r3.status, "reset-invalid");
  await assert.rejects(
    executeRaceRun({ participants: partsOf(makeVault()), fixture: makeVault(), hooks: null, budget: { ...BUDGET }, scope: { decision: "deny", reason: "x" } }),
    (e) => e?.code === "SCOPE_DENIED"
  );
  await assert.rejects(
    executeRaceRun({ participants: [{ context: { identity_id: "a", session_id: "s" } }], fixture: makeVault(), hooks: null, budget: { ...BUDGET }, scope: SCOPE }),
    (e) => e?.code === "MODEL_VALIDATION"
  );
});

test("stableDigest deterministic across key order; differs on content", () => {
  assert.equal(stableDigest({ b: 1, a: 2 }), stableDigest({ a: 2, b: 1 }));
  assert.notEqual(stableDigest({ a: 1 }), stableDigest({ a: 2 }));
  assert.equal(stableDigest(null), stableDigest(undefined));
});

test("T-H1-1 — complete + reset-valid baseline preserves adjudication", () => {
  const conf = (over) => ({ ordering: "ab", unanimous: true, reason: "unanimous", signature: "s1", trivial: false, runs: [], excluded: [], ...over });
  const applying = { ...BOUND };
  const out = adjudicateRace({
    baseline: { signature: "z", status: "complete", resetAttestation: { valid: true } },
    orderings: [conf({ signature: "x" }), conf({ signature: "x" })],
    boundary: applying, claim: "race",
  });
  assert.equal(out.verdict, "RACE-CANDIDATE");
});

test("T-H1-2/3/4 — degraded baselines fail closed to INCONCLUSIVE", () => {
  const conf = (over) => ({ ordering: "ab", unanimous: true, reason: "unanimous", signature: "s1", trivial: false, runs: [], excluded: [], ...over });
  const applying = { ...BOUND };
  const mk = (baseline) => adjudicateRace({
    baseline,
    orderings: [conf({ signature: "x" }), conf({ signature: "x" })],
    boundary: applying, claim: "race",
  });
  // T-H1-2: timeout (and every other non-complete status) with differing signature.
  for (const status of ["timeout", "partial", "cancelled", "budget-exhausted"]) {
    const out = mk({ signature: "z", status, resetAttestation: { valid: true } });
    assert.equal(out.verdict, "INCONCLUSIVE", `status ${status}`);
    assert.ok(out.reasons.some((r) => r.startsWith("baseline-disregarded:baseline-status:")), `status ${status}`);
  }
  // T-H1-4: missing or malformed status is never treated as complete.
  for (const baseline of [{ signature: "z" }, { signature: "z", status: null }, { signature: "z", status: 42 }, { signature: "z", status: "COMPLETE" }]) {
    const out = mk(baseline);
    assert.equal(out.verdict, "INCONCLUSIVE", JSON.stringify(baseline));
  }
});

test("T-H1-5 — baseline without valid reset attestation cannot contribute", () => {
  const conf = (over) => ({ ordering: "ab", unanimous: true, reason: "unanimous", signature: "s1", trivial: false, runs: [], excluded: [], ...over });
  const applying = { ...BOUND };
  const mk = (baseline) => adjudicateRace({
    baseline,
    orderings: [conf({ signature: "x" }), conf({ signature: "x" })],
    boundary: applying, claim: "race",
  });
  for (const baseline of [
    { signature: "z", status: "complete" },
    { signature: "z", status: "complete", resetAttestation: null },
    { signature: "z", status: "complete", resetAttestation: { valid: false, reason: "reset-unsuccessful" } },
    { signature: "z", status: "complete", resetAttestation: { valid: "yes" } },
  ]) {
    const out = mk(baseline);
    assert.equal(out.verdict, "INCONCLUSIVE", JSON.stringify(baseline));
    assert.ok(out.reasons.some((r) => r === "baseline-disregarded:baseline-reset-invalid"), JSON.stringify(baseline));
  }
});
