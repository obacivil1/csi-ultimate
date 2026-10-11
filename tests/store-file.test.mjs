import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register, initStore, getStore, setStore, mode } from '../web/store.mjs';

// No UPSTASH_* env vars → file fallback (local dev / self-host path).

test('store: defaults to file mode without Upstash env', () => {
  assert.equal(mode(), 'file');
});

test('store: file mode persists to disk and reloads into memory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csi-store-'));
  const file = path.join(dir, 'users.json');
  fs.writeFileSync(file, JSON.stringify([{ id: 'a' }]), 'utf8');

  register('users_test_file', file);
  await initStore();

  const users = getStore('users_test_file');
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 'a');

  users.push({ id: 'b' });
  setStore('users_test_file', users);

  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(onDisk.map((u) => u.id), ['a', 'b']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('store: missing file yields an empty array (no throw)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csi-store-'));
  register('missing_test', path.join(dir, 'nope.json'));
  await initStore();
  assert.deepEqual(getStore('missing_test'), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
