/**
 * race/barrier.mjs — controlled-release barrier primitive.
 *
 * One-shot gate: register exactly `parties` participants, then ONE release
 * event dispatches all injected operations. Readiness is all-or-nothing;
 * terminal states are permanent (no reuse after release/timeout/cancel/
 * failure). Participant operations are caller-injected async functions
 * (Phase 1 runSequential/runBounded step pattern) — the barrier owns
 * gating, ordering, accounting, and evidence, never transport.
 *
 * What this is NOT: worker-pool start, promise creation, timestamp
 * proximity, and dispatch order are never overlap proof. The barrier
 * proves controlled release; ordering-dependent effects are proven
 * separately by differentials + unanimous repetition.
 */
import {
  SecurityEngineError,
  requireObject,
  requireNonEmptyString,
  freezeRecord,
} from "../common.mjs";
import { newCorrelationId } from "../correlation.mjs";
import { validateOperationBindings } from "./bindings.mjs";

function participantKey(context) {
  requireObject(context, "context");
  const iid = requireNonEmptyString(context.identity_id, "context.identity_id");
  const sid = requireNonEmptyString(context.session_id, "context.session_id");
  return `${iid}|${sid}`;
}

/** Stable participant identity used across barrier, runs, and evidence. */
export { participantKey };

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createBarrier({ parties, timeoutMs, correlation_id = null, log = null } = {}) {
  if (!Number.isInteger(parties) || parties < 2) {
    throw new SecurityEngineError("BARRIER_VALIDATION", "parties must be an integer >= 2");
  }
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new SecurityEngineError("BARRIER_VALIDATION", "timeoutMs must be a finite number >= 1 (no implicit default)");
  }
  if (log !== null && log !== undefined && (typeof log !== "object" || typeof log.append !== "function")) {
    throw new SecurityEngineError("BARRIER_VALIDATION", "log must expose append(type, detail)");
  }
  const corr = correlation_id === null || correlation_id === undefined
    ? newCorrelationId()
    : requireNonEmptyString(correlation_id, "correlation_id");

  const registered = new Map();
  let order = [];
  let released = false;
  let terminal = false;
  let outcome = null;
  let cancelRequested = false;
  const emit = (type, detail = {}) => {
    if (log) log.append(type, { correlation_id: corr, ...detail });
  };

  function failTerminal(status, extra = {}) {
    terminal = true;
    outcome = freezeRecord({ status, correlation_id: corr, ...extra });
    return outcome;
  }

  return {
    correlation_id: corr,

    register({ context, operation, descriptor, bindings, transport } = {}) {
      if (terminal) {
        throw new SecurityEngineError("STALE_BARRIER", "barrier is terminal — fresh barrier required per repetition");
      }
      requireObject(context, "context");
      if (typeof operation !== "function") {
        throw new SecurityEngineError("BARRIER_VALIDATION", "operation must be an injectable async function");
      }
      // Descriptor (routable description) is validated separately from the
      // executable: values live only in fixture-owned bindings, transport
      // must declare retries: 0 (R1 structural enforcement).
      const validated = validateOperationBindings({ descriptor, bindings, transport });
      const key = participantKey(context);
      if (registered.has(key)) {
        throw new SecurityEngineError("DUPLICATE_PARTICIPANT", `participant ${key} is already registered`);
      }
      if (registered.size >= parties) {
        throw new SecurityEngineError("BARRIER_FULL", `barrier accepts exactly ${parties} participants`);
      }
      const entry = freezeRecord({ participant_id: key, context, operation, bindings: validated.bindings, transport: validated.transport, index: registered.size });
      registered.set(key, entry);
      order.push(key);
      emit("registered", { participant_id: key });
      return freezeRecord({ participant_id: key, index: entry.index });
    },

    ready() {
      return registered.size === parties;
    },

    size() {
      return registered.size;
    },

    isTerminal() {
      return terminal;
    },

    cancel() {
      if (terminal) {
        throw new SecurityEngineError("STALE_BARRIER", "barrier is terminal — cancel is meaningless");
      }
      if (!released) {
        emit("cancelled", { dispatched: 0 });
        return failTerminal("cancelled", { dispatched: 0, results: Object.freeze([]) });
      }
      cancelRequested = true;
      emit("cancel-requested", {});
      return freezeRecord({ acknowledged: false, reason: "already-released-cooperative-limit", correlation_id: corr });
    },

    async release({ release_order = null } = {}) {
      if (terminal) {
        throw new SecurityEngineError("STALE_BARRIER", "barrier is terminal — fresh barrier required per repetition");
      }
      if (cancelRequested) {
        emit("cancelled", { dispatched: 0 });
        return failTerminal("cancelled", { dispatched: 0, results: Object.freeze([]) });
      }
      if (registered.size !== parties) {
        throw new SecurityEngineError(
          "BARRIER_NOT_READY",
          `barrier requires exactly ${parties} registered participants (${registered.size} present)`
        );
      }
      let sequence = [...order];
      if (release_order !== null && release_order !== undefined) {
        if (!Array.isArray(release_order) || release_order.length !== order.length || !release_order.every((k) => order.includes(k))) {
          throw new SecurityEngineError("BARRIER_VALIDATION", "release_order must be an exact permutation of registered participants");
        }
        sequence = [...release_order];
      }
      released = true;
      emit("release", { parties: sequence.length, order: Object.freeze([...sequence]) });

      const startedAt = Date.now();
      const invoke = async (key) => {
        const entry = registered.get(key);
        emit("dispatch", { participant_id: key, t_wall: Date.now() });
        try {
          const value = await entry.operation({
            participant_id: key,
            context: entry.context,
            bindings: entry.bindings,
            transport: entry.transport,
            correlation_id: corr,
          });
          return { key, fulfilled: true, value };
        } catch (e) {
          return { key, fulfilled: false, error: e?.code ?? e?.name ?? "unknown" };
        }
      };
      const runAll = Promise.all(sequence.map((key) => invoke(key).then((r) => {
        emit("completion", { participant_id: key, fulfilled: r.fulfilled });
        return r;
      })));

      let settled = null;
      let timedOut = false;
      const elapsed = () => Date.now() - startedAt;
      const winner = await Promise.race([
        runAll.then((r) => ({ kind: "done", value: r })),
        delay(timeoutMs).then(() => ({ kind: "timeout" })),
      ]);
      if (winner.kind === "timeout") {
        timedOut = true;
        emit("timeout", { timeout_ms: timeoutMs, elapsed_ms: elapsed() });
      } else {
        settled = winner.value;
      }

      if (timedOut) {
        const done = 0;
        emit("cleanup", { settled: done, unsettled: sequence.length - done, joined: false, reason: "timeout-cooperative-limit" });
        return failTerminal("timeout", {
          dispatched: sequence.length,
          results: Object.freeze([]),
          cleanup: Object.freeze({ settled: done, unsettled: sequence.length - done }),
        });
      }

      const results = sequence.map((key) => {
        const r = settled.find((s) => s.key === key);
        if (!r || !r.fulfilled) {
          const err = r && !r.fulfilled ? r.error : "unsettled";
          return freezeRecord({ participant_id: key, status: "failed", error: err });
        }
        return freezeRecord({ participant_id: key, status: "complete", result: r.value ?? null });
      });
      const failed = results.filter((r) => r.status !== "complete").length;
      emit("cleanup", { settled: sequence.length, unsettled: 0, joined: true, reason: "all-settled" });
      return failTerminal(failed > 0 ? "partial" : "complete", {
        dispatched: sequence.length,
        cancel_requested: cancelRequested,
        results: Object.freeze(results),
        cleanup: Object.freeze({ settled: sequence.length, unsettled: 0 }),
      });
    },

    getOutcome() {
      return outcome;
    },
  };
}
