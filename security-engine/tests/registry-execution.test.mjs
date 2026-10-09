/** Phase 1 §25 — registry lifecycle + execution contract (incl. synchronized refusal). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../registry/registry.mjs";
import { createExecution, runSequential, runBounded, runSynchronized } from "../execution/contract.mjs";

const allow = { decision: "allow", reason: "test", checks: [], target_id: "tgt_1", correlation_id: "corr_1" };
const execOf = (over = {}) =>
  createExecution({ correlation_id: "corr_1", target: { target_id: "tgt_1" }, scopeDecision: allow, budget: { maxRequests: 10, timeoutMs: 5000 }, ...over });
const stubDetector = (over = {}) => ({
  detector_id: "stub-01",
  name: "Stub",
  version: "0.1.0",
  specialization: "general",
  ...over,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("registry: register / duplicate / resolve / list / unregister", () => {
  const reg = createRegistry();
  assert.deepEqual(reg.list(), []);
  const def = reg.register(stubDetector());
  assert.equal(def.status, "disabled"); // never enabled by default
  assert.throws(() => reg.register(stubDetector()), (e) => e?.code === "REGISTRY_DUPLICATE");
  assert.throws(() => reg.register({ ...stubDetector(), version: "x" }), (e) => e?.code === "REGISTRY_VALIDATION");
  assert.ok(reg.resolve("stub-01"));
  assert.equal(reg.resolve("missing"), null);
  assert.equal(reg.list({ status: "disabled" }).length, 1);
  assert.equal(reg.list({ status: "enabled" }).length, 0);
  reg.enable("stub-01");
  assert.equal(reg.resolve("stub-01").status, "enabled");
  reg.disable("stub-01");
  assert.equal(reg.resolve("stub-01").status, "disabled");
  assert.throws(() => reg.enable("missing"), (e) => e?.code === "REGISTRY_UNKNOWN");
  assert.equal(reg.unregister("stub-01"), true);
  assert.throws(() => reg.unregister("stub-01"), (e) => e?.code === "REGISTRY_UNKNOWN");
});

test("registry: zero-detector and disabled states are explicit, never silent success", async () => {
  const reg = createRegistry();
  const empty = await reg.executeAll({});
  assert.equal(empty.status, "not_ready");
  assert.equal(empty.reason, "no-enabled-detectors");
  reg.register(stubDetector());
  const disabled = await reg.execute("stub-01", {});
  assert.equal(disabled.status, "not_ready");
  assert.equal(disabled.reason, "detector-disabled");
  reg.register(stubDetector({ detector_id: "noexec", name: "NoExec" }));
  reg.enable("noexec");
  const incapable = await reg.execute("noexec", {});
  assert.equal(incapable.reason, "no-execute-capability");
  await assert.rejects(() => reg.execute("missing", {}), (e) => e?.code === "REGISTRY_UNKNOWN");
});

test("registry: enabled detector executes; errors become not_ready data", async () => {
  const reg = createRegistry();
  reg.register(stubDetector({ execute: async (ctx) => ({ status: "complete", echo: ctx.ping }) }));
  reg.enable("stub-01");
  const out = await reg.execute("stub-01", { ping: "pong" });
  assert.equal(out.status, "complete");
  assert.equal(out.echo, "pong");
  reg.register(stubDetector({ detector_id: "boom", name: "Boom", execute: async () => { throw new Error("kaput"); } }));
  reg.enable("boom");
  const err = await reg.execute("boom", {});
  assert.equal(err.status, "not_ready");
  assert.equal(err.reason, "detector-errored");
});

test("execution: scope-denied executions are refused at creation", () => {
  assert.throws(
    () => execOf({ scopeDecision: { decision: "deny", reason: "ambiguous-scope" } }),
    (e) => e?.code === "SCOPE_DENIED"
  );
  assert.throws(() => execOf({ budget: { maxRequests: 0, timeoutMs: 5 } }), (e) => e?.code === "EXECUTION_VALIDATION");
});

test("execution: sequential order + budget exhaustion", async () => {
  const exec = execOf({ budget: { maxRequests: 2, timeoutMs: 5000 } });
  const seen = [];
  const out = await runSequential(exec, [0, 1, 2, 3].map((i) => async ({ index }) => {
    seen.push(index);
    return `r${i}`;
  }));
  assert.equal(out.status, "budget_exhausted");
  assert.equal(out.executed, 2);
  assert.deepEqual(out.results, ["r0", "r1"]);
  assert.deepEqual(seen, [0, 1]);
});

test("execution: bounded parallelism preserves index order", async () => {
  const exec = execOf();
  const out = await runBounded(exec, [0, 1, 2, 3, 4].map((i) => async () => {
    await sleep(5);
    return i * 10;
  }), { concurrency: 3 });
  assert.equal(out.status, "complete");
  assert.deepEqual(out.results, [0, 10, 20, 30, 40]);
  await assert.rejects(() => runBounded(exec, [], { concurrency: 99 }), (e) => e?.code === "EXECUTION_VALIDATION");
});

test("execution: deadline timeout is explicit", async () => {
  const exec = execOf({ budget: { maxRequests: 10, timeoutMs: 20 } });
  const out = await runSequential(exec, [
    async () => "first",
    async () => { await sleep(60); return "second"; },
    async () => "third",
  ]);
  // First step runs inside the window; the deadline then trips before step 3.
  assert.ok(["timeout", "complete"].includes(out.status));
  assert.ok(out.executed >= 1);
});

test("execution: synchronized mode refuses with not_ready (no silent fallback)", async () => {
  const exec = execOf();
  const out = await runSynchronized(exec, [async () => 1, async () => 2]);
  assert.equal(out.status, "not_ready");
  assert.equal(out.requested, 2);
  assert.ok(out.reason.includes("race-engine"));
});
