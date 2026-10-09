/**
 * race/runs.mjs — run orchestration, repetition accounting, adjudication.
 *
 * One synchronized run: reset attestation → precondition snapshot →
 * barrier release → completion accounting (attemptCount integrity per R1)
 * → final snapshot. Repetition: declared count, N>=2 per ordering,
 * unanimous-or-INCONCLUSIVE, excluded runs explicitly recorded, total
 * dispatches bounded by a shared budget tracker. Adjudication compares
 * ordering signatures: identical everywhere (or trivially empty) is
 * WITHIN-BOUNDARY; differing security-relevant transitions with an
 * applying boundary is a candidate; anything else is INCONCLUSIVE.
 * The sequential baseline reuses Phase 1 runSequential (budget/deadline
 * enforced there) and intentionally carries no barrier record (INFO-2).
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  sha256Hex,
  isoNow,
  freezeRecord,
} from "../common.mjs";
import { newCorrelationId } from "../correlation.mjs";
import { runSequential } from "../execution/contract.mjs";
import { createBarrier, participantKey } from "./barrier.mjs";
import { createOrderingLog } from "./ordering.mjs";
import { isHookMachine } from "./hooks.mjs";
import { validateOperationBindings } from "./bindings.mjs";

/** Deterministic serialization for snapshot comparison (sorted keys). */
export function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export function stableDigest(value) {
  return sha256Hex(stableStringify(value)).slice(0, 16);
}

function requireBudgetShape(budget) {
  requireObject(budget, "budget");
  if (!Number.isInteger(budget.maxRequests) || budget.maxRequests < 1) {
    throw new SecurityEngineError("MODEL_VALIDATION", "budget.maxRequests must be an integer >= 1");
  }
  if (typeof budget.timeoutMs !== "number" || !Number.isFinite(budget.timeoutMs) || budget.timeoutMs < 1) {
    throw new SecurityEngineError("MODEL_VALIDATION", "budget.timeoutMs must be a finite number >= 1");
  }
  return budget;
}

/** Shared ceiling: total dispatches across repetitions never exceed maxRequests. */
export function createBudgetTracker(budget) {
  const { maxRequests, timeoutMs } = requireBudgetShape(budget);
  let spent = 0;
  return {
    maxRequests,
    timeoutMs,
    spent() {
      return spent;
    },
    tryConsume(n) {
      if (!Number.isInteger(n) || n < 1) return false;
      if (spent + n > maxRequests) return false;
      spent += n;
      return true;
    },
  };
}

function asTracker(budget) {
  if (budget !== null && typeof budget === "object" && typeof budget.tryConsume === "function") return budget;
  return createBudgetTracker(budget);
}

function checkScope(scope) {
  requireObject(scope, "scope");
  if (scope.decision !== "allow") {
    throw new SecurityEngineError(
      "SCOPE_DENIED",
      `race run refused: scope decision is ${scope.decision ?? "missing"} (mirrors Phase 1 execution gating)`
    );
  }
}

function digestOf(snapshotValue) {
  if (snapshotValue === null || snapshotValue === undefined) return "none";
  return stableDigest(snapshotValue);
}

/**
 * Execute one synchronized comparison run. Never throws for run-level
 * outcomes (timeout/partial/reset/integrity/budget → recorded statuses);
 * throws only for harness misuse (bad shape, scope denial, unusable barrier).
 */
export async function executeRaceRun({
  participants,
  fixture,
  hooks = null,
  budget,
  scope,
  correlation_id = null,
  release_order = null,
} = {}) {
  if (!Array.isArray(participants) || participants.length < 2) {
    throw new SecurityEngineError("MODEL_VALIDATION", "participants must be an array of at least 2");
  }
  requireObject(fixture, "fixture");
  if (typeof fixture.reset !== "function" || typeof fixture.snapshot !== "function") {
    throw new SecurityEngineError("MODEL_VALIDATION", "fixture must expose async reset() and snapshot()");
  }
  checkScope(scope);
  const tracker = asTracker(budget);
  const runCorr = correlation_id === null || correlation_id === undefined
    ? newCorrelationId()
    : requireNonEmptyString(correlation_id, "correlation_id");

  const hookUnsupported = hooks !== null && hooks !== undefined && hooks.supported === false;
  const hookMachine = hooks !== null && hooks !== undefined && !hookUnsupported
    ? (isHookMachine(hooks) ? hooks : null)
    : null;
  if (hooks !== null && hooks !== undefined && !hookUnsupported && !hookMachine) {
    throw new SecurityEngineError("MODEL_VALIDATION", "hooks must be a hook machine or an unsupported-hook record");
  }

  let resetAtt;
  try {
    resetAtt = await fixture.reset();
  } catch (e) {
    return failRun(runCorr, "reset-invalid", `reset threw: ${e?.code ?? e?.name ?? "unknown"}`);
  }
  if (!resetAtt || typeof resetAtt !== "object" || resetAtt.reset !== true || !("initial_state" in resetAtt)) {
    return failRun(runCorr, "reset-invalid", "reset attestation missing or unsuccessful");
  }
  let preSnapshot;
  try {
    preSnapshot = await fixture.snapshot();
  } catch (e) {
    return failRun(runCorr, "snapshot-unavailable", `precondition snapshot threw: ${e?.code ?? e?.name ?? "unknown"}`);
  }
  const preDigest = digestOf(preSnapshot);

  if (!tracker.tryConsume(participants.length)) {
    return failRun(runCorr, "budget-exhausted", `needs ${participants.length} dispatches, ${tracker.maxRequests - tracker.spent()} left`);
  }

  const log = createOrderingLog(runCorr);
  const barrier = createBarrier({ parties: participants.length, timeoutMs: tracker.timeoutMs, correlation_id: runCorr, log });
  for (const p of participants) {
    requireObject(p, "participant");
    barrier.register({ context: p.context, operation: p.operation, descriptor: p.descriptor, bindings: p.bindings, transport: p.transport });
  }
  const out = await barrier.release(release_order === null || release_order === undefined ? {} : { release_order });

  if (out.status === "timeout") {
    return completeRun(runCorr, "timeout", { log, preDigest, postDigest: "none", hookMachine, hookUnsupported, attempts: out.dispatched, results: out.results });
  }
  if (out.status === "cancelled") {
    return completeRun(runCorr, "cancelled", { log, preDigest, postDigest: "none", hookMachine, hookUnsupported, attempts: out.dispatched, results: out.results });
  }

  // R1: every completed result MUST report attemptCount === 1 (integer).
  for (const r of out.results) {
    if (r.status !== "complete") continue;
    const reported = r.result && typeof r.result === "object" ? r.result.attemptCount : undefined;
    if (!Number.isInteger(reported) || reported !== 1) {
      return completeRun(runCorr, "integrity-failure", {
        log, preDigest, postDigest: "none", hookMachine, hookUnsupported,
        attempts: out.dispatched, results: out.results,
        integrity: { participant_id: r.participant_id, reported_type: reported === undefined ? "missing" : typeof reported },
      });
    }
  }

  let postSnapshot = null;
  let postDigest = "none";
  try {
    postSnapshot = await fixture.snapshot();
    postDigest = digestOf(postSnapshot);
  } catch {
    postDigest = "none";
  }
  const failed = out.results.filter((r) => r.status !== "complete").length;
  return completeRun(runCorr, failed > 0 ? "partial" : "complete", {
    log, preDigest, postDigest, hookMachine, hookUnsupported, attempts: out.dispatched, results: out.results,
  });

  function failRun(corr, status, reason) {
    return freezeRecord({ status, reason, correlation_id: corr, attempts: 0, spent: tracker.spent() });
  }
  function completeRun(corr, status, parts) {
    const hookAtt = hookMachine ? hookMachine.attestations() : null;
    return freezeRecord({
      status,
      correlation_id: corr,
      attempts: parts.attempts,
      spent: tracker.spent(),
      ordering: parts.log.events(),
      snapshots: freezeRecord({ pre: parts.preDigest, post: parts.postDigest, transition: `${parts.preDigest}>${parts.postDigest}` }),
      hooks: hookUnsupported
        ? freezeRecord({ supported: false })
        : hookMachine
          ? freezeRecord({ supported: true, complete: hookMachine.isComplete(), attestations: hookAtt })
          : null,
      results: parts.results,
      ...(parts.integrity ? { integrity: freezeRecord(parts.integrity) } : {}),
    });
  }
}

/**
 * Repeat one ordering until the declared count is reached. Unanimity
 * requires every repetition valid AND agreeing; anything else is
 * INCONCLUSIVE (never a silent exclusion: excluded runs are recorded).
 */
export async function confirmOrdering({ name, runOnce, repetitions, budget } = {}) {
  const orderingName = requireNonEmptyString(name, "name");
  if (typeof runOnce !== "function") {
    throw new SecurityEngineError("MODEL_VALIDATION", "runOnce must be an async function of ({tracker, index})");
  }
  if (!Number.isInteger(repetitions) || repetitions < 2) {
    throw new SecurityEngineError("MODEL_VALIDATION", "repetitions must be an integer >= 2 (N=1 unanimity prohibited)");
  }
  const tracker = createBudgetTracker(budget);
  const valid = [];
  const excluded = [];
  for (let i = 0; i < repetitions; i += 1) {
    const rec = await runOnce({ tracker, index: i });
    requireObject(rec, `runOnce result[${i}]`);
    if (rec.status === "complete") valid.push(rec);
    else excluded.push(freezeRecord({ index: i, status: rec.status, reason: rec.reason ?? null }));
  }
  if (valid.length !== repetitions) {
    return freezeRecord({
      ordering: orderingName,
      unanimous: false,
      reason: `insufficient-valid-runs:${valid.length}/${repetitions}`,
      signature: null,
      trivial: false,
      runs: Object.freeze(valid),
      excluded: Object.freeze(excluded),
    });
  }
  const signatures = new Set(valid.map((r) => r.snapshots.transition));
  if (signatures.size !== 1) {
    return freezeRecord({
      ordering: orderingName,
      unanimous: false,
      reason: "disagreement-across-runs",
      signature: null,
      trivial: false,
      runs: Object.freeze(valid),
      excluded: Object.freeze(excluded),
    });
  }
  const signature = [...signatures][0];
  const trivial = valid.every((r) => r.snapshots.pre === r.snapshots.post);
  return freezeRecord({
    ordering: orderingName,
    unanimous: true,
    reason: "unanimous",
    signature,
    trivial,
    pre_digest: valid[0].snapshots.pre,
    post_digest: valid[0].snapshots.post,
    runs: Object.freeze(valid),
    excluded: Object.freeze(excluded),
  });
}

/**
 * Adjudicate orderings against each other. Identical signatures everywhere
 * (or trivially empty transitions) is WITHIN-BOUNDARY; differing
 * security-relevant transitions with an applying boundary is a candidate;
 * anything else is INCONCLUSIVE. TOCTOU additionally requires complete
 * hook attestations on every valid run.
 */
export function adjudicateRace({ baseline = null, orderings, boundary, claim = "race" } = {}) {
  if (!Array.isArray(orderings) || orderings.length === 0) {
    throw new SecurityEngineError("MODEL_VALIDATION", "orderings must be a non-empty array");
  }
  if (claim !== "race" && claim !== "toctou") {
    throw new SecurityEngineError("MODEL_VALIDATION", "claim must be 'race' or 'toctou'");
  }
  requireObject(boundary, "boundary");
  const reasons = [];
  for (const o of orderings) {
    if (!o || o.unanimous !== true) {
      return { verdict: "INCONCLUSIVE", reasons: [`ordering ${o?.ordering ?? "?"} not unanimous`] };
    }
  }
  if (boundary.applies !== true || boundary.source === "unknown" || !boundary.source) {
    return { verdict: "INCONCLUSIVE", reasons: ["no applicable expected boundary"] };
  }
  // HIGH-1: a supplied-but-unusable baseline poisons the comparison. A
  // reference that is degraded cannot support EITHER a candidate or a
  // within-boundary conclusion — the comparison it anchors is compromised.
  if (baseline !== null && baseline !== undefined) {
    const statusOk = baseline.status === "complete";
    const resetOk = baseline.resetAttestation !== null && baseline.resetAttestation !== undefined
      && baseline.resetAttestation.valid === true;
    const sigOk = typeof baseline.signature === "string" && !!baseline.signature;
    if (!statusOk || !resetOk || !sigOk) {
      const why = !statusOk
        ? `baseline-status:${baseline.status ?? "missing"}`
        : !resetOk
          ? "baseline-reset-invalid"
          : "baseline-signature-missing";
      return { verdict: "INCONCLUSIVE", reasons: [`baseline-disregarded:${why}`] };
    }
  }
  if (claim === "toctou") {
    const incomplete = orderings.some((o) =>
      o.runs.some((r) => !r.hooks || r.hooks.supported !== true || r.hooks.complete !== true)
    );
    if (incomplete) {
      return { verdict: "INCONCLUSIVE", reasons: ["toctou hook attestations incomplete"] };
    }
  }
  const signatures = new Set(orderings.map((o) => o.signature));
  const allTrivial = orderings.every((o) => o.trivial === true);
  if (allTrivial) {
    return { verdict: "WITHIN-BOUNDARY", reasons: ["no state transition observed in any ordering"] };
  }
  if (signatures.size === 1) {
    reasons.push("identical transitions across orderings — deterministic business logic");
    // Reachable only with a usable baseline (gated above): a differing
    // baseline signature is a legitimate counterfactual reference.
    if (baseline && baseline.signature !== [...signatures][0]) {
      reasons.push("synchronized outcome differs from sequential baseline");
      return { verdict: claim === "toctou" ? "TOCTOU-CANDIDATE" : "RACE-CANDIDATE", reasons };
    }
    return { verdict: "WITHIN-BOUNDARY", reasons };
  }
  reasons.push(`ordering-dependent transition under ${boundary.source} boundary`);
  return { verdict: claim === "toctou" ? "TOCTOU-CANDIDATE" : "RACE-CANDIDATE", reasons };
}

/**
 * Sequential baseline reusing Phase 1 runSequential (budget/deadline
 * enforced there). Intentionally barrier-free: INFO-2 — the baseline
 * represents non-synchronized execution, so `barrier: null` is expected
 * and valid, not incomplete evidence.
 */
export async function executeSequentialBaseline({ exec, participants, snapshot = null, fixture = null } = {}) {
  requireObject(exec, "exec");
  if (!Array.isArray(participants) || participants.length < 1) {
    throw new SecurityEngineError("MODEL_VALIDATION", "participants must be a non-empty array");
  }
  if (snapshot !== null && snapshot !== undefined && typeof snapshot !== "function") {
    throw new SecurityEngineError("MODEL_VALIDATION", "snapshot must be an async function when provided");
  }
  // HIGH-1: the baseline carries explicit reset attestation. Without a
  // fixture reset (or with a failed one) the baseline is unusable for
  // differential adjudication — recorded, never inferred.
  let resetAttestation = freezeRecord({ valid: false, reason: "no-fixture-reset" });
  if (fixture !== null && fixture !== undefined) {
    requireObject(fixture, "fixture");
    if (typeof fixture.reset !== "function") {
      throw new SecurityEngineError("MODEL_VALIDATION", "baseline fixture must expose async reset()");
    }
    try {
      const att = await fixture.reset();
      resetAttestation = att && typeof att === "object" && att.reset === true && ("initial_state" in att)
        ? freezeRecord({ valid: true, initial_state: "attested" })
        : freezeRecord({ valid: false, reason: "reset-unsuccessful" });
    } catch (e) {
      resetAttestation = freezeRecord({ valid: false, reason: `reset-threw:${e?.code ?? e?.name ?? "unknown"}` });
    }
  }
  let preDigest = "none";
  if (snapshot) {
    try {
      preDigest = digestOf(await snapshot());
    } catch {
      preDigest = "none";
    }
  }
  const steps = participants.map((p) => {
    requireObject(p, "participant");
    const pid = participantKey(p.context);
    validateOperationBindings({ descriptor: p.descriptor, bindings: p.bindings ?? {}, transport: { retries: 0 } });
    return async () => {
      try {
        const value = await p.operation({
          participant_id: pid,
          context: p.context,
          bindings: p.bindings ?? {},
          transport: { retries: 0 },
          correlation_id: exec.correlation_id,
          mode: "sequential-baseline",
        });
        return { participant_id: pid, ok: true, value: value ?? null };
      } catch (e) {
        return { participant_id: pid, ok: false, error: e?.code ?? e?.name ?? "unknown" };
      }
    };
  });
  const out = await runSequential(exec, steps);
  let signature = null;
  let trivial = false;
  if (snapshot && preDigest !== "none") {
    try {
      const postDigest = digestOf(await snapshot());
      signature = `${preDigest}>${postDigest}`;
      trivial = preDigest === postDigest;
    } catch {
      signature = null;
    }
  }
  return freezeRecord({
    status: out.status,
    executed: out.executed,
    results: out.results,
    signature,
    trivial,
    resetAttestation,
    barrier: null,
    barrier_note: "sequential-baseline carries no barrier record by design (INFO-2): it represents non-synchronized execution",
    correlation_id: exec.correlation_id,
  });
}
