/** Phase 1 §25 — model contracts: valid creation, required-field rejection. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTarget } from "../models/target.mjs";
import { createEndpoint } from "../models/endpoint.mjs";
import { createSecurityRequest, createSecurityResponse } from "../models/http.mjs";
import { createResource } from "../models/resource.mjs";
import { createWorkflow, createState, createTransition } from "../models/workflow.mjs";

const isModelError = (code) => (e) => e?.name === "SecurityEngineError" && e?.code === code;

test("target: valid creation, explicit non-authorizing default", () => {
  const t = createTarget({ base_url: "https://example.com/app", scope_reference: "scope:lab-01" });
  assert.ok(t.target_id.startsWith("tgt_"));
  assert.equal(t.host, "example.com");
  assert.equal(t.authorization_status, "unknown");
  assert.ok(Object.isFrozen(t));
});

test("target: rejects missing / non-http URLs", () => {
  assert.throws(() => createTarget({}), isModelError("MODEL_VALIDATION"));
  assert.throws(() => createTarget({ base_url: "ftp://example.com/x" }), isModelError("MODEL_VALIDATION"));
  assert.throws(() => createTarget({ base_url: "not-a-url" }), isModelError("MODEL_VALIDATION"));
});

test("endpoint: valid creation, unknown auth by default", () => {
  const e = createEndpoint({ host: "example.com", path: "/api/users", method: "get" });
  assert.equal(e.method, "GET");
  assert.equal(e.port, 443);
  assert.equal(e.authentication_context, "unknown");
  assert.deepEqual(e.parameters, []);
});

test("endpoint: rejects bad method and parameter values", () => {
  assert.throws(() => createEndpoint({ host: "example.com", method: "GE T" }), isModelError("MODEL_VALIDATION"));
  assert.throws(
    () => createEndpoint({ host: "example.com", parameters: [{ name: "id", location: "query", value: "1" }] }),
    isModelError("SECRET_REFUSED")
  );
});

test("request: headers stored as names only, body as hash only", () => {
  const r = createSecurityRequest({
    method: "POST",
    url: "https://example.com/api/login",
    headers: { Authorization: "Bearer s3cr3t-AAA", "Content-Type": "application/json" },
    parameters: [{ name: "q", location: "query" }],
    body: "password=hunter2-BBB",
  });
  const names = r.headers_metadata.map((h) => h.name).sort();
  assert.deepEqual(names, ["authorization", "content-type"]);
  assert.equal(r.headers_metadata.find((h) => h.name === "authorization").redacted, true);
  assert.equal(r.headers_metadata.find((h) => h.name === "content-type").redacted, false);
  assert.ok(r.body_hash && r.body_hash.length === 64);
  const dumped = JSON.stringify(r);
  assert.ok(!dumped.includes("s3cr3t-AAA") && !dumped.includes("hunter2-BBB"));
});

test("request: parameter values refused, bad URL refused", () => {
  assert.throws(
    () => createSecurityRequest({ method: "GET", url: "https://example.com/", parameters: [{ name: "a", location: "query", value: "1" }] }),
    isModelError("SECRET_REFUSED")
  );
  assert.throws(
    () => createSecurityRequest({ method: "GET", url: "gopher://example.com/" }),
    isModelError("MODEL_VALIDATION")
  );
});

test("response: validates status, keeps hash + indicators", () => {
  const r = createSecurityResponse({ status: 200, body: "hello", state_indicators: ["remaining=3"], timing_ms: 41 });
  assert.equal(r.body_length, 5);
  assert.deepEqual(r.state_indicators, ["remaining=3"]);
  assert.throws(() => createSecurityResponse({ status: 99 }), isModelError("MODEL_VALIDATION"));
  assert.throws(() => createSecurityResponse({ status: 200, timing_ms: -1 }), isModelError("MODEL_VALIDATION"));
});

test("resource / workflow / state / transition: valid creation + rejection", () => {
  const res = createResource({ resource_type: "document", external_identifier: "doc-9", tenant_id: "t-a" });
  assert.ok(res.resource_id.startsWith("res_"));
  assert.throws(() => createResource({}), isModelError("MODEL_VALIDATION"));
  assert.throws(() => createResource({ resource_type: "x", endpoint_references: "nope" }), isModelError("MODEL_VALIDATION"));
  const w = createWorkflow({ name: "checkout", steps: [{ name: "add" }, { name: "pay", endpoint_reference: "ep-1" }] });
  assert.equal(w.steps[1].order, 1);
  assert.throws(() => createWorkflow({ name: "x", steps: ["nope"] }), isModelError("MODEL_VALIDATION"));
  const s = createState({ name: "paid", indicators: ["balance=0"] });
  assert.ok(s.state_id.startsWith("stt_"));
  const t = createTransition({ from_state: s.state_id, to_state: "shipped" });
  assert.equal(t.to_state, "shipped");
  assert.throws(() => createTransition({ from_state: "a" }), isModelError("MODEL_VALIDATION"));
});
