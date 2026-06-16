/**
 * ============================================================
 *  CSI-Ultimate — Config Manager
 *  Stage 6: Production Hardening
 *  core/config-manager.mjs
 * ============================================================
 *
 *  إدارة الإعدادات مع profiles:
 *  ① حفظ وتحميل profiles من ملف JSON
 *  ② 4 profiles جاهزة: default, fast, safe, deep
 *  ③ دمج profiles مع CLI args
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname }                                   from "path";
import { fileURLToPath }                                      from "url";

const __dir        = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR   = resolve(__dir, "..", "config");
const PROFILE_FILE = resolve(CONFIG_DIR, "profiles.json");

// ============================================================
//  الـ Profiles الافتراضية
// ============================================================

export const BUILT_IN_PROFILES = {
  default: {
    description:  "إعدادات متوازنة للاستخدام العادي",
    concurrency:  3,
    maxAds:       300,
    maxPages:     10,
    pageDelay:    1500,
    formats:      "excel,json",
    outputDir:    "./output",
  },

  fast: {
    description:  "أسرع جمع — concurrency عالية، تأخير أقل",
    concurrency:  5,
    maxAds:       500,
    maxPages:     15,
    pageDelay:    800,
    formats:      "json",
    outputDir:    "./output",
  },

  safe: {
    description:  "أبطأ وأأمن — تقليل خطر الحجب",
    concurrency:  1,
    maxAds:       100,
    maxPages:     5,
    pageDelay:    3000,
    formats:      "excel,json,csv",
    outputDir:    "./output",
  },

  deep: {
    description:  "جمع شامل مع تصفح الفئات",
    concurrency:  2,
    maxAds:       1000,
    maxPages:     30,
    pageDelay:    2000,
    formats:      "excel,json,csv",
    outputDir:    "./output/deep",
  },
};

// ============================================================
//  قراءة الـ profiles المحفوظة
// ============================================================

function readProfiles() {
  if (!existsSync(PROFILE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PROFILE_FILE, "utf8"));
  } catch {
    return {};
  }
}

// ============================================================
//  حفظ profile
// ============================================================

export function saveProfile(name, config) {
  mkdirSync(CONFIG_DIR, { recursive: true });

  const profiles = readProfiles();
  profiles[name] = {
    ...config,
    savedAt: new Date().toISOString(),
  };

  writeFileSync(PROFILE_FILE, JSON.stringify(profiles, null, 2), "utf8");
  console.log(`✅ Profile "${name}" محفوظ في: ${PROFILE_FILE}`);
}

// ============================================================
//  تحميل profile
// ============================================================

export function loadConfig(name) {
  // تحقق من الـ built-in profiles أولاً
  if (BUILT_IN_PROFILES[name]) {
    return { ...BUILT_IN_PROFILES[name] };
  }

  // ثم المحفوظة
  const profiles = readProfiles();
  return profiles[name] ? { ...profiles[name] } : null;
}

// ============================================================
//  عرض الـ profiles
// ============================================================

export function listProfiles() {
  console.log("\n📋 الـ Profiles المتاحة:\n");

  // Built-in
  console.log("  الـ Profiles الافتراضية:");
  for (const [name, cfg] of Object.entries(BUILT_IN_PROFILES)) {
    console.log(`    ${name.padEnd(12)} — ${cfg.description}`);
    console.log(`      concurrency: ${cfg.concurrency}  |  maxAds: ${cfg.maxAds}  |  delay: ${cfg.pageDelay}ms`);
  }

  // محفوظة
  const saved = readProfiles();
  if (Object.keys(saved).length > 0) {
    console.log("\n  الـ Profiles المحفوظة:");
    for (const [name, cfg] of Object.entries(saved)) {
      console.log(`    ${name.padEnd(12)} — ${cfg.savedAt ?? "غير معروف"}`);
    }
  }

  console.log();
}
