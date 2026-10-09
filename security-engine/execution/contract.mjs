/**
 * execution/contract.mjs — generic execution contract (§20).
 *
 * Understands target / scope / identity / endpoint / request / budget /
 * timeout / correlation. Provides sequential and bounded-parallel execution
 * with hard budget and deadline enforcement. Synchronized execution exists
 * as an explicit future-compatible surface that refuses with not_ready —
 * the Race Engine (not Phase 1) will implement it.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  isoNow,
  freezeRecord,
} from "../common.mjs";
import { newId } from "../correlation.mjs";

function requireBudget(budget) {
  requireObject(budget, "budget");
  const maxRequests = budget.maxRequests;
  const timeoutMs = budget.timeoutMs;
  if (!Number.isInteger(maxRequests) || maxRequests < 1) {
    throw new SecurityEngineError("EXECUTION_VALIDATION", "budget.maxRequests must be an integer >= 1");
  }
  if (typeof timeoutMs !== "number" || !(timeoutMs >= 1)) {
    throw new SecurityEngineError("EXECUTION_VALIDATION", "budget.timeoutMs must be a number >= 1");
  }
  return Object.freeze({ maxRequests, timeoutMs });
}

function requireSteps(steps) {
  if (!Array.isArray(steps)) {
    throw new SecurityEngineError("EXECUTION_VALIDATION", "steps must be an array");
  }
  for (let i = 0; i < steps.length; i += 1) {
    if (typeof steps[i] !== "function") {
      throw new SecurityEngineError("EXECUTION_VALIDATION", `steps[${i}] must be a function`);
    }
  }
  return steps;
}

export function createExecution({
  execution_id,
  correlation_id,
  target,
  scopeDecision,
  identities = [],
  budget,
  metadata = {},
} = {}) {
  requireObject(target, "target");
  requireObject(scopeDecision, "scopeDecision");
  if (scopeDecision.decision !== "allow") {
    throw new SecurityEngineError(
      "SCOPE_DENIED",
      `execution refused: scope decision is ${scopeDecision.decision ?? "missing"} (${scopeDecision.reason ?? "no reason"})`
    );
  }
  if (!Array.isArray(identities)) {
    throw new SecurityEngineError("EXECUTION_VALIDATION", "identities must be an array");
  }
  return freezeRecord({
    execution_id: execution_id === undefined ? newId("exec") : requireNonEmptyString(execution_id, "execution_id"),
    correlation_id: requireNonEmptyString(correlation_id, "correlation_id"),
    target,
    scope_decision: scopeDecision,
    identities: Object.freeze([...identities]),
    budget: requireBudget(budget),
    metadata: { ...requireObject(metadata, "metadata") },
    created_at: isoNow(),
  });
}

function deadlineOf(exec) {
  return Date.parse(exec.created_at) + exec.budget.timeoutMs;
}

async function runSteps(exec, steps, nextIndex) {
  const results = new Array(steps.length).fill(undefined);
  let spent = 0;
  const deadline = deadlineOf(exec);
  for (;;) {
    const index = nextIndex();
    if (index === null) break;
    if (spent >= exec.budget.maxRequests) {
      return { done: false, status: "budget_exhausted", spent, results: results.slice(0, index) };
    }
    if (Date.now() > deadline) {
      return { done: false, status: "timeout", spent, results: results.slice(0, index) };
    }
    const stepCtx = Object.freeze({ exec, index, spent });
    results[index] = await steps[index](stepCtx);
    spent += 1;
  }
  return { done: true, status: "complete", spent, results };
}

function toOutcome(run) {
  return freezeRecord({
    status: run.status,
    executed: run.spent,
    results: Object.freeze(run.results),
  });
}

export async function runSequential(exec, steps) {
  requireObject(exec, "exec");
  const list = requireSteps(steps);
  let cursor = 0;
  const run = await runSteps(exec, list, () => (cursor < list.length ? cursor++ : null));
  return toOutcome(run);
}

export async function runBounded(exec, steps, { concurrency = 2 } = {}) {
  requireObject(exec, "exec");
  const list = requireSteps(steps);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new SecurityEngineError("EXECUTION_VALIDATION", "concurrency must be an integer 1..8");
  }
  let cursor = 0;
  const claim = () => {
    if (cursor >= list.length) return null;
    const i = cursor;
    cursor += 1;
    return i;
  };
  const workers = Array.from({ length: Math.min(concurrency, list.length) }, async () =>
    runSteps(exec, list, claim)
  );
  const runs = await Promise.all(workers);
  // Merge worker runs back into index order; first non-complete status wins.
  const merged = new Array(list.length).fill(undefined);
  let spent = 0;
  let status = "complete";
  for (const run of runs) {
    spent += run.spent;
    run.results.forEach((v, i) => {
      if (v !== undefined) merged[i] = v;
    });
    if (run.status !== "complete" && status === "complete") status = run.status;
  }
  return freezeRecord({ status, executed: spent, results: Object.freeze(merged.filter((v) => v !== undefined)) });
}

/**
 * Future-compatible synchronized dispatch. Deliberately unimplemented:
 * barrier-start concurrency belongs to the Race Engine phase. The explicit
 * not_ready refusal (instead of a quiet sequential fallback) is the contract.
 */
export async function runSynchronized(exec, steps) {
  requireObject(exec, "exec");
  requireSteps(steps || []);
  return freezeRecord({
    status: "not_ready",
    reason: "synchronized-execution is deferred to the race-engine phase",
    requested: Array.isArray(steps) ? steps.length : 0,
  });
}
