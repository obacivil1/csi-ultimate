/**
 * scope/gate.mjs — unified security-engine scope gate (§18).
 *
 * Single conceptual entry point: assertAuthorizedTarget(). It orchestrates
 * the applicable existing controls without rewriting them:
 *   1. explicit authorization context (deny when missing/ambiguous/expired);
 *   2. exact-host allowlist + excluded paths (deny otherwise);
 *   3. existing SSRF protection via the adapters/ssrf.mjs bridge.
 *
 * Fail-closed throughout: any doubt yields { decision: "deny", ... }.
 * The urlSafetyCheck and clock are injectable so unit tests stay hermetic
 * (no DNS, no network) while production uses the real SSRF guard.
 */
import {
  requireNonEmptyString,
  freezeRecord,
} from "../common.mjs";
import { newCorrelationId } from "../correlation.mjs";
import { checkUrlSafety } from "../adapters/ssrf.mjs";

function check(name, passed, detail = null) {
  return Object.freeze({ name, passed, detail });
}

function matchHost(hostname, port, allowedHosts) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const candidates = new Set([host, `${host}:${port}`]);
  for (const raw of allowedHosts) {
    if (candidates.has(String(raw).toLowerCase().replace(/\.$/, ""))) return true;
  }
  return false;
}

function pathExcluded(pathname, excludedPaths) {
  const path = pathname || "/";
  for (const raw of excludedPaths) {
    const ex = String(raw);
    if (!ex) continue;
    const norm = ex.endsWith("/") && ex.length > 1 ? ex.slice(0, -1) : ex;
    if (path === norm || path.startsWith(norm.endsWith("/") ? norm : `${norm}/`)) return ex;
  }
  return null;
}

export async function assertAuthorizedTarget({
  target,
  authorization,
  urlSafetyCheck = checkUrlSafety,
  nowMs = Date.now(),
} = {}) {
  const checks = [];
  const correlationId = newCorrelationId();
  const deny = (reason, extraChecks = []) =>
    freezeRecord({
      decision: "deny",
      reason,
      checks: Object.freeze([...checks, ...extraChecks]),
      target_id: target?.target_id ?? null,
      correlation_id: correlationId,
    });

  if (!target || typeof target !== "object") {
    return deny("missing-target", [check("target-present", false, "target object required")]);
  }
  let baseUrl;
  try {
    baseUrl = requireNonEmptyString(target.base_url, "target.base_url");
  } catch {
    return deny("missing-target-url", [check("target-url-present", false, "base_url required")]);
  }
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return deny("malformed-url", [check("url-parseable", false, "base_url is not a URL")]);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return deny("unsupported-scheme", [check("url-scheme", false, "only http/https allowed")]);
  }
  checks.push(check("url-parseable", true));

  if (!authorization || typeof authorization !== "object") {
    return deny("missing-authorization", [check("authorization-present", false, "authorization context required")]);
  }
  checks.push(check("authorization-present", true));
  if (authorization.confirmed !== true) {
    return deny("not-confirmed", [check("authorization-confirmed", false, "explicit confirmation required")]);
  }
  checks.push(check("authorization-confirmed", true));

  const allowedHosts = authorization.allowedHosts;
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0 || allowedHosts.some((h) => typeof h !== "string" || !h.trim())) {
    return deny("ambiguous-scope", [
      check("scope-explicit", false, "exact allowedHosts list required — wildcards and omissions denied"),
    ]);
  }
  checks.push(check("scope-explicit", true));
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  if (!matchHost(parsed.hostname, port, allowedHosts)) {
    return deny("host-not-allowed", [
      check("host-allowlisted", false, `${parsed.hostname} is not in the authorization scope`),
    ]);
  }
  checks.push(check("host-allowlisted", true));

  const excluded = Array.isArray(authorization.excludedPaths) ? authorization.excludedPaths : [];
  const hit = pathExcluded(parsed.pathname, excluded);
  if (hit) {
    return deny("excluded-path", [check("path-allowed", false, `path falls under excluded ${hit}`)]);
  }
  checks.push(check("path-allowed", true));

  if (authorization.validFrom !== undefined && authorization.validFrom !== null) {
    const from = Date.parse(authorization.validFrom);
    if (Number.isNaN(from)) {
      return deny("ambiguous-scope", [check("validity-parseable", false, "validFrom is not a date")]);
    }
    if (nowMs < from) {
      return deny("authorization-not-yet-valid", [check("validity-window", false, "authorization starts in the future")]);
    }
  }
  if (authorization.validUntil !== undefined && authorization.validUntil !== null) {
    const until = Date.parse(authorization.validUntil);
    if (Number.isNaN(until)) {
      return deny("ambiguous-scope", [check("validity-parseable", false, "validUntil is not a date")]);
    }
    if (nowMs > until) {
      return deny("authorization-expired", [check("validity-window", false, "authorization window has passed")]);
    }
  }
  checks.push(check("validity-window", true));

  let safety;
  try {
    safety = await urlSafetyCheck(baseUrl);
  } catch (e) {
    safety = { safe: false, reason: e?.message || "safety-check-failed" };
  }
  if (!safety || safety.safe !== true) {
    return deny("ssrf-blocked", [
      check("url-public", false, safety?.reason || "existing SSRF protection refused the URL"),
    ]);
  }
  checks.push(check("url-public", true, safety.normalized ?? null));

  return freezeRecord({
    decision: "allow",
    reason: "all-checks-passed",
    checks: Object.freeze(checks),
    target_id: target?.target_id ?? null,
    correlation_id: correlationId,
  });
}
