/** Phase 1 §25 — scope gate: accept / reject / ambiguous / excluded / expired. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAuthorizedTarget } from "../scope/gate.mjs";
import { checkUrlSafety } from "../adapters/ssrf.mjs";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const stubSafe = async () => ({ safe: true, normalized: "https://example.com/" });
const stubUnsafe = async () => ({ safe: false, reason: "stub-blocked" });
const authz = (over = {}) => ({
  confirmed: true,
  allowedHosts: ["example.com"],
  ...over,
});
const tgt = (base_url = "https://example.com/app", extra = {}) => ({ target_id: "tgt_x", base_url, ...extra });

test("authorized target accepted (stubbed URL check keeps the test hermetic)", async () => {
  const d = await assertAuthorizedTarget({ target: tgt(), authorization: authz(), urlSafetyCheck: stubSafe, nowMs: NOW });
  assert.equal(d.decision, "allow");
  assert.equal(d.reason, "all-checks-passed");
  assert.ok(d.correlation_id.startsWith("corr_"));
  assert.ok(d.checks.every((c) => c.passed));
});

test("missing / unconfirmed / ambiguous authorization denied", async () => {
  for (const authorization of [null, undefined, {}, { confirmed: false, allowedHosts: ["example.com"] }, { confirmed: true }]) {
    const d = await assertAuthorizedTarget({ target: tgt(), authorization, urlSafetyCheck: stubSafe, nowMs: NOW });
    assert.equal(d.decision, "deny", JSON.stringify(authorization));
  }
  const noHosts = await assertAuthorizedTarget({ target: tgt(), authorization: authz({ allowedHosts: [] }), urlSafetyCheck: stubSafe, nowMs: NOW });
  assert.equal(noHosts.reason, "ambiguous-scope");
});

test("off-scope host and excluded path denied", async () => {
  const host = await assertAuthorizedTarget({
    target: tgt("https://evil.example.net/"), authorization: authz(), urlSafetyCheck: stubSafe, nowMs: NOW,
  });
  assert.equal(host.decision, "deny");
  assert.equal(host.reason, "host-not-allowed");
  const path = await assertAuthorizedTarget({
    target: tgt("https://example.com/admin/delete"),
    authorization: authz({ excludedPaths: ["/admin/delete"] }),
    urlSafetyCheck: stubSafe,
    nowMs: NOW,
  });
  assert.equal(path.reason, "excluded-path");
});

test("expired and not-yet-valid authorization denied", async () => {
  const expired = await assertAuthorizedTarget({
    target: tgt(), authorization: authz({ validUntil: "2026-10-01T00:00:00.000Z" }), urlSafetyCheck: stubSafe, nowMs: NOW,
  });
  assert.equal(expired.reason, "authorization-expired");
  const future = await assertAuthorizedTarget({
    target: tgt(), authorization: authz({ validFrom: "2026-11-01T00:00:00.000Z" }), urlSafetyCheck: stubSafe, nowMs: NOW,
  });
  assert.equal(future.reason, "authorization-not-yet-valid");
});

test("unsafe URL denied even when in scope (stub + throwing checker)", async () => {
  const d = await assertAuthorizedTarget({ target: tgt(), authorization: authz(), urlSafetyCheck: stubUnsafe, nowMs: NOW });
  assert.equal(d.reason, "ssrf-blocked");
  const throwing = await assertAuthorizedTarget({
    target: tgt(), authorization: authz(), urlSafetyCheck: async () => { throw new Error("boom"); }, nowMs: NOW,
  });
  assert.equal(throwing.reason, "ssrf-blocked");
});

test("real SSRF adapter: loopback refused, public IP literal passes (no DNS involved)", async () => {
  const loopback = await checkUrlSafety("http://127.0.0.1:5001/");
  assert.equal(loopback.safe, false);
  const publicIp = await checkUrlSafety("http://93.184.216.1/");
  assert.equal(publicIp.safe, true);
  // In-scope-on-paper loopback is still denied by the real guard (layering works).
  const d = await assertAuthorizedTarget({
    target: tgt("http://127.0.0.1:5001/"),
    authorization: authz({ allowedHosts: ["127.0.0.1"] }),
    nowMs: NOW,
  });
  assert.equal(d.decision, "deny");
  assert.equal(d.reason, "ssrf-blocked");
});
