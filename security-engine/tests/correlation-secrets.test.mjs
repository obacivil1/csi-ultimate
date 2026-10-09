/** Phase 1 §25 — correlation traceability + secret-safety of serialized output. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { newId, newTrace, newCorrelationId } from "../correlation.mjs";
import { createSecurityRequest, createSecurityResponse } from "../models/http.mjs";
import { createObservation } from "../models/observation.mjs";
import { createEvidence } from "../models/evidence.mjs";
import { createFinding } from "../models/finding.mjs";

test("ids are prefixed and unique", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newId("tst")));
  assert.equal(ids.size, 200);
  assert.ok([...ids].every((id) => id.startsWith("tst_")));
  const trace = newTrace();
  assert.ok(trace.correlation_id.startsWith("corr_") && trace.execution_id.startsWith("exec_"));
  assert.notEqual(trace.correlation_id, newCorrelationId());
});

test("execution → request → observation → evidence → finding chain links up", () => {
  const correlation_id = newCorrelationId();
  const req = createSecurityRequest({ method: "GET", url: "https://example.com/api/docs/7", correlation_id });
  const rsp = createSecurityResponse({ status: 200, body: "{}", correlation_id, request_id: req.request_id });
  const obs = createObservation({
    correlation_id,
    target_id: "tgt_1",
    endpoint_id: "ep_1",
    identity_id: "idn_a",
    request_reference: req.request_id,
    response_reference: rsp.response_id,
  });
  const ev = createEvidence({ observation_id: obs.observation_id, type: "hash-only", description: "status 200, empty body" });
  const fin = createFinding({
    finding_type: "general",
    title: "chained",
    expected_boundary: "b",
    observed_behavior: "o",
    security_relevance: "s",
    evidence_references: [ev.evidence_id],
    reproduction_reference: "repro:chain",
    confidence: { level: "low", score: 0.3, reasons: ["once"], rationale: "r" },
    impact: { level: "low", rationale: "r" },
    severity: { level: "low", rationale: "r" },
    scope_status: { decision: "allow" },
  });
  assert.equal(obs.request_reference, req.request_id);
  assert.equal(ev.observation_id, obs.observation_id);
  assert.deepEqual(fin.evidence_references, [ev.evidence_id]);
});

test("no secret material survives in normal serialized output", () => {
  const req = createSecurityRequest({
    method: "POST",
    url: "https://example.com/api/login",
    headers: { Authorization: "Bearer s3cr3t-AAA", Cookie: "sess=CCC", "X-Custom": "plain" },
    body: "password=hunter2-BBB",
  });
  const rsp = createSecurityResponse({ status: 200, headers: { "Set-Cookie": "sess=DDD" }, body: "token=EEE" });
  const obs = createObservation({ correlation_id: newCorrelationId(), signals: ["login=ok"] });
  const ev = createEvidence({ observation_id: obs.observation_id, type: "redacted-excerpt", description: "login returned 200" });
  const dumped = [req, rsp, obs, ev].map((o) => JSON.stringify(o)).join("\n");
  for (const secret of ["s3cr3t-AAA", "sess=CCC", "hunter2-BBB", "sess=DDD", "token=EEE"]) {
    assert.ok(!dumped.includes(secret), `leaked: ${secret}`);
  }
});
