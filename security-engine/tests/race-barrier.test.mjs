/** Phase 4 barrier lifecycle — registration through terminal states. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBarrier, participantKey } from "../race/barrier.mjs";
import { createOrderingLog } from "../race/ordering.mjs";

const ctx = (iid, sid) => ({ identity_id: iid, session_id: sid });
const DESC = { endpoint_id: "ep_x", method: "GET" };
const op = (ret = {}) => async () => ({ status: "complete", attemptCount: 1, ...ret });
const P = (iid, sid, operation = op()) => ({
  context: ctx(iid, sid),
  operation,
  descriptor: DESC,
  bindings: {},
  transport: { retries: 0 },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("registration: receipts, duplicates, capacity", () => {
  const b = createBarrier({ parties: 2, timeoutMs: 1000 });
  const r1 = b.register(P("a", "s1"));
  assert.equal(r1.participant_id, "a|s1");
  assert.equal(r1.index, 0);
  assert.equal(b.ready(), false);
  assert.throws(() => b.register(P("a", "s1")), (e) => e?.code === "DUPLICATE_PARTICIPANT");
  b.register(P("b", "s2"));
  assert.equal(b.ready(), true);
  assert.throws(() => b.register(P("c", "s3")), (e) => e?.code === "BARRIER_FULL");
  assert.throws(() => createBarrier({ parties: 1, timeoutMs: 10 }), (e) => e?.code === "BARRIER_VALIDATION");
  assert.throws(() => createBarrier({ parties: 2 }), (e) => e?.code === "BARRIER_VALIDATION");
});

test("release: ordered dispatch, indexed results, terminal after", async () => {
  const log = createOrderingLog("corr_1");
  const b = createBarrier({ parties: 2, timeoutMs: 2000, correlation_id: "corr_1", log });
  b.register(P("a", "s1", op({ n: 1 })));
  b.register(P("b", "s2", op({ n: 2 })));
  const out = await b.release();
  assert.equal(out.status, "complete");
  assert.equal(out.dispatched, 2);
  assert.deepEqual(out.results.map((r) => r.participant_id), ["a|s1", "b|s2"]);
  assert.deepEqual(out.cleanup, { settled: 2, unsettled: 0 });
  assert.equal(b.isTerminal(), true);
  assert.deepEqual(b.getOutcome().status, "complete");
  await assert.rejects(() => b.release(), (e) => e?.code === "STALE_BARRIER");
  assert.throws(() => b.register(P("c", "s3")), (e) => e?.code === "STALE_BARRIER");
  const types = log.events().map((e) => e.type);
  assert.ok(types.includes("release") && types.filter((t) => t === "dispatch").length === 2);
});

test("release_order permutation respected; bad permutation refused", async () => {
  const b = createBarrier({ parties: 2, timeoutMs: 2000 });
  b.register(P("a", "s1", op()));
  b.register(P("b", "s2", op()));
  const out = await b.release({ release_order: ["b|s2", "a|s1"] });
  assert.deepEqual(out.results.map((r) => r.participant_id), ["b|s2", "a|s1"]);
  const b2 = createBarrier({ parties: 2, timeoutMs: 2000 });
  b2.register(P("a", "s1", op()));
  b2.register(P("b", "s2", op()));
  await assert.rejects(() => b2.release({ release_order: ["a|s1"] }), (e) => e?.code === "BARRIER_VALIDATION");
});

test("under-registered release refused (fail fast, not partial)", async () => {
  const b = createBarrier({ parties: 2, timeoutMs: 2000 });
  b.register(P("a", "s1", op()));
  await assert.rejects(() => b.release(), (e) => e?.code === "BARRIER_NOT_READY");
  assert.equal(b.isTerminal(), false);
});

test("timeout: outcome recorded, cleanup attested, terminal after", async () => {
  const b = createBarrier({ parties: 2, timeoutMs: 30 });
  b.register(P("a", "s1", async () => { await sleep(200); return { status: "complete", attemptCount: 1 }; }));
  b.register(P("b", "s2", op()));
  const out = await b.release();
  assert.equal(out.status, "timeout");
  assert.deepEqual(out.cleanup, { settled: 0, unsettled: 2 });
  assert.equal(b.isTerminal(), true);
});

test("cancel before release: nothing dispatched", async () => {
  let called = false;
  const b = createBarrier({ parties: 2, timeoutMs: 2000 });
  b.register(P("a", "s1", async () => { called = true; return { status: "complete", attemptCount: 1 }; }));
  b.register(P("b", "s2", op()));
  const out = b.cancel();
  assert.equal(out.status, "cancelled");
  assert.equal(out.dispatched, 0);
  assert.equal(called, false);
  assert.equal(b.isTerminal(), true);
});

test("partial: failures recorded by code, survivors complete", async () => {
  const b = createBarrier({ parties: 2, timeoutMs: 2000 });
  b.register(P("a", "s1", op()));
  b.register(P("b", "s2", async () => { const e = new Error("denied by fixture"); e.code = "FIXTURE_DENY"; throw e; }));
  const out = await b.release();
  assert.equal(out.status, "partial");
  const bad = out.results.find((r) => r.participant_id === "b|s2");
  assert.equal(bad.status, "failed");
  assert.equal(bad.error, "FIXTURE_DENY");
  assert.ok(!JSON.stringify(out).includes("denied by fixture"));
});

test("participantKey stable; descriptors required; fresh barriers independent", async () => {
  assert.equal(participantKey(ctx("a", "s1")), "a|s1");
  const nodesc = createBarrier({ parties: 2, timeoutMs: 100 });
  assert.throws(
    () => nodesc.register({ context: ctx("a", "s1"), operation: op(), bindings: {}, transport: { retries: 0 } }),
    (e) => e?.code === "MODEL_VALIDATION"
  );
  const mk = () => createBarrier({ parties: 2, timeoutMs: 100 });
  const b1 = mk();
  b1.register(P("a", "s1", op()));
  assert.equal(b1.size(), 1);
  const b2 = mk();
  assert.equal(b2.size(), 0);
});
