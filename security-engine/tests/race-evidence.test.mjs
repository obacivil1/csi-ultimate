/** Phase 4 evidence pack (T4/T5/T7) + LOW-1 correlation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentity, createSession, bindSession } from "../models/identity.mjs";
import { createAuthenticatedContext } from "../execution/context.mjs";
import { createExecution } from "../execution/contract.mjs";
import { executeRaceRun, confirmOrdering, adjudicateRace } from "../race/runs.mjs";
import { buildRacePack, correlateCandidates } from "../race/evidence.mjs";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const SCOPE = { decision: "allow" };
const BUDGET = { maxRequests: 60, timeoutMs: 2000 };
const DESC_AMT = { endpoint_id: "ep_vault", method: "POST", params_metadata: [{ name: "amount", location: "body" }] };
const BOUND = { statement: "owner-only access", source: "conservative-inference", applies: true };
const RES = { resource_id: "res_doc7", owner_identity: "idn_owner", tenant_id: "tenant-a", type: "document" };
const mkIdn = (id) => createIdentity({ identity_id: id, label: id });
const mkCtx = (idn, sid) => {
  const ses = bindSession(createSession({ session_id: sid, target_id: "tgt_1" }), idn);
  const exec = createExecution({ correlation_id: "corr_t", target: { target_id: "tgt_1" }, scopeDecision: { ...SCOPE, reason: "t", checks: [], target_id: "tgt_1", correlation_id: "corr_t" }, budget: { maxRequests: 60, timeoutMs: 5000 } });
  return createAuthenticatedContext({ execution: exec, identity: idn, session: ses, nowMs: NOW });
};
function makeVault(initial = 100, secret = null) {
  let balance = initial;
  const granted = {};
  return {
    async reset() { balance = initial; for (const k of Object.keys(granted)) delete granted[k]; return { reset: true, initial_state: { balance: initial } }; },
    async snapshot() { return secret ? { balance, granted: { ...granted }, note: secret } : { balance, granted: { ...granted } }; },
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
async function crossingPack(vault, secretTest = false) {
  const corr = `corr_${secretTest ? "evil" : "ok"}`;
  const names = ["ab", "ba"];
  const confirmations = [];
  for (const name of names) {
    const fx = secretTest ? vault : makeVault();
    const c = await confirmOrdering({
      name,
      repetitions: 2,
      budget: { ...BUDGET },
      runOnce: async ({ tracker }) => executeRaceRun({
        participants: partsOf(fx),
        fixture: fx,
        hooks: null,
        budget: tracker,
        scope: SCOPE,
        correlation_id: corr,
        release_order: name === "ba" ? ["idn_b|ses_b", "idn_a|ses_a"] : null,
      }),
    });
    confirmations.push({ name, confirmation: c });
  }
  const adj = adjudicateRace({
    orderings: confirmations.map(({ name, confirmation: c }) => ({ ordering: name, ...c })),
    boundary: BOUND,
    resource: RES,
    claim: "race",
  });
  assert.equal(adj.verdict, "RACE-CANDIDATE");
  const first = (n) => confirmations.find((c) => c.name === n).confirmation;
  return buildRacePack({
    race_class: "ordering-ab",
    verdict: adj.verdict,
    verdict_reasons: adj.reasons,
    boundary: BOUND,
    orderings: confirmations.map(({ name, confirmation: c }) => ({
      name, signature: c.signature, valid_runs: c.runs.length, pre_digest: c.pre_digest, post_digest: c.post_digest,
    })),
    unanimous_runs: 2,
    excluded_runs: [],
    participant_ids: ["idn_a|ses_a", "idn_b|ses_b"],
    resource: RES,
    endpoint_id: "ep_vault",
    target_id: "tgt_1",
    scope: SCOPE,
    correlation_id: corr,
  });
}

test("T4 — candidate pack: all fields present and non-vacuous", async () => {
  const { observation: o, evidence: e, candidate: c } = await crossingPack();
  assert.ok(c);
  assert.ok(c.title && c.expected_boundary && c.observed_behavior && c.security_relevance);
  assert.ok(c.state_before && c.state_after && c.state_before !== c.state_after);
  assert.ok(c.confidence.score >= 0 && c.confidence.level && c.confidence.reasons.length && c.confidence.rationale);
  assert.ok(c.impact.level && c.impact.rationale && c.severity.level && c.severity.rationale);
  assert.ok(c.scope_status && c.scope_status.decision === "allow");
  assert.deepEqual(c.identity_references, ["idn_a|ses_a", "idn_b|ses_b"]);
  assert.equal(c.resource_reference, "res_doc7");
  assert.equal(c.endpoint_reference, "ep_vault");
  assert.equal(c.evidence_references.length, 3);
  assert.deepEqual(c.evidence_references, e.map((x) => x.evidence_id));
  assert.ok(c.reproduction_reference && c.status === "candidate");
  assert.deepEqual(c.status_history, []);
  assert.equal(c.metadata.race_class, "ordering-ab");
  assert.ok(c.metadata.race_correlation_id.startsWith("corr_"));
  assert.equal(o.identity_id, null);
  assert.ok(o.signals.some((s) => s.startsWith("verdict:")));
  assert.equal(e.length, 3);
});

test("T5 — secret-laden fixture state never reaches the pack", async () => {
  const vault = makeVault(100, "sess=CCC");
  const pack = await crossingPack(vault, true);
  assert.ok(pack.candidate);
  const dumped = JSON.stringify({ o: pack.observation, e: pack.evidence, c: pack.candidate });
  for (const secret of ["sess=CCC", "Bearer", "hunter2", "token=EEE", "password"]) {
    assert.ok(!dumped.includes(secret), `leaked: ${secret}`);
  }
});

test("within/inconclusive comparisons still emit observation + evidence, never candidates", async () => {
  const fx = makeVault();
  const corr = "corr_safe";
  const run = (order) => confirmOrdering({
    name: order,
    repetitions: 2,
    budget: { ...BUDGET },
    runOnce: async ({ tracker }) => executeRaceRun({ participants: partsOf(fx), fixture: fx, hooks: null, budget: tracker, scope: SCOPE, correlation_id: corr }),
  });
  const ab = await run("ab");
  const ba = await run("ba");
  assert.equal(ab.unanimous, true);
  const adj = adjudicateRace({
    orderings: [{ ordering: "ab", ...ab }, { ordering: "ba", ...ba }],
    boundary: BOUND, resource: RES, claim: "race",
  });
  assert.equal(adj.verdict, "WITHIN-BOUNDARY");
});

test("LOW-1 — same event from two detectors correlates; distinct events do not", async () => {
  const pack = await crossingPack();
  const twin = { ...pack.candidate, finding_id: "find_twin" };
  const other = { ...pack.candidate, finding_id: "find_other", resource_reference: "res_other" };
  const out = correlateCandidates([pack.candidate, twin, other]);
  assert.equal(out.groups.length, 2);
  assert.equal(out.duplicate_count, 1);
  const g = out.groups.find((x) => x.members.length === 2);
  assert.equal(g.primary, pack.candidate.finding_id);
  assert.throws(() => correlateCandidates("nope"), (e) => e?.code === "MODEL_VALIDATION");
});

test("T-H1-6 — pack metadata exposes actual baseline values, never fabricated", async () => {
  const args = {
    race_class: "ordering-ab",
    verdict: "RACE-CANDIDATE",
    verdict_reasons: ["ordering-dependent transition under conservative-inference boundary"],
    boundary: BOUND,
    orderings: [{ name: "ab", signature: "h1>h2", valid_runs: 2, pre_digest: "h1", post_digest: "h2" }],
    unanimous_runs: 2,
    excluded_runs: [],
    participant_ids: ["idn_a|ses_a", "idn_b|ses_b"],
    resource: RES,
    endpoint_id: "ep_vault",
    target_id: "tgt_1",
    scope: SCOPE,
    correlation_id: "corr_h16",
  };
  const good = buildRacePack({ ...args, baseline: { status: "complete", signature: "hz", resetAttestation: { valid: true } } });
  assert.deepEqual(good.observation.metadata.baseline, { status: "complete", signature: "hz", reset_valid: true });
  assert.ok(good.candidate);
  // Degraded baselines stay visible exactly as executed — not sanitized away.
  const bad = buildRacePack({ ...args, baseline: { status: "timeout", signature: "hz", resetAttestation: { valid: false } } });
  assert.deepEqual(bad.observation.metadata.baseline, { status: "timeout", signature: "hz", reset_valid: false });
  // Absent baseline is null, never a fabricated healthy record.
  const none = buildRacePack(args);
  assert.equal(none.observation.metadata.baseline, null);
});
