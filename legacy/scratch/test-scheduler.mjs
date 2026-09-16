#!/usr/bin/env node
import { CrawlScheduler } from '../core/scheduler.mjs';
import { createPool } from '../core/browser-pool.mjs';
import { existsSync, mkdirSync } from 'fs';

const INTERVAL_MS = 60000; // 1 min but we test with 2s tick

async function main() {
  const s = new CrawlScheduler();
  s.reset();

  // Add a keyword crawl job
  const job = s.add({
    id: 'acceptance-test-job',
    type: 'keyword',
    target: 'https://www.gumtree.com',
    intervalMs: INTERVAL_MS,
  });
  console.log(`✅ Job created: ${job.id}`);

  let runCount = 0;
  const startTime = Date.now();

  s.start(async (scheduledJob) => {
    runCount++;
    console.log(`\n▶️ Scheduler executing job "${scheduledJob.id}" (run #${runCount})`);

    const { pool } = await createPool({ maxBrowsers: 1 });
    try {
      // Run a mini keyword crawl
      const { searchMultiple } = await import('../core/keyword-search.mjs');
      const { exportAll } = await import('../core/exporter.mjs');

      const keywords = ['phone'];
      const resultMap = await searchMultiple(pool, scheduledJob.target, keywords, { PAGE_DELAY: 500 });
      const allLinks = new Set();
      for (const [, links] of resultMap) links.forEach(l => allLinks.add(l));
      const links = [...allLinks].slice(0, 5);
      console.log(`  Discovered ${allLinks.size} links, scraping top ${links.length}`);

      const { extractAd } = await import('../core/crawler-core.mjs');
      const ads = [];
      for (const url of links) {
        const data = await extractAd(pool, url);
        if (data) ads.push(data);
      }
      console.log(`  Extracted ${ads.length} ads`);

      const exported = exportAll(ads, `scheduled-crawl-${Date.now()}`, { outputDir: './output' });
      if (exported.excel) console.log(`  ✅ Excel exported: ${exported.excel}`);
      console.log(`  ✅ Job run #${runCount} complete`);

    } finally {
      await pool.drain();
    }
  }, 2000); // tick every 2s for testing

  // Let it run for 2 ticks
  await new Promise(r => setTimeout(r, 5000));
  s.stop();
  console.log(`\n⏹ Scheduler stopped after ${runCount} run(s) in ${Date.now() - startTime}ms`);

  // Verify
  console.log(`\n📊 Verification:`);
  console.log(`  Runs executed: ${runCount}`);
  const jobs = s.list();
  console.log(`  Jobs in scheduler: ${jobs.length}`);
  console.log(`  Total run count: ${jobs.reduce((s, j) => s + j.runCount, 0)}`);

  // Verify output files
  const outputFiles = (await import('fs')).readdirSync('./output').filter(f => f.includes('scheduled-crawl'));
  console.log(`  Output files created: ${outputFiles.length}`);
  outputFiles.forEach(f => console.log(`    - ${f}`));

  // Cleanup
  s.reset();
  try { (await import('fs')).rmSync('./state/scheduler.json', { force: true }); } catch {}

  const success = runCount > 0 && outputFiles.length > 0;
  process.exit(success ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
