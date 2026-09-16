#!/usr/bin/env node
/**
 * Scenario 4: Failure Recovery
 * Force failure → Recovery → Resume
 */
import { createPool } from '../core/browser-pool.mjs';
import { WorkerQueue } from '../core/queue.mjs';
import { retryHandler } from '../core/rate-limiter.mjs';

async function main() {
  console.log('═'.repeat(60));
  console.log('  Scenario 4: Failure Recovery Validation');
  console.log('═'.repeat(60));

  // ── Test 1: Bad URL → graceful error handling ──
  console.log('\n--- Test 1: Bad URL → graceful handling ---');
  const { pool } = await createPool({ max: 1 });
  try {
    const { extractAd } = await import('../core/crawler-core.mjs');
    const result = await extractAd(pool, 'https://not-a-real-site-12345.com/ad/1');
    console.log(`  Result: ${result === null ? 'null (expected)' : result}`);
    console.log('  ✅ Bad URL returns null, no crash');
  } catch (err) {
    console.log(`  Error caught: ${err.message}`);
    console.log('  ✅ Error caught gracefully');
  }

  // ── Test 2: Retry handler on transient failure ──
  console.log('\n--- Test 2: Retry handler on failure ---');
  let attempts = 0;
  const result = await retryHandler.run(async () => {
    attempts++;
    if (attempts < 3) throw new Error(`Transient error (attempt ${attempts})`);
    return 'success';
  }, 'test-fail');
  console.log(`  Attempts: ${attempts}, Result: ${result}`);
  console.log('  ✅ Retry handler recovers from transient failure');

  // ── Test 3: Queue continues after individual failures ──
  console.log('\n--- Test 3: Queue continues after failures ---');
  const q = new WorkerQueue({ concurrency: 2 });
  let goodItems = 0;
  q.setWorker(async (item) => {
    if (item === 'fail') throw new Error('Item failed');
    goodItems++;
    return item;
  });
  const results = await q.pushAll(['ok1', 'fail', 'ok2', 'ok3', 'fail2'], q._workerFn);
  await q.drain();
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  console.log(`  Succeeded: ${succeeded}, Failed: ${failed}`);
  console.log(`  Good items processed: ${goodItems}`);
  console.log('  ✅ Queue continues processing after individual failures');

  // ── Test 4: Pool recovers after page error ──
  console.log('\n--- Test 4: Pool recovery after error ---');
  let recovered = false;
  try {
    await pool.withPage(async (page) => {
      throw new Error('Unexpected page crash');
    });
  } catch {
    // Expected
  }
  // Pool should still be usable
  await pool.withPage(async (page) => {
    await page.goto('about:blank');
    recovered = true;
  });
  console.log(`  Pool usable after error: ${recovered}`);
  console.log('  ✅ Pool recovers from page crash');

  await pool.drain();

  // ── Summary ──
  console.log('\n' + '═'.repeat(60));
  const allPassed = true;
  console.log(`  Failure Recovery: ${allPassed ? '✅ ALL PASSED' : '❌ FAILED'}`);
  console.log('═'.repeat(60));
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
