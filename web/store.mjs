import fs from 'fs';

// Persistent JSON store for MUTABLE runtime data (users, contact messages).
//
// Render's free filesystem is ephemeral: it is wiped on every redeploy — and the
// data-update workflow redeploys the service every few hours. Anything written to
// disk at runtime would be lost. To survive that we keep the source of truth in
// an external key/value store (Upstash Redis REST, free tier) while keeping an
// in-memory copy so the hot path stays synchronous.
//
// Storage modes:
//   - 'upstash' : UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set → durable.
//   - 'file'    : fallback for local dev / self-hosted. NOT durable on Render.

const registry = new Map(); // key -> absolute file path
const memory = new Map();   // key -> parsed JSON value
let initialized = false;

function storeEnv() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return { url, token };
}

/** Current storage backend: 'upstash' (durable) or 'file' (ephemeral). */
export function mode() {
  const { url, token } = storeEnv();
  return url && token ? 'upstash' : 'file';
}

/** Register a JSON document under `key`, backed locally by `filePath`. */
export function register(key, filePath) {
  registry.set(key, filePath);
}

function readFile(filePath) {
  try {
    const v = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeFile(filePath, value) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  } catch (e) {
    console.error(`[store] file write failed (${filePath}): ${e.message}`);
  }
}

async function upstash(command) {
  const { url, token } = storeEnv();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

/**
 * Load every registered document into memory once, at startup, BEFORE the HTTP
 * server starts listening. On the Upstash path this also migrates any existing
 * local file into the remote store (one-time seed).
 */
export async function initStore() {
  if (initialized) return;
  for (const [key, filePath] of registry) {
    let value = null;
    if (mode() === 'upstash') {
      try {
        const raw = await upstash(['GET', key]);
        if (raw != null && raw !== '') value = JSON.parse(raw);
      } catch (e) {
        console.error(`[store] upstream load failed for '${key}': ${e.message}`);
      }
    }
    if (!Array.isArray(value)) {
      value = readFile(filePath);
      if (mode() === 'upstash' && value.length) {
        try { await upstash(['SET', key, JSON.stringify(value)]); }
        catch (e) { console.error(`[store] seed failed for '${key}': ${e.message}`); }
      }
    }
    memory.set(key, value);
  }
  initialized = true;
  const keys = [...registry.keys()].join(', ') || '(none)';
  console.log(`[store] mode=${mode()} initialized [${keys}]`);
}

export function getStore(key) {
  if (memory.has(key)) return memory.get(key);
  const filePath = registry.get(key);
  const value = filePath ? readFile(filePath) : [];
  memory.set(key, value);
  return value;
}

/** Update in memory immediately (synchronous) and persist without blocking. */
export function setStore(key, value) {
  memory.set(key, value);
  const filePath = registry.get(key);
  if (filePath) writeFile(filePath, value);
  if (mode() === 'upstash') {
    upstash(['SET', key, JSON.stringify(value)]).catch((e) =>
      console.error(`[store] upstream save failed for '${key}': ${e.message}`)
    );
  }
}
