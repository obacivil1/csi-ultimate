/** Phase 1 §25 — HTTP adapter: descriptors carry no secrets; results fold safely. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toTransportDescriptor, fromTransportResult } from "../adapters/http.mjs";
import { createSecurityRequest } from "../models/http.mjs";
import { checkUrlSafety } from "../adapters/ssrf.mjs";

test("descriptor: method/url/names only, credentials never attached", () => {
  const req = createSecurityRequest({
    method: "get",
    url: "https://example.com/api/docs/42",
    headers: { Cookie: "sess=CCC", "Content-Type": "application/json" },
    parameters: [{ name: "id", location: "path" }],
  });
  const d = toTransportDescriptor(req);
  assert.equal(d.method, "GET");
  assert.equal(d.url, "https://example.com/api/docs/42");
  assert.deepEqual([...d.header_names].sort(), ["content-type", "cookie"]);
  assert.deepEqual(d.parameter_names, ["path:id"]);
  assert.equal(d.transport_policy.attachCredentials, false);
  assert.ok(!JSON.stringify(d).includes("sess=CCC"));
});

test("fromTransportResult: folds a completed result into a safe response", () => {
  const r = fromTransportResult(
    {
      status: 403,
      headers: { "Content-Type": "text/html", "Set-Cookie": "sess=CCC" },
      body: "<html>denied</html>",
      timingMs: 120,
      stateIndicators: ["waf=1"],
    },
    { request_id: "req_1", correlation_id: "corr_1" }
  );
  assert.equal(r.status, 403);
  assert.equal(r.request_id, "req_1");
  assert.equal(r.correlation_id, "corr_1");
  assert.equal(r.timing_ms, 120);
  assert.ok(r.body_hash && r.body_hash.length === 64);
  assert.ok(!JSON.stringify(r).includes("sess=CCC"));
  assert.throws(() => fromTransportResult({ status: "ok" }), /status/);
});

test("ssrf adapter: never throws, always data", () => {
  return Promise.resolve()
    .then(() => checkUrlSafety("http://127.0.0.1:5001/"))
    .then((loopback) => {
      assert.equal(loopback.safe, false);
      return checkUrlSafety("http://93.184.216.1/");
    })
    .then((pub) => assert.equal(pub.safe, true));
});
