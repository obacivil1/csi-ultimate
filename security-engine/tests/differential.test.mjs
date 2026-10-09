/** Phase 1 §25 — differential analysis: same / different / inconclusive. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareResponses, compareObservations } from "../comparison/differential.mjs";
import { createSecurityResponse } from "../models/http.mjs";

const rsp = (over = {}) =>
  createSecurityResponse({
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: '{"role":"member"}',
    timing_ms: 100,
    state_indicators: ["remaining=3"],
    ...over,
  });

test("identical responses compare same", () => {
  const out = compareResponses(rsp(), rsp());
  assert.equal(out.verdict, "same");
  assert.ok(out.categories.every((c) => c.verdict === "same"));
});

test("status / body / header differences detected", () => {
  const statusDiff = compareResponses(rsp(), rsp({ status: 403 }));
  assert.equal(statusDiff.verdict, "different");
  assert.equal(statusDiff.categories.find((c) => c.category === "status").verdict, "different");
  const bodyDiff = compareResponses(rsp(), rsp({ body: '{"role":"admin"}' }));
  assert.equal(bodyDiff.categories.find((c) => c.category === "bodyHash").verdict, "different");
  const headerDiff = compareResponses(rsp(), rsp({ headers: { "Content-Type": "application/json", "X-Extra": "1" } }));
  assert.equal(headerDiff.categories.find((c) => c.category === "headers").verdict, "different");
});

test("missing signals are inconclusive, not same", () => {
  // Identical in every recorded signal except timing, which neither side has.
  const a = createSecurityResponse({ status: 200, headers: { "Content-Type": "text/plain" }, body: "x" });
  const b = createSecurityResponse({ status: 200, headers: { "Content-Type": "text/plain" }, body: "x" });
  const out = compareResponses(a, b);
  const timing = out.categories.find((c) => c.category === "timing");
  assert.equal(timing.verdict, "inconclusive");
  assert.ok(out.categories.filter((c) => c.category !== "timing").every((c) => c.verdict === "same"));
  // Everything known is same, but one signal is unknown → overall inconclusive.
  assert.equal(out.verdict, "inconclusive");
});

test("timing tolerance honored", () => {
  const close = compareResponses(rsp({ timing_ms: 100 }), rsp({ timing_ms: 120 }), { toleranceMs: 50 });
  assert.equal(close.categories.find((c) => c.category === "timing").verdict, "same");
  const far = compareResponses(rsp({ timing_ms: 100 }), rsp({ timing_ms: 900 }), { toleranceMs: 50 });
  assert.equal(far.categories.find((c) => c.category === "timing").verdict, "different");
  assert.equal(far.verdict, "different");
});

test("field subsets restrict the comparison", () => {
  const out = compareResponses(rsp({ status: 200 }), rsp({ status: 500 }), { fields: ["bodyHash"] });
  assert.equal(out.verdict, "same");
  assert.deepEqual(out.categories.map((c) => c.category), ["bodyHash"]);
  assert.throws(() => compareResponses(rsp(), rsp(), { fields: ["nope"] }), (e) => e?.code === "DIFFERENTIAL_VALIDATION");
});

test("observations: context noted; verdict needs responses", () => {
  const a = { observation_id: "o1", target_id: "t", endpoint_id: "e", identity_id: "a" };
  const b = { observation_id: "o2", target_id: "t", endpoint_id: "e", identity_id: "b" };
  const noResp = compareObservations(a, b);
  assert.equal(noResp.verdict, "inconclusive");
  assert.equal(noResp.notes.sameIdentity, false);
  assert.equal(noResp.notes.sameEndpoint, true);
  const withResp = compareObservations(a, { ...b, identity_id: "a" }, { responseA: rsp(), responseB: rsp() });
  assert.equal(withResp.verdict, "same");
  assert.equal(withResp.notes.sameIdentity, true);
});
