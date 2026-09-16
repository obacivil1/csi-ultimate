#!/usr/bin/env node
import { CrawlScheduler } from '../core/scheduler.mjs';

async function main() {
  const s = new CrawlScheduler();

  // Verify job exists from CLI creation
  const jobs = s.list();
  console.log(`Loaded ${jobs.length} job(s) from scheduler.json`);
  const job = jobs[0];
  if (!job) { console.log('❌ No job found'); process.exit(1); }

  console.log(`Job: ${job.id}`);
  console.log(`Type: ${job.type}, Target: ${job.target}`);
  console.log(`Interval: ${job.intervalMs}ms`);
  console.log(`Enabled: ${job.enabled}`);
  console.log(`Run count: ${job.runCount}`);

  let ran = false;
  s.start(async (j) => {
    console.log(`\n▶️ Executing job: ${j.id}`);
    ran = true;
    // Simulate crawl work
    await new Promise(r => setTimeout(r, 100));
  }, 200);

  await new Promise(r => setTimeout(r, 1000));
  s.stop();

  console.log(`\n✅ Job executed: ${ran}`);
  const updatedJobs = s.list();
  console.log(`Updated run count: ${updatedJobs[0]?.runCount ?? 0}`);

  // Final state
  console.log(`\n📋 Final scheduler state:`);
  console.log(JSON.stringify(updatedJobs[0], null, 2));

  // Success if job was loaded and executed
  process.exit(job && ran ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
