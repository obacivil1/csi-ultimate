import cron from 'node-cron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function runScript(scriptRelPath) {
  const fullPath = path.resolve(PROJECT_ROOT, scriptRelPath);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fullPath], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
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
  console.log('     → Daily  2AM : Scrape SaudiGulfProjects + rebuild database');
  console.log('     → Sun    3AM : Scrape Etimad awards (if script exists)');

  cron.schedule('0 2 * * *', async () => {
    console.log('⏰ [scheduler] Daily update started...');
    try {
      await runScript('scripts/lead-gen/scrape-saudi-gulf-projects.mjs');
      await runScript('scripts/lead-gen/build-projects-database.mjs');
      console.log('⏰ [scheduler] Database updated ✓');
    } catch (e) {
      console.error(`⏰ [scheduler] Daily update failed: ${e.message}`);
    }
  });

  cron.schedule('0 3 * * 0', async () => {
    console.log('⏰ [scheduler] Weekly Etimad awards...');
    try {
      await runScript('scripts/lead-gen/etimad-awards.mjs');
      console.log('⏰ [scheduler] Etimad awards updated ✓');
    } catch (e) {
      console.error(`⏰ [scheduler] Etimad failed (can be ignored): ${e.message}`);
    }
  });

  setTimeout(async () => {
    console.log('⏰ [scheduler] Initial scrape on startup...');
    try {
      await runScript('scripts/lead-gen/scrape-saudi-gulf-projects.mjs');
      await runScript('scripts/lead-gen/build-projects-database.mjs');
      console.log('⏰ [scheduler] Initial update complete ✓');
    } catch (e) {
      console.error(`⏰ [scheduler] Initial update failed: ${e.message}`);
    }
  }, 10000);
}
