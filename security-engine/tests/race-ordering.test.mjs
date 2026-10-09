/** Phase 4 ordering log + INFO-2 sequential baseline record. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrderingLog, attestRelease, dispatchTimestamps } from "../race/ordering.mjs";
import { createExecution } from "../execution/contract.mjs";
import { executeSequentialBaseline } from "../race/runs.mjs";

test("log appends monotonic events; attestRelease happy path", () => {
  const log = createOrderingLog("corr_9");
  assert.equal(log.size(), 0);
  log.append("registered", { participant_id: "a" });
  log.append("release", {});
  log.append("dispatch", { participant_id: "a", t_wall: 100 });
  log.append("dispatch", { participant_id: "b", t_wall: 101 });
  log.append("completion", { participant_id: "a" });
  const evts = log.events();
  assert.deepEqual(evts.map((e) => e.seq), [1, 2, 3, 4, 5]);
  assert.ok(Object.isFrozen(evts));
  const att = attestRelease(log, ["a", "b"]);
  assert.deepEqual([att.attested, att.parties_covered, att.parties_total], [true, 2, 2]);
  assert.equal(typeof att.release_seq, "number");
});

test("attestation fails without release, with multiple releases, with gaps", () => {
  const empty = createOrderingLog();
  assert.equal(attestRelease(empty, ["a"]).reason, "no-release-event");
  const multi = createOrderingLog();
  multi.append("release", {});
  multi.append("release", {});
  assert.equal(attestRelease(multi, ["a"]).reason, "multiple-release-events");
  const gap = createOrderingLog();
  gap.append("release", {});
  gap.append("dispatch", { participant_id: "a" });
  const g = attestRelease(gap, ["a", "b"]);
  assert.equal(g.attested, false);
  assert.equal(g.parties_covered, 1);
  assert.throws(() => attestRelease(gap, []), /partyIds/);
});

test("dispatch timestamps are supplementary reviewer data", () => {
  const log = createOrderingLog();
  log.append("release", {});
  log.append("dispatch", { participant_id: "a", t_wall: 500 });
  const ts = dispatchTimestamps(log);
  assert.equal(ts.length, 1);
  assert.equal(ts[0].participant_id, "a");
});

test("INFO-2 — sequential baseline carries barrier:null explicitly, never implicitly", async () => {
  const exec = createExecution({
    correlation_id: "corr_base",
    target: { target_id: "tgt_1" },
    scopeDecision: { decision: "allow", reason: "t", checks: [], target_id: "tgt_1", correlation_id: "corr_t" },
    budget: { maxRequests: 10, timeoutMs: 5000 },
  });
  const out = await executeSequentialBaseline({
    exec,
    participants: [
      { context: { identity_id: "idn_a", session_id: "s_idn_a" }, operation: async () => ({ status: "complete", attemptCount: 1 }), descriptor: { endpoint_id: "ep_x", method: "GET" }, bindings: {} },
      { context: { identity_id: "idn_b", session_id: "s_idn_b" }, operation: async () => ({ status: "complete", attemptCount: 1 }), descriptor: { endpoint_id: "ep_x", method: "GET" }, bindings: {} },
    ],
  });
  assert.equal(out.status, "complete");
  assert.equal(out.barrier, null);
  assert.ok(out.barrier_note.includes("by design"));
});
