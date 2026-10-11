import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Configure the Upstash backend BEFORE store.mjs is loaded (module scope runs
// before any dynamic import below).
process.env.UPSTASH_REDIS_REST_URL = 'https://mock-upstash.test/';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

// Minimal in-memory emulation of the Upstash REST command API.
const kv = new Map();
const calls = [];
globalThis.fetch = async (_url, opts) => {
  const cmd = JSON.parse(opts.body);
  calls.push(cmd);
  const [op, key, val] = cmd;
  if (op === 'GET') return { ok: true, json: async () => ({ result: kv.has(key) ? kv.get(key) : null }) };
  if (op === 'SET') { kv.set(key, String(val)); return { ok: true, json: async () => ({ result: 'OK' }) }; }
  return { ok: false, status: 400, json: async () => ({ error: 'unsupported' }) };
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csi-store-up-'));
let store;

before(async () => {
  store = await import('../web/store.mjs');
});

test('store: uses upstash mode when credentials are present', () => {
  assert.equal(store.mode(), 'upstash');
});

test('store: loads existing data from upstream (ignores empty local file)', async () => {
  const localFile = path.join(tmp, 'users.json');
  kv.set('users_up', JSON.stringify([{ id: 'u1' }]));
  store.register('users_up', localFile);

  await store.initStore();

  assert.deepEqual(store.getStore('users_up'), [{ id: 'u1' }]);
});

test('store: setStore writes through to upstream', async () => {
  store.setStore('users_up', [{ id: 'u1' }, { id: 'u2' }]);
  await new Promise((r) => setTimeout(r, 20));

  assert.deepEqual(JSON.parse(kv.get('users_up')).map((u) => u.id), ['u1', 'u2']);
  assert.ok(calls.some((c) => c[0] === 'SET' && c[1] === 'users_up'));
});

test('store: seeds upstream from a non-empty local file on first boot', async () => {
  const localFile = path.join(tmp, 'messages.json');
  fs.writeFileSync(localFile, JSON.stringify([{ id: 'm1' }]), 'utf8');

  assert.equal(kv.has('msgs_up'), false); // not present upstream yet

  const fresh = await import('../web/store.mjs?seed=' + Date.now());
  fresh.register('msgs_up', localFile);
  await fresh.initStore();

  assert.deepEqual(JSON.parse(kv.get('msgs_up')), [{ id: 'm1' }]);
  assert.deepEqual(fresh.getStore('msgs_up'), [{ id: 'm1' }]);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
