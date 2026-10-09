/** Phase 4 R1 — attemptCount integrity: exactly 1 or INCONCLUSIVE-class. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentity, createSession, bindSession } from "../models/identity.mjs";
import { createAuthenticatedContext } from "../execution/context.mjs";
import { createExecution } from "../execution/contract.mjs";
import { createBarrier } from "../race/barrier.mjs";
import { executeRaceRun, confirmOrdering } from "../race/runs.mjs";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const SCOPE = { decision: "allow" };
const BUDGET = { maxRequests: 50, timeoutMs: 2000 };
const DESC = { endpoint_id: "ep_vault", method: "POST", params_metadata: [{ name: "amount", location: "body" }] };
const mkIdn = (id) => createIdentity({ identity_id: id, label: id });
const mkCtx = (idn, sid) => {
  const ses = bindSession(createSession({ session_id: sid, target_id: "tgt_1" }), idn);
  const exec = createExecution({ correlation_id: "corr_t", target: { target_id: "tgt_1" }, scopeDecision: { ...SCOPE, reason: "t", checks: [], target_id: "tgt_1", correlation_id: "corr_t" }, budget: { maxRequests: 50, timeoutMs: 5000 } });
  return createAuthenticatedContext({ execution: exec, identity: idn, session: ses, nowMs: NOW });
};
function makeVault() {
  let balance = 100;
  return {
    async reset() { balance = 100; return { reset: true, initial_state: { balance: 100 } }; },
    async snapshot() { return { balance }; },
  };
}
const parts = (op) => {
  const a = mkIdn("idn_a", "A");
  const b = mkIdn("idn_b", "B");
  const mk = (idn, sid) => ({ context: mkCtx(idn, sid), operation: op, descriptor: DESC, bindings: { amount: 10 }, transport: { retries: 0 } });
  return [mk(a, "ses_a"), mk(b, "ses_b")];
};
const baseRun = (participants, fixture) => ({
  participants, fixture, hooks: null, budget: { ...BUDGET }, scope: SCOPE,
});

test("R1 — retry-enabled transports rejected structurally at registration", () => {
  const b = createBarrier({ parties: 2, timeoutMs: 1000 });
  const a = mkIdn("idn_a", "A");
  const plain = { endpoint_id: "ep_probe", method: "GET" };
  assert.throws(
    () => b.register({ context: mkCtx(a, "ses_a"), operation: async () => ({}), descriptor: plain, bindings: {}, transport: { retries: 2 } }),
    (e) => e?.code === "BINDING_INVALID"
  );
  assert.throws(
    () => b.register({ context: mkCtx(a, "ses_a"), operation: async () => ({}), descriptor: plain, bindings: {}, transport: {} }),
    (e) => e?.code === "BINDING_INVALID"
  );
});

test("R1 — attemptCount 2 is an integrity failure, never a valid run", async () => {
  const fx = makeVault();
  const bad = async () => ({ status: "complete", attemptCount: 2, state_digest: {} });
  const rec = await executeRaceRun(baseRun(parts(bad), fx));
  assert.equal(rec.status, "integrity-failure");
  assert.equal(rec.integrity.reported_type, "number");
  assert.ok(rec.integrity.participant_id.includes("idn_"));
});

test("R1 — missing or malformed attemptCount is an integrity failure", async () => {
  for (const value of [{ status: "complete" }, { status: "complete", attemptCount: "1" }, { status: "complete", attemptCount: 0 }]) {
    const fx = makeVault();
    const op = async () => ({ ...value });
    const rec = await executeRaceRun(baseRun(parts(op), fx));
    assert.equal(rec.status, "integrity-failure", JSON.stringify(value));
  }
});

test("R1 — retry-success edge: success does not sanitize a second attempt", async () => {
  const fx = makeVault();
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    return { status: "complete", attemptCount: 2, state_digest: {} };
  };
  const rec = await executeRaceRun(baseRun(parts(flaky), fx));
  assert.equal(rec.status, "integrity-failure");
  assert.ok(calls >= 2);
});

test("R1 — integrity failure breaks unanimity explicitly, never silently", async () => {
  const fx = makeVault();
  const good = async () => ({ status: "complete", attemptCount: 1, state_digest: {} });
  const bad = async () => ({ status: "complete", attemptCount: 3, state_digest: {} });
  const out = await confirmOrdering({
    name: "ab",
    repetitions: 2,
    budget: { ...BUDGET },
    runOnce: async ({ tracker, index }) => executeRaceRun({
      participants: parts(index === 0 ? good : bad),
      fixture: fx,
      hooks: null,
      budget: tracker,
      scope: SCOPE,
    }),
  });
  assert.equal(out.unanimous, false);
  assert.equal(out.reason, "insufficient-valid-runs:1/2");
  assert.equal(out.excluded.length, 1);
});
