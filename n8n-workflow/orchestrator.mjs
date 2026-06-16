/**
 * orchestrator.mjs — تشغيل السكربتات المحلية وجمع النتائج
 *
 * Usage:
 *   node orchestrator.mjs                                    ← تشغيل كل السكربتات
 *   node orchestrator.mjs --skip-scrape                      ← يعالج الملفات الموجودة فقط
 *   node orchestrator.mjs --only expat                       ← سكربت واحد فقط
 *   node orchestrator.mjs --from data/expat_jobs.json        ← من ملف معين
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { runPipeline } from './pipeline.mjs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const STATE_DIR = path.resolve(__dirname, '..', 'state')
const N8N_DIR = __dirname

const SCRAPERS = [
  { id: 'expat', file: 'expat_planning_extract.mjs', output: 'expat_planning_jobs.json', desc: 'Expatriates' },
]

function log(label, msg) {
  console.log(`[${new Date().toLocaleTimeString('ar-SA')}] ${label.padEnd(12)} ${msg}`)
}

async function main() {
  const args = process.argv.slice(2)
  const skipScrape = args.includes('--skip-scrape')
  const onlyFilter = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
  const fromFile = args.includes('--from') ? args[args.indexOf('--from') + 1] : null

  console.log('╔══════════════════════════════════════════════╗')
  console.log('║  CSI Ultimate — Orchestrator v1             ║')
  console.log('╚══════════════════════════════════════════════╝')
  console.log('')

  /* ─── Phase 1: تشغيل السكربتات ─── */

  const scrapersToRun = fromFile
    ? []  // Skip running, we have a file
    : SCRAPERS.filter(s => !onlyFilter || s.id === onlyFilter)

  if (!skipScrape && !fromFile) {
    for (const s of scrapersToRun) {
      log(s.id, `🔄 ${s.desc}...`)
      const scriptPath = path.join(STATE_DIR, s.file)
      if (!fs.existsSync(scriptPath)) {
        log(s.id, `⚠️  ملف السكربت غير موجود: ${s.file}`)
        continue
      }
      try {
        execSync(`node "${scriptPath}"`, {
          cwd: path.resolve(__dirname, '..'),
          stdio: 'inherit',
          timeout: 600000,
        })
        log(s.id, `✅ ${s.desc} — اكتمل`)
      } catch (e) {
        log(s.id, `❌ ${s.desc} — خطأ: ${e.message?.substring(0, 80)}`)
      }
    }
  } else {
    log('skipped', '⏭️  تخطي تشغيل السكربتات (--skip-scrape أو --from)')
  }

  /* ─── Phase 2: جمع النتائج ─── */

  const rawJobs = []
  const sourceFiles = fromFile
    ? [fromFile]
    : SCRAPERS.map(s => path.join(DATA_DIR, s.output))

  for (const filePath of sourceFiles) {
    const fullPath = path.resolve(filePath)
    if (!fs.existsSync(fullPath)) {
      log('collect', `⚠️  الملف غير موجود: ${filePath}`)
      continue
    }
    try {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const data = JSON.parse(content)
      const label = path.basename(filePath, '.json').replace('_jobs', '').replace('_', ' ').toUpperCase()

      if (Array.isArray(data)) {
        rawJobs.push({ type: 'direct_json', label, body: data })
        log('collect', `✅ ${label}: ${data.length} وظيفة`)
      }
    } catch (e) {
      log('collect', `❌ خطأ في قراءة ${filePath}: ${e.message}`)
    }
  }

  if (!rawJobs.length) {
    log('abort', '⚠️  لا توجد بيانات للمعالجة')
    console.log('\nاستخدم --from data/expat_planning_jobs.json لمعالجة ملف موجود')
    process.exit(1)
  }

  /* ─── Phase 3: تشغيل الـ Pipeline ─── */

  log('pipeline', `🔄 معالجة ${rawJobs.length} مصدر...`)

  const seenJobs = []
  const seenPath = path.join(N8N_DIR, 'seen_jobs.json')
  if (fs.existsSync(seenPath)) {
    try {
      const seen = JSON.parse(fs.readFileSync(seenPath, 'utf-8'))
      seenJobs.push(...(seen.jobs || []))
    } catch {}
  }

  let crm = {}
  const crmPath = path.join(N8N_DIR, 'crm.json')
  if (fs.existsSync(crmPath)) {
    try {
      crm = JSON.parse(fs.readFileSync(crmPath, 'utf-8'))
    } catch {}
  }

  const result = await runPipeline({
    rawJobs,
    seenJobs,
    crm,
    config: { dataDir: DATA_DIR, n8nDir: N8N_DIR },
  })

  /* ─── Phase 4: التقرير النهائي ─── */

  console.log('')
  console.log('═'.repeat(50))
  console.log('📊  التقرير النهائي')
  console.log('═'.repeat(50))
  console.log(`       تم تحليل: ${result.report.totalParsed} وظيفة`)
  console.log(`       فريد بعد dedup: ${result.report.totalUnique}`)
  console.log(`       اجتاز scoring: ${result.report.approved}`)
  console.log(`       مع إيميل: ${result.report.withEmail}`)
  console.log(`       جديد مع إيميل: ${result.report.newWithEmail}`)
  console.log('')
  console.log('📧  بانتظار الموافقة:', result.report.pendingEmails)
  console.log('═'.repeat(50))
  console.log(`   ${result.pendingEmails.length > 0 ? '✅ تم حفظ pending_emails.json' : 'ℹ️  لا توجد إيميلات جديدة'}`)
  console.log(`   📁 seen_jobs.json: ${result.updatedSeen.length} إجمالي`)
  console.log('═'.repeat(50))

  return result
}

main().catch(e => {
  console.error('\n❌ FATAL:', e.message)
  process.exit(1)
})
