import cron from 'node-cron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const tasks = [];
const timers = [];
const aborter = new AbortController();

function runScript(scriptRelPath) {
  const fullPath = path.resolve(PROJECT_ROOT, scriptRelPath);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fullPath], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      signal: aborter.signal,
    });
    let out = '';
    child.stdout.on('data', d => { const s = d.toString().trim(); if (s) { out += s + '\n'; console.log(`  [scheduler] ${s}`); } });
    child.stderr.on('data', d => { const s = d.toString().trim(); if (s) console.error(`  [scheduler] ERROR: ${s}`); });
    child.on('close', code => { console.log(`  [scheduler] ${path.basename(scriptRelPath)} → exit ${code}`); code === 0 ? resolve(out) : reject(new Error(`exit ${code}`)); });
    child.on('error', reject);
  });
}

export function startScheduler() {
  console.log('  ⏰ Scheduler active');
  console.log('     → Daily  12AM : Scrape SaudiGulfProjects + rebuild database');
  console.log('     → Daily  12AM : Scrape Etimad awards');

  const t1 = cron.schedule('0 0 * * *', async () => {
    console.log('⏰ [scheduler] Daily update started...');
    try {
      await runScript('scripts/lead-gen/scrape-saudi-gulf-projects.mjs');
      await runScript('scripts/lead-gen/build-projects-database.mjs');
      console.log('⏰ [scheduler] Database updated ✓');
    } catch (e) {
      console.error(`⏰ [scheduler] Daily update failed: ${e.message}`);
    }
  });
  tasks.push(t1);

  const t2 = cron.schedule('0 1 * * *', async () => {
    console.log('⏰ [scheduler] Daily Etimad awards...');
    try {
      await runScript('scripts/lead-gen/etimad-awards.mjs');
      console.log('⏰ [scheduler] Etimad awards updated ✓');
    } catch (e) {
      console.error(`⏰ [scheduler] Etimad failed (can be ignored): ${e.message}`);
    }
  });
  tasks.push(t2);

  const timer = setTimeout(async () => {
    console.log('⏰ [scheduler] Initial scrape on startup...');
    try {
      await runScript('scripts/lead-gen/scrape-saudi-gulf-projects.mjs');
      await runScript('scripts/lead-gen/build-projects-database.mjs');
      console.log('⏰ [scheduler] Initial update complete ✓');
    } catch (e) {
      console.error(`⏰ [scheduler] Initial update failed: ${e.message}`);
    }
  }, 10000);
  timers.push(timer);
}

/** إيقاف رشيق: يدفن المهام المجدولة ويوقف أي تشغيل جارٍ (SIGTERM/SIGINT). */
export function stopScheduler() {
  aborter.abort();
  for (const t of tasks) { try { t.destroy(); } catch {} }
  for (const tm of timers) { try { clearTimeout(tm); } catch {} }
  tasks.length = 0;
  timers.length = 0;
}