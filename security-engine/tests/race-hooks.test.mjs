/** Phase 4 hook lifecycle — legal chain, illegal edges, terminality. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHookMachine, unsupportedHook, isHookMachine, HOOK_STATES } from "../race/hooks.mjs";

const fullChain = (m) => {
  for (const s of ["CHECK_REACHED", "HOLD", "RELEASE", "USE_REACHED", "COMPLETE"]) m.signal(s);
};

test("valid lifecycle reaches COMPLETE with ordered attestations", () => {
  const m = createHookMachine({ correlation_id: "corr_h" });
  assert.equal(m.current(), "CHECK_PENDING");
  assert.equal(m.isTerminal(), false);
  fullChain(m);
  assert.equal(m.current(), "COMPLETE");
  assert.equal(m.isTerminal(), true);
  assert.equal(m.isComplete(), true);
  const att = m.attestations();
  assert.deepEqual(att.map((a) => a.checkpoint), ["CHECK_REACHED", "HOLD", "RELEASE", "USE_REACHED", "COMPLETE"]);
  assert.deepEqual(att.map((a) => a.sequence), [1, 2, 3, 4, 5]);
  assert.ok(att.every((a) => a.source === "fixture"));
  assert.ok(Object.isFrozen(att));
});

test("illegal edges throw; terminal machines reject signals", () => {
  const m = createHookMachine();
  assert.throws(() => m.signal("RELEASE"), (e) => e?.code === "HOOK_INVALID_TRANSITION");
  assert.throws(() => m.signal("COMPLETE"), (e) => e?.code === "HOOK_INVALID_TRANSITION");
  assert.throws(() => m.signal(""), (e) => e?.code === "MODEL_VALIDATION");
  m.signal("CHECK_REACHED");
  assert.throws(() => m.signal("USE_REACHED"), (e) => e?.code === "HOOK_INVALID_TRANSITION");
  const done = createHookMachine();
  fullChain(done);
  assert.throws(() => done.signal("HOLD"), (e) => e?.code === "STALE_HOOK");
});

test("stuck machine reports non-completion (maps to hooks-incomplete)", () => {
  const m = createHookMachine();
  m.signal("CHECK_REACHED");
  assert.equal(m.isComplete(), false);
  assert.equal(m.current(), "CHECK_REACHED");
});

test("unsupported fixtures and machine detection", () => {
  const u = unsupportedHook("no instrumentation on fixture");
  assert.deepEqual([u.supported, u.reason], [false, "no instrumentation on fixture"]);
  assert.throws(() => unsupportedHook(""), /reason/);
  assert.equal(isHookMachine(createHookMachine()), true);
  assert.equal(isHookMachine(u), false);
  assert.equal(isHookMachine(null), false);
  assert.equal(isHookMachine({ signal: "x" }), false);
  assert.deepEqual([...HOOK_STATES], ["CHECK_PENDING", "CHECK_REACHED", "HOLD", "RELEASE", "USE_REACHED", "COMPLETE"]);
});
