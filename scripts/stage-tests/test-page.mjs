#!/usr/bin/env node
import { chromium } from "playwright";
import { existsSync, unlinkSync } from "fs";

const HEADLESS = !process.argv.includes("--visible");
const TARGET = process.argv.find(a => a.startsWith("--url="))?.split("=")[1] || "https://www.expatriates.com/classifieds/riyadh/";
const SCREENSHOT_PATH = process.argv.find(a => a.startsWith("--output="))?.split("=")[1] || "riyadh.png";

let exitCode = 0;

function assert(cond, label) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label}`);
    exitCode = 1;
  }
}

try {
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage();

  console.log(`📸 Screenshot test — ${HEADLESS ? "headless" : "visible"} → ${TARGET}`);

  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 });
  const title = await page.title();
  assert(typeof title === "string" && title.length > 0, `Title: "${title.slice(0, 60)}"`);

  if (existsSync(SCREENSHOT_PATH)) {
    try { unlinkSync(SCREENSHOT_PATH); } catch {}
  }

  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
  assert(existsSync(SCREENSHOT_PATH), `Screenshot saved: ${SCREENSHOT_PATH}`);

  await browser.close();
} catch (err) {
  console.log(`  💥 ${err.message}`);
  exitCode = 1;
}

console.log(exitCode ? "⚠️  Failed" : "🎉  Passed");
process.exit(exitCode);
