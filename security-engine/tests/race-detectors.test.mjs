/** Phase 4 detectors — T9 discipline + per-dimension canonical behavior. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentity, createSession, bindSession } from "../models/identity.mjs";
import { createAuthenticatedContext } from "../execution/context.mjs";
import { createExecution } from "../execution/contract.mjs";
import { createRegistry } from "../registry/registry.mjs";
import { deriveExpectedBoundary } from "../authorization/semantics.mjs";
import { createHookMachine, unsupportedHook } from "../race/hooks.mjs";
import { createRaceDetectors, RACE_CLASSES } from "../race/detectors.mjs";
import { executeSequentialBaseline } from "../race/runs.mjs";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const SCOPE = { decision: "allow" };
const BUDGET = { maxRequests: 60, timeoutMs: 2000 };
const mkIdn = (id, role = "member", tenant = "tenant-a") => createIdentity({ identity_id: id, label: id, role, tenant_id: tenant });
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
const RES = { resource_id: "res_doc7", owner_identity: "idn_owner", tenant_id: "tenant-a", type: "document" };
const BOUND = { statement: "owner-only access", source: "conservative-inference", applies: true };
const DESC_AMT = { endpoint_id: "ep_vault", method: "POST", params_metadata: [{ name: "amount", location: "body" }] };
const DESC_PLAIN = { endpoint_id: "ep_probe", method: "GET" };
const partsOf = (vault, amt = 60) => {
  const a = mkIdn("idn_a", "A");
  const b = mkIdn("idn_b", "B");
  const mk = (idn, sid) => ({ context: mkCtx(idn, sid), operation: vault.withdraw, descriptor: DESC_AMT, bindings: { amount: amt }, transport: { retries: 0 } });
  return [mk(a, "ses_a"), mk(b, "ses_b")];
};
const baseInput = (vault, over = {}) => ({
  orderings: {
    ab: { participants: partsOf(vault), fixture: vault },
    ba: { participants: partsOf(vault), fixture: vault, release_order: ["idn_b|ses_b", "idn_a|ses_a"] },
  },
  repetitions: 2,
  budget: { ...BUDGET },
  scope: SCOPE,
  boundary: BOUND,
  resource: RES,
  endpoint_id: "ep_vault",
  target_id: "tgt_1",
  ...over,
});

test("T9 — five definitions, disabled by default, zero-detector intact", async () => {
  const defs = createRaceDetectors();
  assert.equal(defs.length, 5);
  assert.deepEqual(defs.map((d) => d.race_class).sort(), [...RACE_CLASSES].sort());
  assert.ok(defs.every((d) => d.version === "0.1.0" && d.specialization === "race"));
  assert.ok(Object.isFrozen(defs));
  const reg = createRegistry();
  assert.deepEqual((await reg.executeAll({})).status, "not_ready");
  for (const def of defs) {
    assert.equal(reg.register(def).status, "disabled");
    const out = await reg.execute(def.detector_id, baseInput(makeVault()));
    assert.equal(out.status, "not_ready");
    assert.equal(out.reason, "detector-disabled");
  }
});

test("ordering-ab + competing-ops + sequential-sync canonical crossings", async () => {
  const reg = createRegistry();
  for (const def of createRaceDetectors()) reg.register(def);
  const run = async (id, input) => {
    reg.enable(id);
    try {
      return await reg.execute(id, input);
    } finally {
      reg.disable(id);
    }
  };
  const obj = await run("race-ordering-ab", baseInput(makeVault()));
  assert.equal(obj.status, "complete");
  assert.equal(obj.verdict, "RACE-CANDIDATE");
  assert.ok(obj.candidate_id && obj.observation_id && obj.evidence_count === 3);
  const comp = await run("race-competing-ops", baseInput(makeVault()));
  assert.equal(comp.verdict, "RACE-CANDIDATE");
  const exec = createExecution({ correlation_id: "corr_b", target: { target_id: "tgt_1" }, scopeDecision: { ...SCOPE, reason: "t", checks: [], target_id: "tgt_1", correlation_id: "corr_t" }, budget: { maxRequests: 60, timeoutMs: 5000 } });
  const sync = await run("race-sequential-sync", {
    ...baseInput(makeVault()),
    baseline: {
      exec,
      participants: partsOf(makeVault()).map((p) => ({ context: p.context, operation: p.operation, descriptor: p.descriptor, bindings: p.bindings })),
      snapshot: async () => ({ balance: 100 }),
      fixture: makeVault(),
    },
  });
  assert.equal(sync.status, "complete");
  // T-H1-8 — fully valid baseline (reset-valid, complete, differing
  // signature) preserves the previously authorized adjudication path.
  assert.equal(sync.verdict, "RACE-CANDIDATE");
  assert.ok(sync.candidate_id);
  // Registry converts detector throws into explicit not_ready data (fail-closed,
  // engine stays up) — verify both the registry path and the direct guard.
  const viaRegistry = await run("race-competing-ops", baseInput(makeVault(), { resource: { type: "document" } }));
  assert.equal(viaRegistry.status, "not_ready");
  assert.equal(viaRegistry.reason, "detector-errored");
  const direct = await createRaceDetectors().find((d) => d.detector_id === "race-competing-ops")
    .execute(baseInput(makeVault(), { resource: { type: "document" } }))
    .then(() => ({ caught: false }), (e) => ({ caught: true, code: e?.code }));
  assert.deepEqual(direct, { caught: true, code: "MODEL_VALIDATION" });
});

test("check-use: hook-gated crossing vs unsupported-fixture inconclusive", async () => {
  const reg = createRegistry();
  for (const def of createRaceDetectors()) { reg.register(def); reg.enable(def.detector_id); }
  const a = mkIdn("idn_a", "A");
  const b = mkIdn("idn_b", "B");
  const mkP = (idn, sid, op, bindings = { amount: 60 }) => ({ context: mkCtx(idn, sid), operation: op, descriptor: DESC_PLAIN, bindings, transport: { retries: 0 } });
  const vault = makeVault();
  // One logical check/use window per run: the first participant's operation
  // brackets its work with the full hook chain (fixture-authored signaling).
  // The machine instance is supplied per repetition through hooksFor.
  const cell = {};
  const signaled = (baseOp) => async (args) => {
    const m = cell.machine;
    m.signal("CHECK_REACHED");
    m.signal("HOLD");
    const out = await baseOp(args);
    m.signal("RELEASE");
    m.signal("USE_REACHED");
    m.signal("COMPLETE");
    return out;
  };
  const hooksFor = () => {
    const m = createHookMachine();
    cell.machine = m;
    return m;
  };
  const inputFor = (fx) => ({
    orderings: {
      ab: { participants: [mkP(a, "ses_a", signaled(fx.withdraw)), mkP(b, "ses_b", fx.withdraw)], fixture: fx },
      ba: {
        participants: [mkP(a, "ses_a2", signaled(fx.withdraw)), mkP(b, "ses_b2", fx.withdraw)],
        fixture: fx,
        release_order: ["idn_b|ses_b2", "idn_a|ses_a2"],
      },
    },
    repetitions: 2,
    budget: { ...BUDGET },
    scope: SCOPE,
    boundary: BOUND,
    resource: RES,
    hooksFor,
  });
  const crossed = await reg.execute("race-check-use", inputFor(vault));
  assert.equal(crossed.status, "complete");
  assert.equal(crossed.verdict, "TOCTOU-CANDIDATE");
  assert.ok(crossed.candidate_id);
  const unsup = await reg.execute("race-check-use", {
    ...inputFor(makeVault()),
    hooksFor: () => unsupportedHook("no instrumentation"),
  });
  assert.equal(unsup.status, "complete");
  assert.equal(unsup.verdict, "INCONCLUSIVE");
  assert.equal(unsup.candidate_id, null);
});

test("authz-ordering reuses Phase 3 boundary derivation without reinterpretation", async () => {
  const reg = createRegistry();
  for (const def of createRaceDetectors()) { reg.register(def); reg.enable(def.detector_id); }
  const derived = deriveExpectedBoundary({
    dimension: "object-level",
    subject: { identity_id: "idn_peer", role: "member", tenant_id: "tenant-a" },
    resource: RES,
  });
  assert.equal(derived.source, "conservative-inference");
  const out = await reg.execute("race-authz-ordering", {
    ...baseInput(makeVault()),
    boundary: { statement: derived.statement, source: derived.source, applies: true },
  });
  assert.equal(out.verdict, "RACE-CANDIDATE");
});

test("safe fixtures yield no candidates across all detectors", async () => {
  const reg = createRegistry();
  for (const def of createRaceDetectors()) { reg.register(def); reg.enable(def.detector_id); }
  const safe = {
    ...baseInput(makeVault(), { boundary: { statement: null, source: "unknown", applies: false } }),
    hooksFor: undefined,
  };
  let candidates = 0;
  for (const def of createRaceDetectors()) {
    const out = await reg.execute(def.detector_id, { ...safe, hooksFor: def.race_class === "check-use" ? () => unsupportedHook("safe") : undefined });
    if (out.candidate_id) candidates += 1;
  }
  assert.equal(candidates, 0);
});

test("T-H1-7 — Red-Team adversarial: degraded baseline cannot produce a candidate", async () => {
  const reg = createRegistry();
  for (const def of createRaceDetectors()) { reg.register(def); reg.enable(def.detector_id); }
  // Unanimous synchronized orderings with a valid boundary (crossing setup).
  const vault = makeVault();
  // Degraded baseline: reset VALID (isolates the status gate), execution
  // genuinely times out. Prove degradation directly first.
  const slowExecParams = {
    correlation_id: "corr_slow",
    target: { target_id: "tgt_1" },
    scopeDecision: { decision: "allow", reason: "t", checks: [], target_id: "tgt_1", correlation_id: "corr_t" },
    budget: { maxRequests: 10, timeoutMs: 25 },
  };
  const slowOp = async () => {
    await new Promise((r) => setTimeout(r, 150));
    return { status: "complete", attemptCount: 1 };
  };
  const mkSlow = (iid, sid) => ({
    context: mkCtx(mkIdn(iid, iid), sid),
    operation: slowOp,
    descriptor: DESC_PLAIN,
    bindings: {},
  });
  const baseFx = makeVault();
  const snap = async () => ({ phase: "base" });
  const direct = await executeSequentialBaseline({
    exec: createExecution(slowExecParams),
    participants: [mkSlow("idn_x", "ses_x"), mkSlow("idn_y", "ses_y")],
    snapshot: snap,
    fixture: baseFx,
  });
  assert.notEqual(direct.status, "complete");
  assert.equal(direct.resetAttestation.valid, true);
  // Same degraded baseline inside the full detector pipeline: the Red-Team
  // construction (degraded + differing signature + unanimous + boundary).
  const out = await reg.execute("race-sequential-sync", {
    ...baseInput(vault),
    baseline: {
      exec: createExecution(slowExecParams),
      participants: [mkSlow("idn_x", "ses_x"), mkSlow("idn_y", "ses_y")],
      snapshot: snap,
      fixture: makeVault(),
    },
  });
  assert.equal(out.status, "complete");
  assert.equal(out.verdict, "INCONCLUSIVE");
  assert.equal(out.candidate_id, null);
});
