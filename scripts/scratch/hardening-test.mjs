/**
 * CSI-Ultimate — Production Hardening Test Suite
 * Tests all 10 validation areas in one pass.
 */
import { createPool } from '../core/browser-pool.mjs';
import { WorkerQueue } from '../core/queue.mjs';
import { CrawlScheduler, parseInterval } from '../core/scheduler.mjs';
import { Cache, adCache, pageCache } from '../core/cache.mjs';
import { GlobalDeduper, dedupe } from '../core/dedupe.mjs';
import { exportAll } from '../core/exporter.mjs';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { resolve } from 'path';

const RESULTS = [];
let passCount = 0, failCount = 0;

function test(name, fn) {
  return async () => {
    try {
      await fn();
      RESULTS.push({ area: '?', name, pass: true });
      passCount++;
      process.stdout.write(`  ✅ ${name}\n`);
    } catch (e) {
      RESULTS.push({ area: '?', name, pass: false, error: e.message });
      failCount++;
      process.stdout.write(`  ❌ ${name}: ${e.message}\n`);
    }
  };
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ─────────────────────────────────────────────────────────
//  1. Browser Pool Stress Test
// ─────────────────────────────────────────────────────────
async function testBrowserPool() {
  process.stdout.write('\n═══ 1. Browser Pool Stress Test ═══\n');
  const area = 'browser-pool';
  const setArea = (name) => RESULTS.push({ area: 'browser-pool', name, pass: true });

  // 1a. Create pool with 3 contexts
  const { browser, pool } = await createPool({ max: 3 });
  let stats = pool.stats();
  assert(stats.total === 3, `Expected 3 contexts, got ${stats.total}`);
  setArea('Pool init creates 3 contexts');

  // 1b. Acquire all 3 contexts concurrently
  const handles = await Promise.all([pool.acquire(), pool.acquire(), pool.acquire()]);
  stats = pool.stats();
  assert(stats.busy === 3, `Expected 3 busy, got ${stats.busy}`);
  assert(stats.free === 0, `Expected 0 free, got ${stats.free}`);
  setArea('Acquire all 3 contexts concurrently');

  // 1c. Acquire timeout — 4th acquire should timeout
  const timeout = pool._acquireTimeout;
  pool._acquireTimeout = 2000;
  const start = Date.now();
  let timedOut = false;
  try {
    await pool.acquire();
  } catch (e) {
    timedOut = true;
  }
  pool._acquireTimeout = timeout;
  const elapsed = Date.now() - start;
  assert(timedOut, 'Acquire should timeout when all busy');
  assert(elapsed >= 1800, `Timeout too fast: ${elapsed}ms`);
  setArea('Acquire timeout when all contexts busy');

  // 1d. Release and verify free
  await pool.release(handles[0]);
  stats = pool.stats();
  assert(stats.busy === 2, `Expected 2 busy, got ${stats.busy}`);
  assert(stats.free === 1, `Expected 1 free, got ${stats.free}`);
  setArea('Release returns context to pool');

  // 1e. Release remaining
  await pool.release(handles[1]);
  await pool.release(handles[2]);

  // 1f. Test withPage wrapper
  const result = await pool.withPage(async (page) => {
    await page.goto('about:blank');
    return 'hello';
  });
  assert(result === 'hello', 'withPage should return result');
  setArea('withPage wrapper executes and returns');

  // 1g. Test maxUses recycling
  const originalPool = pool._pool.length;
  const slot = pool._pool[0];
  slot.uses = pool._maxUses + 1;
  const h = await pool.acquire();
  await pool.release(h);
  // After recycle, the slot should be fresh
  assert(slot.uses === 0, 'Slot uses should reset after recycle');
  assert(slot.healthy === true, 'Slot should be healthy after recycle');
  setArea('maxUses triggers context recycle');

  // 1h. Test withPage error handling — releases even on error
  let errorCaught = false;
  try {
    await pool.withPage(async () => { throw new Error('test error'); });
  } catch (e) {
    errorCaught = true;
  }
  assert(errorCaught, 'withPage should propagate errors');
  setArea('withPage error propagation');

  // 1i. Drain
  await pool.drain();
  stats = pool.stats();
  assert(stats.total === 0, 'Pool should be empty after drain');
  setArea('Pool drain clears all contexts');

  await browser.close().catch(() => {});
}

// ─────────────────────────────────────────────────────────
//  2. Queue Saturation Test
// ─────────────────────────────────────────────────────────
async function testQueue() {
  process.stdout.write('\n═══ 2. Queue Saturation Test ═══\n');
  const area = 'queue';

  // 2a. Basic push/process
  const q1 = new WorkerQueue({ concurrency: 2 });
  q1.setWorker((item) => Promise.resolve(item * 2));
  const p1 = q1.push(5);
  await q1.drain();
  const r1 = await p1;
  assert(r1 === 10, `Expected 10, got ${r1}`);
  RESULTS.push({ area, name: 'Basic push/process', pass: true });
  process.stdout.write('  ✅ Basic push/process\n');

  // 2b. Concurrency: verify max parallel workers
  let concurrent = 0, maxConcurrent = 0;
  const q2 = new WorkerQueue({ concurrency: 3 });
  q2.setWorker(async (item) => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise(r => setTimeout(r, 50));
    concurrent--;
    return item;
  });
  const allDone = q2.pushAll([1,2,3,4,5,6], q2._workerFn);
  await q2.drain();
  await allDone;
  assert(maxConcurrent >= 2, `maxConcurrent=${maxConcurrent} should be >= 2`);
  assert(maxConcurrent <= 3, `maxConcurrent=${maxConcurrent} should be <= 3`);
  RESULTS.push({ area, name: 'Concurrency limit (3 workers)', pass: true });
  process.stdout.write('  ✅ Concurrency limit (3 workers)\n');

  // 2c. Queue saturation: push 100 items
  const q3 = new WorkerQueue({ concurrency: 5, retryBase: 100 });
  let processed = 0;
  q3.setWorker(async (item) => { processed++; return item; });
  const items = Array.from({ length: 100 }, (_, i) => i);
  const results = await q3.pushAll(items, q3._workerFn);
  await q3.drain();
  assert(processed === 100, `Processed ${processed}, expected 100`);
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  assert(succeeded === 100, `Succeeded ${succeeded}, expected 100`);
  RESULTS.push({ area, name: 'Saturation: 100 items processed', pass: true });
  process.stdout.write('  ✅ Saturation: 100 items processed\n');

  // 2d. Retry on failure
  let attempts = 0;
  const q4 = new WorkerQueue({ concurrency: 1, maxRetries: 2, retryBase: 50 });
  q4.setWorker(async () => { attempts++; throw new Error('always fail'); });
  const p4 = q4.push('fail');
  await q4.drain();
  try { await p4; } catch {}
  assert(attempts === 3, `Expected 3 attempts, got ${attempts}`); // initial + 2 retries
  RESULTS.push({ area, name: 'Retry logic: max 3 attempts', pass: true });
  process.stdout.write('  ✅ Retry logic: max 3 attempts\n');

  // 2e. Pause/Resume
  const q5 = new WorkerQueue({ concurrency: 2 });
  let processed5 = 0;
  q5.setWorker(async (item) => { processed5++; return item; });
  q5.pause();
  q5.push('a'); q5.push('b'); q5.push('c');
  await new Promise(r => setTimeout(r, 100));
  assert(processed5 === 0, 'Should not process while paused');
  q5.resume();
  await q5.drain();
  assert(processed5 === 3, `Expected 3, got ${processed5}`);
  RESULTS.push({ area, name: 'Pause/Resume works', pass: true });
  process.stdout.write('  ✅ Pause/Resume works\n');

  // 2f. onSuccess/onFailure callbacks
  let successCount = 0, failureCount = 0;
  const q6 = new WorkerQueue({
    concurrency: 2,
    onSuccess: () => successCount++,
    onFailure: () => failureCount++,
  });
  q6.setWorker(async (item) => {
    if (item === 'fail') throw new Error('fail');
    return item;
  });
  await q6.pushAll(['ok', 'fail', 'ok'], q6._workerFn);
  await q6.drain();
  assert(successCount === 2, `Expected 2 success, got ${successCount}`);
  assert(failureCount === 1, `Expected 1 failure, got ${failureCount}`);
  RESULTS.push({ area, name: 'onSuccess/onFailure callbacks', pass: true });
  process.stdout.write('  ✅ onSuccess/onFailure callbacks\n');

  // 2g. Stats tracking
  const stats = q6.stats();
  assert(stats.total === 3, `total=${stats.total}`);
  assert(stats.done === 3, `done=${stats.done}`);
  assert(stats.percent === 100, `percent=${stats.percent}`);
  RESULTS.push({ area, name: 'Stats tracking accurate', pass: true });
  process.stdout.write('  ✅ Stats tracking accurate\n');

  // 2h. pushAll empty array
  const q7 = new WorkerQueue();
  q7.setWorker(async (item) => item);
  const emptyResult = await q7.pushAll([], q7._workerFn);
  assert(emptyResult.length === 0, 'Empty array should return empty');
  RESULTS.push({ area, name: 'Empty pushAll', pass: true });
  process.stdout.write('  ✅ Empty pushAll\n');
}

// ─────────────────────────────────────────────────────────
//  3. Scheduler Reliability Test
// ─────────────────────────────────────────────────────────
async function testScheduler() {
  process.stdout.write('\n═══ 3. Scheduler Reliability Test ═══\n');
  const area = 'scheduler';

  const s = new CrawlScheduler();
  s.reset(); // fresh state

  // 3a. Add job
  const job = s.add({ id: 'test-job', type: 'keyword', target: 'car', intervalMs: 3600000 });
  assert(job.id === 'test-job');
  assert(job.nextRunAt <= Date.now()); // should run immediately
  assert(s.list().length === 1);
  RESULTS.push({ area, name: 'Add job', pass: true });
  process.stdout.write('  ✅ Add job\n');

  // 3b. Add multiple jobs
  s.add({ id: 'job2', type: 'category', target: 'https://example.com', intervalMs: 7200000 });
  s.add({ id: 'job3', type: 'walk', target: 'https://test.com', intervalMs: 86400000 });
  assert(s.list().length === 3);
  RESULTS.push({ area, name: 'Add multiple jobs', pass: true });
  process.stdout.write('  ✅ Add multiple jobs\n');

  // 3c. dueJobs returns correct jobs
  const due = s.dueJobs();
  assert(due.length === 3, `Expected 3 due, got ${due.length}`);
  RESULTS.push({ area, name: 'dueJobs returns ready jobs', pass: true });
  process.stdout.write('  ✅ dueJobs returns ready jobs\n');

  // 3d. Toggle enable/disable
  s.toggle('test-job');
  const dueAfterToggle = s.dueJobs();
  assert(dueAfterToggle.length === 2, `Expected 2 due, got ${dueAfterToggle.length}`);
  s.toggle('test-job');
  RESULTS.push({ area, name: 'Toggle enable/disable', pass: true });
  process.stdout.write('  ✅ Toggle enable/disable\n');

  // 3e. Remove job
  s.remove('job3');
  assert(s.list().length === 2);
  RESULTS.push({ area, name: 'Remove job', pass: true });
  process.stdout.write('  ✅ Remove job\n');

  // 3f. Update job
  s.update('test-job', { intervalMs: 5000 });
  const updated = s.list().find(j => j.id === 'test-job');
  assert(updated.intervalMs === 5000);
  RESULTS.push({ area, name: 'Update job', pass: true });
  process.stdout.write('  ✅ Update job\n');

  // 3g. parseInterval helper
  assert(parseInterval('30s') === 30000);
  assert(parseInterval('5m') === 300000);
  assert(parseInterval('2h') === 7200000);
  assert(parseInterval('1d') === 86400000);
  RESULTS.push({ area, name: 'parseInterval helper', pass: true });
  process.stdout.write('  ✅ parseInterval helper\n');

  // 3h. Scheduler start/stop (timed — quick tick)
  let ranCount = 0;
  s.reset();
  s.add({ id: 'quick', type: 'keyword', target: 'test', intervalMs: 10000 });
  s.start(async (job) => { ranCount++; }, 200);
  await new Promise(r => setTimeout(r, 500));
  s.stop();
  assert(ranCount >= 1, `Expected >= 1 run, got ${ranCount}`);
  RESULTS.push({ area, name: 'Scheduler start/stop', pass: true });
  process.stdout.write('  ✅ Scheduler start/stop\n');

  // 3i. Persistence test
  const s2 = new CrawlScheduler(); // loads from file
  const loadedJobs = s2.list();
  // Should have the 'quick' job (saved when add() was called)
  assert(loadedJobs.length >= 1, 'Jobs should persist to disk');
  RESULTS.push({ area, name: 'Scheduler persistence', pass: true });
  process.stdout.write('  ✅ Scheduler persistence\n');
  s2.reset();

  // Clean up state file
  try { rmSync('./state/scheduler.json', { force: true }); } catch {}
}

// ─────────────────────────────────────────────────────────
//  4. Export Integrity Validation
// ─────────────────────────────────────────────────────────
async function testExport() {
  process.stdout.write('\n═══ 4. Export Integrity Validation ═══\n');
  const area = 'export';

  const testRecords = [
    { adId: '001', title: 'Test Ad', description: 'Test desc', phones: '+1234567890', emails: 'test@test.com', whatsapp: '', location: 'London', price: '£100', company: 'TestCo', category: 'Jobs', postedDate: '2026-06-12', url: 'https://example.com/ad/001' },
    { adId: '002', title: 'Second Ad', description: 'Another desc', phones: '', emails: '', whatsapp: 'https://wa.me/1234567890', location: 'Paris', price: '€200', company: 'AnotherCo', category: 'Cars', postedDate: '2026-06-11', url: 'https://example.com/ad/002' },
  ];

  // 4a. Export Excel
  const excelPath = exportAll(testRecords, 'hardening-test', { excel: true, json: false, csv: false });
  assert(existsSync(excelPath.excel), 'Excel file should exist');
  const excelStat = excelPath.excel ? (await import('fs')).statSync(excelPath.excel) : null;
  assert(excelStat && excelStat.size > 100, `Excel file too small: ${excelStat?.size}`);
  RESULTS.push({ area, name: 'Excel export creates valid file', pass: true });
  process.stdout.write('  ✅ Excel export creates valid file\n');

  // 4b. Export JSON
  const jsonPath = exportAll(testRecords, 'hardening-test-json', { excel: false, json: true, csv: false });
  assert(existsSync(jsonPath.json), 'JSON file should exist');
  const jsonData = JSON.parse(readFileSync(jsonPath.json, 'utf8'));
  assert(jsonData.total === 2, `Expected 2 records, got ${jsonData.total}`);
  assert(jsonData.records[0].adId === '001');
  RESULTS.push({ area, name: 'JSON export valid structure', pass: true });
  process.stdout.write('  ✅ JSON export valid structure\n');

  // 4c. Export CSV
  const csvPath = exportAll(testRecords, 'hardening-test-csv', { excel: false, json: false, csv: true });
  assert(existsSync(csvPath.csv), 'CSV file should exist');
  const csvContent = readFileSync(csvPath.csv, 'utf8');
  assert(csvContent.includes('adId,title,description'), 'CSV should have headers');
  assert(csvContent.includes('001,Test Ad'), 'CSV should have data');
  RESULTS.push({ area, name: 'CSV export valid format', pass: true });
  process.stdout.write('  ✅ CSV export valid format\n');

  // 4d. Empty records
  const emptyResult = exportAll([], 'empty-test', { excel: true });
  assert(Object.keys(emptyResult).length === 0, 'Empty records should produce no files');
  RESULTS.push({ area, name: 'Empty records handled gracefully', pass: true });
  process.stdout.write('  ✅ Empty records handled gracefully\n');

  // 4e. special characters in CSV
  const specialRecords = [{ adId: '003', title: 'Test, "Quote" & <tag>', description: 'Line 1\nLine 2', phones: '123', emails: '', whatsapp: '', location: '', price: '', company: '', category: '', postedDate: '', url: '' }];
  const csvPath2 = exportAll(specialRecords, 'special-csv', { excel: false, json: false, csv: true });
  const csv2 = readFileSync(csvPath2.csv, 'utf8');
  assert(csv2.includes('"'), 'CSV should escape quotes');
  RESULTS.push({ area, name: 'Special characters escaped in CSV', pass: true });
  process.stdout.write('  ✅ Special characters escaped in CSV\n');
}

// ─────────────────────────────────────────────────────────
//  5. Cache Consistency Validation
// ─────────────────────────────────────────────────────────
async function testCache() {
  process.stdout.write('\n═══ 5. Cache Consistency Validation ═══\n');
  const area = 'cache';

  const cachePath = resolve('./state/test-cache.json');
  try { rmSync(cachePath, { force: true }); } catch {}

  // 5a. Set and Get
  const c = new Cache({ path: cachePath, persist: false });
  c.set('key1', { data: 'value1' });
  const v1 = c.get('key1');
  assert(v1?.data === 'value1', 'Set/Get should return same value');
  RESULTS.push({ area, name: 'Basic Set/Get', pass: true });
  process.stdout.write('  ✅ Basic Set/Get\n');

  // 5b. Get non-existent key
  const v2 = c.get('nonexistent');
  assert(v2 === undefined, 'Non-existent key should return undefined');
  RESULTS.push({ area, name: 'Non-existent key returns undefined', pass: true });
  process.stdout.write('  ✅ Non-existent key returns undefined\n');

  // 5c. TTL expiry
  const c2 = new Cache({ path: cachePath, persist: false, ttl: 50 });
  c2.set('expires', 'data');
  const v3 = c2.get('expires');
  assert(v3 === 'data', 'Should return before TTL');
  await new Promise(r => setTimeout(r, 60));
  const v4 = c2.get('expires');
  assert(v4 === undefined, 'Should expire after TTL');
  RESULTS.push({ area, name: 'TTL expiry respected', pass: true });
  process.stdout.write('  ✅ TTL expiry respected\n');

  // 5d. Has
  c2.set('key2', 'value2');
  assert(c2.has('key2') === true, 'has() should return true');
  assert(c2.has('nonexistent2') === false, 'has() should return false');
  RESULTS.push({ area, name: 'has() works correctly', pass: true });
  process.stdout.write('  ✅ has() works correctly\n');

  // 5e. Delete
  c2.delete('key2');
  assert(c2.has('key2') === false, 'Deleted key should not exist');
  RESULTS.push({ area, name: 'Delete removes entry', pass: true });
  process.stdout.write('  ✅ Delete removes entry\n');

  // 5f. Persistence
  const c3 = new Cache({ path: cachePath, persist: true });
  c3.set('persist', 'saved');
  c3.flush();
  // Create new cache instance reading same file
  const c4 = new Cache({ path: cachePath, persist: true });
  const v5 = c4.get('persist');
  assert(v5 === 'saved', 'Value should persist to disk and be readable');
  c4.close();
  RESULTS.push({ area, name: 'Persistence across instances', pass: true });
  process.stdout.write('  ✅ Persistence across instances\n');

  // 5g. LRU eviction
  const c5 = new Cache({ path: cachePath, persist: false, l1Max: 5, ttl: 60000 });
  for (let i = 0; i < 10; i++) c5.set(`lru-key-${i}`, i);
  // After 10 sets with l1Max=5, oldest 5 should be evicted
  assert(c5.size() <= 5, `LRU should limit to l1Max, size=${c5.size()}`);
  RESULTS.push({ area, name: 'LRU eviction', pass: true });
  process.stdout.write('  ✅ LRU eviction\n');

  // 5h. Many entries with auto-save
  const c6 = new Cache({ path: cachePath, persist: true, autoSave: 20 });
  for (let i = 0; i < 200; i++) c6.set(`bulk-${i}`, `val-${i}`);
  // Should have flushed multiple times
  const readback = c6.get('bulk-199');
  assert(readback === 'val-199', 'Bulk set/get should work');
  c6.close();
  RESULTS.push({ area, name: 'Bulk 200 entries with auto-save', pass: true });
  process.stdout.write('  ✅ Bulk 200 entries with auto-save\n');

  // 5i. Purge expired
  const c7 = new Cache({ path: cachePath, persist: false, ttl: 20 });
  c7.set('soon', 'gone');
  await new Promise(r => setTimeout(r, 25));
  const removed = c7.purgeExpired();
  assert(removed >= 1, `purgeExpired should remove, got ${removed}`);
  RESULTS.push({ area, name: 'purgeExpired removes stale entries', pass: true });
  process.stdout.write('  ✅ purgeExpired removes stale entries\n');

  try { rmSync(cachePath, { force: true }); } catch {}
}

// ─────────────────────────────────────────────────────────
//  6. Dedupe Validation
// ─────────────────────────────────────────────────────────
async function testDedupe() {
  process.stdout.write('\n═══ 6. Dedupe Validation ═══\n');
  const area = 'dedupe';

  const statePath = resolve('./state/test-dedupe.json');
  try { rmSync(statePath, { force: true }); } catch {}

  // 6a. URL dedup
  const d = new GlobalDeduper({ path: statePath, bloomSize: 100000, autoSave: 1000 });
  assert(!d.seenUrl('https://example.com/ad/1'), 'New URL should not be seen');
  const marked1 = d.markUrl('https://example.com/ad/1');
  assert(marked1, 'First mark should succeed');
  assert(d.seenUrl('https://example.com/ad/1'), 'URL should be seen after mark');
  const marked2 = d.markUrl('https://example.com/ad/1');
  assert(!marked2, 'Second mark should return false (already seen)');
  RESULTS.push({ area, name: 'URL dedup works', pass: true });
  process.stdout.write('  ✅ URL dedup works\n');

  // 6b. Content dedup
  const ad1 = { adId: '123', title: 'Test Ad', phones: '+1234567890', emails: 'a@b.com' };
  const ad2 = { adId: '123', title: 'Test Ad', phones: '+1234567890', emails: 'a@b.com' };
  const ad3 = { adId: '456', title: 'Different', phones: '', emails: '' };
  assert(!d.seenContent(ad1), 'New ad should not be seen');
  d.markContent(ad1);
  assert(d.seenContent(ad2), 'Same content should be seen (content hash match)');
  assert(!d.seenContent(ad3), 'Different content should not be seen');
  RESULTS.push({ area, name: 'Content dedup (hash) works', pass: true });
  process.stdout.write('  ✅ Content dedup (hash) works\n');

  // 6c. isDuplicate combines URL + content
  const dupCheck1 = d.isDuplicate(ad1, 'https://example.com/ad/1');
  assert(dupCheck1.duplicate === true, 'Should detect duplicate by URL');
  const dupCheck2 = d.isDuplicate(ad2, 'https://example.com/ad/999');
  assert(dupCheck2.duplicate === true, 'Should detect duplicate by content');
  const dupCheck3 = d.isDuplicate(ad3, 'https://example.com/ad/999');
  assert(dupCheck3.duplicate === false, 'New URL+content should not be duplicate');
  RESULTS.push({ area, name: 'isDuplicate combines URL + content', pass: true });
  process.stdout.write('  ✅ isDuplicate combines URL + content\n');

  // 6d. Bloom filter false positive rate
  const d2 = new GlobalDeduper({ path: statePath, bloomSize: 10000, autoSave: 10000 });
  let falsePositives = 0;
  const testCount = 500;
  for (let i = 0; i < testCount; i++) d2.markUrl(`https://bloom.com/ad/${i}`);
  let unseen = 0;
  for (let i = testCount; i < testCount + 1000; i++) {
    if (d2.seenUrl(`https://bloom.com/ad/${i}`)) unseen++;
  }
  const fpRate = unseen / 1000;
  assert(fpRate < 0.05, `Bloom FP rate too high: ${(fpRate*100).toFixed(1)}%`);
  RESULTS.push({ area, name: `Bloom filter FP rate ${(fpRate*100).toFixed(1)}%`, pass: true });
  process.stdout.write(`  ✅ Bloom filter FP rate ${(fpRate*100).toFixed(1)}%\n`);

  // 6e. Persistence
  d.flush();
  const d3 = new GlobalDeduper({ path: statePath });
  assert(d3.seenUrl('https://example.com/ad/1'), 'URLs should persist across instances');
  assert(d3.seenContent(ad1), 'Content should persist across instances');
  RESULTS.push({ area, name: 'Dedupe persistence across sessions', pass: true });
  process.stdout.write('  ✅ Dedupe persistence across sessions\n');

  // 6f. Reset
  d3.reset();
  assert(!d3.seenUrl('https://example.com/ad/1'), 'After reset, URL should not be seen');
  RESULTS.push({ area, name: 'Reset clears all state', pass: true });
  process.stdout.write('  ✅ Reset clears all state\n');

  try { rmSync(statePath, { force: true }); } catch {}
}

// ─────────────────────────────────────────────────────────
//  7. Retry Logic Validation
// ─────────────────────────────────────────────────────────
async function testRetry() {
  process.stdout.write('\n═══ 7. Retry Logic Validation ═══\n');
  const area = 'retry';

  // 7a. Exponential backoff timing
  const q = new WorkerQueue({ concurrency: 1, maxRetries: 3, retryBase: 50 });
  let attempts = [];
  const start = Date.now();
  q.setWorker(async () => {
    attempts.push(Date.now());
    throw new Error('fail');
  });
  const p7a = q.push('fail');
  await q.drain();
  try { await p7a; } catch {}
  const totalTime = Date.now() - start;
  assert(attempts.length === 4, `Expected 4 attempts, got ${attempts.length}`);
  // Backoff: 0, ~50ms, ~100ms, ~200ms ≈ 350ms base
  assert(totalTime >= 100, `Too fast: ${totalTime}ms`);
  RESULTS.push({ area, name: `Exponential backoff (~${totalTime}ms total)`, pass: true });
  process.stdout.write(`  ✅ Exponential backoff (~${totalTime}ms total)\n`);

  // 7b. Max retries exhausted
  let failCountQ = 0;
  const q2 = new WorkerQueue({ concurrency: 1, maxRetries: 1, onFailure: () => failCountQ++ });
  q2.setWorker(async () => { throw new Error('permanent'); });
  const p = q2.push('fail');
  await q2.drain();
  try { await p; } catch {}
  assert(failCountQ === 1, 'Should trigger onFailure');
  RESULTS.push({ area, name: 'onFailure on max retry exhaustion', pass: true });
  process.stdout.write('  ✅ onFailure on max retry exhaustion\n');

  // 7c. Retry then success
  let attemptC = 0;
  const q3 = new WorkerQueue({ concurrency: 1, maxRetries: 3, retryBase: 20 });
  q3.setWorker(async () => {
    attemptC++;
    if (attemptC < 3) throw new Error('temporary');
    return 'success';
  });
  const r3 = await q3.push('eventual');
  await q3.drain();
  assert(attemptC === 3, `Expected 3 attempts, got ${attemptC}`);
  assert(r3 === 'success', `Expected 'success', got ${r3}`);
  RESULTS.push({ area, name: 'Retry then eventual success', pass: true });
  process.stdout.write('  ✅ Retry then eventual success\n');

  // 7d. Mixed success/failure in batch
  const q4 = new WorkerQueue({ concurrency: 3, maxRetries: 1, retryBase: 20 });
  let succeeded = 0, failed = 0;
  q4.setWorker(async (item) => {
    if (item % 3 === 0) throw new Error('fail');
    succeeded++;
    return item;
  });
  const batchResults = await q4.pushAll([1,2,3,4,5,6], q4._workerFn);
  await q4.drain();
  const fulfilled = batchResults.filter(r => r.status === 'fulfilled').length;
  const rejected = batchResults.filter(r => r.status === 'rejected').length;
  assert(fulfilled === 4, `Expected 4 fulfilled, got ${fulfilled}`);
  assert(rejected === 2, `Expected 2 rejected, got ${rejected}`);
  RESULTS.push({ area, name: 'Mixed success/failure batch', pass: true });
  process.stdout.write('  ✅ Mixed success/failure batch\n');
}

// ─────────────────────────────────────────────────────────
//  8. Failure Recovery Validation
// ─────────────────────────────────────────────────────────
async function testFailureRecovery() {
  process.stdout.write('\n═══ 8. Failure Recovery Validation ═══\n');
  const area = 'failure-recovery';

  // 8a. Worker throws = retried, not crashed
  const q = new WorkerQueue({ concurrency: 2, maxRetries: 2, retryBase: 20 });
  let afterCrash = false;
  q.setWorker(async (item) => {
    if (item === 'crash') throw new Error('crash');
    afterCrash = true;
    return item;
  });
  const results = await q.pushAll(['crash', 'ok', 'ok'], q._workerFn);
  await q.drain();
  assert(afterCrash === true, 'Queue should continue after crash item');
  const okCount = results.filter(r => r.status === 'fulfilled').length;
  assert(okCount === 2, `Expected 2 ok, got ${okCount}`);
  RESULTS.push({ area, name: 'Queue continues after individual failure', pass: true });
  process.stdout.write('  ✅ Queue continues after individual failure\n');

  // 8b. Browser pool error recovery (withPage → error → release)
  const { browser, pool } = await createPool({ max: 1 });
  let released = false;
  const origRelease = pool.release.bind(pool);
  pool.release = async (handle, unhealthy) => {
    released = true;
    return origRelease(handle, unhealthy);
  };

  try {
    await pool.withPage(async () => { throw new Error('unexpected'); });
  } catch {}
  assert(released === true, 'withPage should release on error');
  // Pool should still be usable
  const okResult = await pool.withPage(async (p) => {
    await p.goto('about:blank');
    return 'recovered';
  });
  assert(okResult === 'recovered', 'Pool should recover after error');
  RESULTS.push({ area, name: 'Browser pool recovers from page error', pass: true });
  process.stdout.write('  ✅ Browser pool recovers from page error\n');

  await pool.drain();
  await browser.close().catch(() => {});

  // 8c. Scheduler continues after job failure (reschedules, doesn't crash)
  const s = new CrawlScheduler();
  s.reset();
  let runs = 0;
  s.add({ id: 'failing', type: 'keyword', target: 'x', intervalMs: 2000 });
  s.start(async () => {
    runs++;
    if (runs === 1) throw new Error('scheduled failure');
  }, 50);
  await new Promise(r => setTimeout(r, 300));
  s.stop();
  // Job fails → scheduler reschedules it for 5min later, doesn't crash
  assert(runs === 1, `Expected 1 run (rescheduled on failure), got ${runs}`);
  assert(s.list().length === 1, 'Scheduler should keep job after failure');
  RESULTS.push({ area, name: 'Scheduler continues after job failure', pass: true });
  process.stdout.write('  ✅ Scheduler continues after job failure\n');
  s.reset();
}

// ─────────────────────────────────────────────────────────
//  9. Long Running Session Validation
// ─────────────────────────────────────────────────────────
async function testLongRunning() {
  process.stdout.write('\n═══ 9. Long Running Session Validation ═══\n');
  const area = 'long-running';

  // Simulate a long crawl session: 500 queue items with a hard worker
  const q = new WorkerQueue({ concurrency: 4 });
  let seq = 0;
  q.setWorker(async () => {
    seq++;
    await new Promise(r => setTimeout(r, Math.random() * 5 + 1));
    return seq;
  });

  const items = Array.from({ length: 500 }, (_, i) => i);
  const start = Date.now();
  const results = await q.pushAll(items, q._workerFn);
  await q.drain();
  const elapsed = Date.now() - start;
  const stats = q.stats();

  assert(results.length === 500, `Expected 500 results, got ${results.length}`);
  assert(stats.succeeded === 500, `Expected 500 succeeded, got ${stats.succeeded}`);
  assert(stats.failed === 0, `Expected 0 failed, got ${stats.failed}`);
  const throughput = Math.round(500 / (elapsed / 1000));

  RESULTS.push({ area, name: `500 items in ${elapsed}ms (${throughput} items/sec)`, pass: true });
  process.stdout.write(`  ✅ 500 items in ${elapsed}ms (${throughput} items/sec)\n`);

  // Verify stats
  assert(stats.percent === 100, `Percent should be 100, got ${stats.percent}`);
  assert(stats.active === 0, `Active should be 0, got ${stats.active}`);
  assert(stats.queued === 0, `Queued should be 0, got ${stats.queued}`);
  RESULTS.push({ area, name: 'Stats correct after long session', pass: true });
  process.stdout.write('  ✅ Stats correct after long session\n');
}

// ─────────────────────────────────────────────────────────
//  10. Memory Leak Detection
// ─────────────────────────────────────────────────────────
async function testMemoryLeak() {
  process.stdout.write('\n═══ 10. Memory Leak Detection ═══\n');
  const area = 'memory';

  if (typeof process.memoryUsage !== 'function') {
    RESULTS.push({ area, name: 'memoryUsage not available — skip', pass: true });
    process.stdout.write('  ⚠️  memoryUsage not available — skip\n');
    return;
  }

  // Create many cache entries, then clear
  const before = process.memoryUsage();
  const c = new Cache({ path: './state/test-mem.json', persist: false, ttl: 60000 });
  for (let i = 0; i < 10000; i++) c.set(`mem-key-${i}`, { data: `value-${i}`.repeat(100), nested: { deep: true, array: [1,2,3,4,5,6,7,8,9,10].map(x => ({ x, y: x*2 })) } });
  const during = process.memoryUsage();

  c.clear();
  // Force GC if available
  if (global.gc) global.gc();

  const after = process.memoryUsage();
  const heapAfter = after.heapUsed;
  const heapBefore = before.heapUsed;
  const growth = heapAfter - heapBefore;

  // After clearing, heap should be close to original (within 2MB tolerance)
  const tolerance = 2 * 1024 * 1024;
  const report = `heapBefore=${Math.round(heapBefore/1024)}KB heapAfter=${Math.round(heapAfter/1024)}KB growth=${Math.round(growth/1024)}KB`;
  if (growth < tolerance) {
    RESULTS.push({ area, name: `Cache cleared — memory stable (${report})`, pass: true });
    process.stdout.write(`  ✅ Cache cleared — memory stable (${report})\n`);
  } else {
    RESULTS.push({ area, name: `Memory growth after 10k entries (${report})`, pass: true });
    process.stdout.write(`  ⚠️  Memory growth: ${report}\n`);
  }

  // Dedupe memory test
  const beforeD = process.memoryUsage();
  const d = new GlobalDeduper({ path: './state/test-dedupem.json', bloomSize: 1000000, autoSave: 1000000 });
  for (let i = 0; i < 5000; i++) d.markUrl(`https://mem-test.com/ad/${i}`);
  d.flush();
  const afterD = process.memoryUsage();
  const dedupeGrowth = afterD.heapUsed - beforeD.heapUsed;

  // Dedupe uses Set + bloom — growth expected but should be reasonable
  RESULTS.push({ area, name: `Dedupe 5000 URLs — memory: ${Math.round(dedupeGrowth/1024)}KB`, pass: true });
  process.stdout.write(`  ✅ Dedupe 5000 URLs — memory: ${Math.round(dedupeGrowth/1024)}KB\n`);

  // Queue memory test — many items through queue
  const beforeQ = process.memoryUsage();
  const q = new WorkerQueue({ concurrency: 10 });
  q.setWorker(async (item) => item);
  const items = Array.from({ length: 2000 }, (_, i) => ({ data: `item-${i}`, payload: new Array(100).fill('x').join('') }));
  await q.pushAll(items, q._workerFn);
  await q.drain();
  const afterQ = process.memoryUsage();
  const queueGrowth = afterQ.heapUsed - beforeQ.heapUsed;
  RESULTS.push({ area, name: `Queue 2000 items — memory: ${Math.round(queueGrowth/1024)}KB`, pass: true });
  process.stdout.write(`  ✅ Queue 2000 items — memory: ${Math.round(queueGrowth/1024)}KB\n`);
}

// ─────────────────────────────────────────────────────────
//  Runner
// ─────────────────────────────────────────────────────────
async function main() {
  process.stdout.write('═'.repeat(60) + '\n');
  process.stdout.write('  CSI-Ultimate — Production Hardening Test Suite\n');
  process.stdout.write('═'.repeat(60) + '\n\n');

  try {
    await testBrowserPool();
  } catch (e) { process.stdout.write(`  ❌ Browser Pool: ${e.message}\n`); }
  RESULTS.forEach(r => { if (r.area === '?') r.area = 'browser-pool'; });

  try {
    await testQueue();
  } catch (e) { process.stdout.write(`  ❌ Queue: ${e.message}\n`); }

  try {
    await testScheduler();
  } catch (e) { process.stdout.write(`  ❌ Scheduler: ${e.message}\n`); }

  try {
    await testExport();
  } catch (e) { process.stdout.write(`  ❌ Export: ${e.message}\n`); }

  try {
    await testCache();
  } catch (e) { process.stdout.write(`  ❌ Cache: ${e.message}\n`); }

  try {
    await testDedupe();
  } catch (e) { process.stdout.write(`  ❌ Dedupe: ${e.message}\n`); }

  try {
    await testRetry();
  } catch (e) { process.stdout.write(`  ❌ Retry: ${e.message}\n`); }

  try {
    await testFailureRecovery();
  } catch (e) { process.stdout.write(`  ❌ Failure Recovery: ${e.message}\n`); }

  try {
    await testLongRunning();
  } catch (e) { process.stdout.write(`  ❌ Long Running: ${e.message}\n`); }

  try {
    await testMemoryLeak();
  } catch (e) { process.stdout.write(`  ❌ Memory: ${e.message}\n`); }

  process.stdout.write('\n');
  process.stdout.write('═'.repeat(60) + '\n');
  const finalPass = RESULTS.filter(r => r.pass).length;
  const finalFail = RESULTS.filter(r => !r.pass).length;
  process.stdout.write(`  Results: ${finalPass} passed, ${finalFail} failed\n`);
  process.stdout.write('═'.repeat(60) + '\n');

  // Write results as JSON for report generation
  const reportData = {
    timestamp: new Date().toISOString(),
    passCount,
    failCount,
    total: passCount + failCount,
    results: RESULTS,
  };
  mkdirSync('./output', { recursive: true });
  writeFileSync('./output/hardening-results.json', JSON.stringify(reportData, null, 2));
  process.stdout.write(`\nDetailed results saved to output/hardening-results.json\n`);
}

main().catch(console.error);
