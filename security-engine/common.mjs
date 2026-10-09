/**
 * common.mjs — shared primitives for security-engine (Phase 1 foundation).
 *
 * Pure and dependency-free except node:crypto. No network access, no logging,
 * no persistence. Every other security-engine module builds on these helpers.
 */
import { createHash, randomBytes } from "node:crypto";

export class SecurityEngineError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "SecurityEngineError";
    this.code = code;
    this.details = details;
  }
}

/** Explicit fail-closed states. Any other outcome string is a caller bug. */
export const FAIL_STATES = Object.freeze(["blocked", "not_ready", "inconclusive"]);

export function isFailState(s) {
  return FAIL_STATES.includes(s);
}

export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function requireObject(v, name) {
  if (!isPlainObject(v)) {
    throw new SecurityEngineError("MODEL_VALIDATION", `${name} must be an object`);
  }
  return v;
}

export function requireNonEmptyString(v, name) {
  if (typeof v !== "string" || !v.trim()) {
    throw new SecurityEngineError("MODEL_VALIDATION", `${name} must be a non-empty string`);
  }
  return v.trim();
}

export function optionalString(v, name, { allowNull = true } = {}) {
  if (v === undefined || (v === null && allowNull)) return null;
  if (typeof v !== "string") {
    throw new SecurityEngineError("MODEL_VALIDATION", `${name} must be a string`);
  }
  return v;
}

export function requireStringArray(v, name) {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new SecurityEngineError("MODEL_VALIDATION", `${name} must be an array of strings`);
  }
  return [...v];
}

export function requireEnum(v, name, allowed) {
  if (!allowed.includes(v)) {
    throw new SecurityEngineError(
      "MODEL_VALIDATION",
      `${name} must be one of: ${allowed.join(", ")}`
    );
  }
  return v;
}

export function isoNow() {
  return new Date().toISOString();
}

/** Shallow-immutable record: copies the object, freezes nested arrays/objects. */
export function freezeRecord(obj) {
  const copy = { ...obj };
  for (const k of Object.keys(copy)) {
    if (Array.isArray(copy[k])) copy[k] = Object.freeze([...copy[k]]);
    else if (isPlainObject(copy[k])) copy[k] = Object.freeze({ ...copy[k] });
  }
  return Object.freeze(copy);
}

export function sha256Hex(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function randomHex(bytes = 4) {
  return randomBytes(bytes).toString("hex");
}

/**
 * Header/field names whose VALUES must never be persisted.
 * The engine stores header *names* only (see headersToMetadata), so these
 * can never leak through values — the flag exists for audit clarity.
 */
export const SENSITIVE_KEYS = new Set([
  "password", "passwd", "pwd", "pass",
  "token", "access-token", "refresh-token", "id-token",
  "bearer", "authorization", "proxy-authorization",
  "cookie", "set-cookie", "session", "sessionid", "session-id", "sid",
  "apikey", "api-key", "api_key", "secret", "client-secret",
  "jwt", "credential", "credentials", "auth", "x-api-key", "x-auth-token",
]);

export function isSensitiveKey(name) {
  return SENSITIVE_KEYS.has(String(name).toLowerCase().trim());
}

/**
 * headersToMetadata — keep header NAMES only, flag sensitive ones.
 * Values are never persisted (not even for innocuous headers): names suffice
 * for differential analysis and no secret can leak through a value.
 * Accepts a plain object or an array of names / [name, value] pairs.
 */
export function headersToMetadata(headers) {
  if (headers === undefined || headers === null) return [];
  const rawNames = Array.isArray(headers)
    ? headers.map((h) => (Array.isArray(h) ? h[0] : h?.name)).filter(Boolean)
    : Object.keys(headers);
  const seen = new Set();
  const out = [];
  for (const raw of rawNames) {
    const name = String(raw).toLowerCase().trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, redacted: isSensitiveKey(name) });
  }
  return out;
}

/** Bounded preview: always explicit about truncation, always keeps the hash. */
export function truncatePreview(text, limit = 512) {
  const s = String(text);
  if (s.length <= limit) return { text: s, truncated: false, hash: sha256Hex(s) };
  return { text: s.slice(0, limit), truncated: true, hash: sha256Hex(s) };
}
