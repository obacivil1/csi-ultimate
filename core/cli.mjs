/**
 * ============================================================
 *  CSI-Ultimate — Interactive CLI
 *  Stage 6: Production Hardening
 *  core/cli.mjs
 * ============================================================
 *
 *  الميزات:
 *  ---------
 *  ① printHelp()        : مساعدة ملوّنة ومنسّقة
 *  ② parseCliArgs()     : تحليل كامل للـ arguments
 *  ③ validateArgs()     : التحقق من صحة المدخلات
 *  ④ promptInteractive(): وضع تفاعلي إذا لم تُعطَ args
 *  ⑤ buildConfig()      : يبني config نهائي موحّد
 */

import { parseArgs }            from "node:util";
import { createInterface }      from "node:readline";
import { existsSync }           from "fs";
import { resolve }              from "path";
import { loadConfig, BUILT_IN_PROFILES as PROFILES } from "./config-manager.mjs";

// ============================================================
//  ألوان ANSI
// ============================================================

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
  white:  "\x1b[37m",
  bgBlue: "\x1b[44m",
};

const bold  = s => `${C.bold}${s}${C.reset}`;
const cyan  = s => `${C.cyan}${s}${C.reset}`;
const green = s => `${C.green}${s}${C.reset}`;
const yellow= s => `${C.yellow}${s}${C.reset}`;
const red   = s => `${C.red}${s}${C.reset}`;
const dim   = s => `${C.dim}${s}${C.reset}`;

// ============================================================
//  printHelp — مساعدة منسّقة
// ============================================================

export function printHelp() {
  const line = "─".repeat(62);
  console.log(`
${C.cyan}╔══════════════════════════════════════════════════════════════╗
║       CSI-Ultimate Crawler  v9  —  Stage 6 Production        ║
╚══════════════════════════════════════════════════════════════╝${C.reset}

${bold("الاستخدام:")}
  ${cyan("node csi-crawler-v9.mjs")} ${yellow("[options]")}

${line}
${bold("🎯  الأهداف:")}

  ${cyan("--url")} ${yellow("<URL>")}
        رابط الموقع المستهدف
        مثال: ${dim("--url https://www.expatriates.com")}

  ${cyan("--categories")}
        تصفح جميع الفئات تلقائياً واستخراج الإعلانات

  ${cyan("--search")} ${yellow('"كلمة"')}
        بحث بكلمة مفتاحية (أو عدة كلمات: ${dim('"kw1,kw2,kw3"')})

  ${cyan("--post")}
        إجبار استخدام POST للبحث (خاص بـ expatriates.com)

  ${cyan("--smart-search")}
        بحث ذكي — يكتشف نموذج البحث في الموقع تلقائياً
        (يعمل مع ${cyan("--search")})

${line}
${bold("📊  الحدود والأداء:")}

  ${cyan("--max-ads")}  ${yellow("<n>")}      أقصى عدد إعلانات  ${dim("(default: 300)")}
  ${cyan("--max-pages")} ${yellow("<n>")}     أقصى صفحات        ${dim("(default: 10)")}
  ${cyan("--concurrency")} ${yellow("<n>")}   browsers متوازية  ${dim("(default: 3)")}
  ${cyan("--delay")} ${yellow("<ms>")}        تأخير بين الطلبات  ${dim("(default: 1500)")}

${line}
${bold("💾  التصدير:")}

  ${cyan("--output")} ${yellow("<dir>")}      مجلد الإخراج       ${dim("(default: ./output)")}
  ${cyan("--format")} ${yellow("<formats>")}  صيغ: excel,csv,json ${dim("(default: excel,json)")}

${line}
${bold("🔧  الإعدادات والـ Profiles:")}

  ${cyan("--profile")} ${yellow("<name>")}    استخدام profile محفوظ
        profiles المتاحة: ${dim("default, fast, safe, deep")}

  ${cyan("--save-profile")} ${yellow("<name>")} حفظ الإعدادات الحالية كـ profile

  ${cyan("--list-profiles")}  عرض كل الـ profiles المحفوظة

${line}
${bold("📅  الجدولة:")}

  ${cyan("--schedule")} ${yellow("<interval>")}
        جدولة تلقائية: ${dim("6h / 30m / 1d / 2h30m")}

  ${cyan("--resume")}           استكمال من آخر جلسة
  ${cyan("--status")}           عرض حالة الجلسات المجدولة

${line}
${bold("🔬  التشخيص:")}

  ${cyan("--probe")} ${yellow("<URL>")}     فحص آلية البحث للموقع
  ${cyan("--test")}            تشغيل Integration Tests
  ${cyan("--test-live")}       اختبار على expatriates.com الحقيقي
  ${cyan("--dashboard")}       عرض Dashboard أثناء التشغيل
  ${cyan("--verbose")}         طباعة تفاصيل إضافية
  ${cyan("--debug-discovery")}  حفظ لقطات وتشخيصات اكتشاف الروابط

${line}
${bold("❓  المساعدة:")}

  ${cyan("--help")}            عرض هذه المساعدة
  ${cyan("--interactive")}     وضع تفاعلي (يسألك خطوة بخطوة)
  ${cyan("--version")}         عرض الإصدار

${line}
${bold("📝  أمثلة سريعة:")}

  ${dim("# بحث POST وتصدير Excel:")}
  ${cyan("node csi-crawler-v9.mjs")} --url https://www.expatriates.com \\
    --search "driver,cook,maid" --post --max-ads 200

  ${dim("# تصفح كل الفئات مع Dashboard:")}
  ${cyan("node csi-crawler-v9.mjs")} --url https://www.expatriates.com \\
    --categories --dashboard --output ./results

  ${dim("# فحص آلية البحث:")}
  ${cyan("node csi-crawler-v9.mjs")} --probe https://www.expatriates.com

  ${dim("# تشغيل كل 6 ساعات:")}
  ${cyan("node csi-crawler-v9.mjs")} --url https://www.expatriates.com \\
    --search "driver" --post --schedule 6h

  ${dim("# وضع تفاعلي:")}
  ${cyan("node csi-crawler-v9.mjs")} --interactive
`);
}

// ============================================================
//  parseCliArgs — تحليل الـ arguments
// ============================================================

export function parseCliArgs(argv = process.argv) {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      // الأهداف
      url:            { type: "string"  },
      categories:     { type: "boolean" },
      search:         { type: "string"  },
      post:           { type: "boolean" },
      "smart-search": { type: "boolean" },

      // الحدود
      "max-ads":      { type: "string"  },
      "max-pages":    { type: "string"  },
      concurrency:    { type: "string"  },
      delay:          { type: "string"  },

      // التصدير
      output:         { type: "string"  },
      format:         { type: "string"  },

      // الـ Profiles
      profile:        { type: "string"  },
      "save-profile": { type: "string"  },
      "list-profiles":{ type: "boolean" },

      // الجدولة
      schedule:       { type: "string"  },
      resume:         { type: "boolean" },
      status:         { type: "boolean" },

      // التشخيص
      probe:          { type: "string"  },
      test:           { type: "boolean" },
      "test-live":    { type: "boolean" },
      dashboard:      { type: "boolean" },
      verbose:        { type: "boolean" },
      "debug-discovery": { type: "boolean" },

      // المساعدة
      help:           { type: "boolean" },
      interactive:    { type: "boolean" },
      version:        { type: "boolean" },
    },
    allowPositionals: true,
    strict: false,
  });

  return values;
}

// ============================================================
//  validateArgs — التحقق من صحة المدخلات
// ============================================================

export function validateArgs(args) {
  const errors   = [];
  const warnings = [];

  // URL مطلوب إذا لم يكن probe/status/test
  const noUrlModes = ["probe", "status", "test", "test-live", "help",
                      "interactive", "version", "list-profiles"];
  const needsUrl = !noUrlModes.some(m => args[m]);

  if (needsUrl && !args.url) {
    errors.push("--url مطلوب. مثال: --url https://www.expatriates.com");
  }

  // التحقق من الـ URL
  if (args.url) {
    try {
      new URL(args.url);
    } catch {
      errors.push(`URL غير صالح: "${args.url}"`);
    }
  }

  // التحقق من الأرقام
  for (const key of ["max-ads", "max-pages", "concurrency", "delay"]) {
    if (args[key] !== undefined) {
      const n = parseInt(args[key]);
      if (isNaN(n) || n < 1) {
        errors.push(`--${key} يجب أن يكون رقم موجب`);
      }
    }
  }

  // التحقق من التنسيقات
  if (args.format) {
    const valid = ["excel", "json", "csv"];
    const given = args.format.split(",").map(s => s.trim());
    const bad   = given.filter(f => !valid.includes(f));
    if (bad.length > 0) {
      errors.push(`صيغ غير معروفة: ${bad.join(", ")}. المتاح: excel, json, csv`);
    }
  }

  // التحقق من schedule format
  if (args.schedule) {
    if (!/^\d+[hmd](\d+[hmd])?$/.test(args.schedule)) {
      warnings.push(`تنسيق الجدولة قد يكون خاطئاً: "${args.schedule}". مثال: 6h, 30m, 1d`);
    }
  }

  // --post بدون --search
  if (args.post && !args.search) {
    warnings.push("--post يعمل بشكل أفضل مع --search");
  }

  // --smart-search بدون --search
  if (args["smart-search"] && !args.search) {
    warnings.push("--smart-search يعمل بشكل أفضل مع --search");
  }

  return { errors, warnings };
}

// ============================================================
//  promptInteractive — وضع تفاعلي
// ============================================================

export async function promptInteractive() {
  const rl = createInterface({
    input:  process.stdin,
    output: process.stdout,
  });

  const ask = (q) => new Promise(res => rl.question(q, res));

  console.log(`\n${cyan("╔══════════════════════════════════════╗")}
${cyan("║")} CSI-Ultimate — الوضع التفاعلي        ${cyan("║")}
${cyan("╚══════════════════════════════════════╝")}\n`);

  try {
    // 1. URL
    let url = "";
    while (!url) {
      url = (await ask(`${bold("1.")} رابط الموقع: `)).trim();
      if (!url) {
        console.log(red("   ✗ الرابط مطلوب"));
        url = "";
        continue;
      }
      try { new URL(url); }
      catch { console.log(red(`   ✗ رابط غير صالح`)); url = ""; }
    }

    // 2. وضع العمل
    console.log(`\n${bold("2.")} وضع العمل:`);
    console.log(`   ${cyan("1")} بحث بكلمة مفتاحية ${dim("(الأسرع)")}`);
    console.log(`   ${cyan("2")} تصفح الفئات        ${dim("(الأشمل)")}`);
    console.log(`   ${cyan("3")} صفحة البداية فقط   ${dim("(للاختبار)")}`);
    const mode = (await ask(`   اختر [1-3] (default: 1): `)).trim() || "1";

    let search = "", categories = false, post = false;
    if (mode === "1" || mode === "") {
      search = (await ask(`\n   كلمات البحث (افصل بفاصلة): `)).trim();
      if (!search) search = "driver";

      const usePost = (await ask(`   استخدام POST؟ [y/N]: `)).trim().toLowerCase();
      post = usePost === "y" || usePost === "yes";
    } else if (mode === "2") {
      categories = true;
    }

    // 3. الحدود
    console.log(`\n${bold("3.")} الحدود:`);
    const maxAds   = parseInt((await ask(`   أقصى إعلانات [default: 100]: `)).trim() || "100");
    const maxPages = parseInt((await ask(`   أقصى صفحات   [default: 5]: `)).trim()  || "5");

    // 4. التصدير
    console.log(`\n${bold("4.")} التصدير:`);
    console.log(`   ${cyan("1")} Excel + JSON ${dim("(default)")}`);
    console.log(`   ${cyan("2")} Excel + JSON + CSV`);
    console.log(`   ${cyan("3")} JSON فقط`);
    const fmtChoice = (await ask(`   اختر [1-3] (default: 1): `)).trim() || "1";
    const formats   = fmtChoice === "2" ? ["excel","json","csv"]
                    : fmtChoice === "3" ? ["json"]
                    : ["excel","json"];

    const outputDir = (await ask(`   مجلد الإخراج [default: ./output]: `)).trim() || "./output";

    // 5. Dashboard
    const useDash = (await ask(`\n${bold("5.")} تفعيل Dashboard؟ [Y/n]: `))
      .trim().toLowerCase();
    const dashboard = useDash !== "n" && useDash !== "no";

    // ملخص
    console.log(`\n${cyan("─".repeat(45))}`);
    console.log(bold("📋 ملخص الإعدادات:"));
    console.log(`   URL      : ${green(url)}`);
    console.log(`   وضع      : ${mode === "1" ? `بحث "${search}" ${post ? "(POST)" : "(GET)"}` : mode === "2" ? "فئات" : "البداية"}`);
    console.log(`   حد الإعلانات: ${maxAds}`);
    console.log(`   تنسيقات  : ${formats.join(", ")}`);
    console.log(`   مجلد     : ${outputDir}`);
    console.log(`   Dashboard: ${dashboard ? green("✓") : dim("✗")}`);

    const confirm = (await ask(`\n${bold("تأكيد؟ [Y/n]: ")}`)).trim().toLowerCase();
    if (confirm === "n" || confirm === "no") {
      console.log(yellow("\n⚠️  إلغاء."));
      rl.close();
      process.exit(0);
    }

    rl.close();

    return {
      url,
      search:       search || undefined,
      categories,
      post,
      "max-ads":    String(maxAds),
      "max-pages":  String(maxPages),
      output:       outputDir,
      format:       formats.join(","),
      dashboard,
    };

  } catch (err) {
    rl.close();
    throw err;
  }
}

// ============================================================
//  buildConfig — يبني config نهائي
// ============================================================

const DEFAULTS = {
  CONCURRENCY:  3,
  MAX_PAGES:    10,
  MAX_ADS:      300,
  PAGE_DELAY:   1500,
  AD_DELAY:     800,
  OUTPUT_DIR:   "./output",
  FORMATS:      ["excel", "json"],
};

export function buildConfig(args) {
  // ابدأ بـ profile إذا موجود
  let profileCfg = {};
  if (args.profile) {
    profileCfg = loadConfig(args.profile) ?? {};
    if (Object.keys(profileCfg).length) {
      console.log(dim(`  📂 Profile "${args.profile}" محمّل`));
    }
  }

  // دمج الـ defaults + profile + args
  const baseUrl = (args.url ?? profileCfg.url ?? "").replace(/\/$/, "");

  return {
    baseUrl,
    concurrency:  parseInt(args.concurrency  ?? profileCfg.concurrency  ?? DEFAULTS.CONCURRENCY),
    MAX_PAGES:    parseInt(args["max-pages"]  ?? profileCfg.maxPages     ?? DEFAULTS.MAX_PAGES),
    MAX_ADS:      parseInt(args["max-ads"]    ?? profileCfg.maxAds       ?? DEFAULTS.MAX_ADS),
    PAGE_DELAY:   parseInt(args.delay         ?? profileCfg.pageDelay    ?? DEFAULTS.PAGE_DELAY),
    AD_DELAY:     DEFAULTS.AD_DELAY,
    outputDir:    resolve(args.output         ?? profileCfg.outputDir    ?? DEFAULTS.OUTPUT_DIR),
    formats:      (args.format                ?? profileCfg.formats      ?? DEFAULTS.FORMATS.join(","))
                  .split?.(",").map(s => s.trim()) ?? DEFAULTS.FORMATS,
    resume:       args.resume    ?? false,
    usePost:      args.post          ?? false,
    useSmartSearch: args["smart-search"] ?? false,
    useDashboard: args.dashboard     ?? false,
    verbose:      args.verbose   ?? false,
    debugDiscovery: args["debug-discovery"] ?? false,
  };
}

// ============================================================
//  printVersion
// ============================================================

export function printVersion() {
  console.log(`CSI-Ultimate Crawler v9.0.0 — Stage 6 Production`);
  console.log(`Node.js ${process.version}`);
}

// ============================================================
//  printError — طباعة أخطاء التحقق
// ============================================================

export function printValidationResult({ errors, warnings }) {
  if (warnings.length > 0) {
    warnings.forEach(w => console.log(yellow(`⚠️  ${w}`)));
  }
  if (errors.length > 0) {
    errors.forEach(e => console.log(red(`❌ ${e}`)));
    return false;
  }
  return true;
}
