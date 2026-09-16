import test from "node:test";
import assert from "node:assert/strict";
import {
  geoForHostname,
  geoDefaultsFor,
  alignProfile,
  getRandomFingerprint,
  buildContextOptions,
  initSessionFingerprint,
  rotateFingerprint,
  getSessionFingerprint,
  PROFILES,
} from "../core/fingerprint-engine.mjs";

test("fingerprint-geo: المضيف يُخصَّص منطقة حسب الجمهور", () => {
  assert.equal(geoForHostname("gumtree.co.uk"), "uk");
  assert.equal(geoForHostname("www.gumtree.co.uk"), "uk");
  assert.equal(geoForHostname("olx.com.pk"), "pk");
  assert.equal(geoForHostname("expatriates.com"), "gcc");
  assert.equal(geoForHostname("etimad.gov.sa"), "sa");
  assert.equal(geoForHostname("unknown-site.xyz"), "gcc", "الافتراضي: خليجي");
});

test("fingerprint-geo: البروفايل يُحاذى زمنياً ولغوياً للمنطقة", () => {
  const fp = getRandomFingerprint({ region: "uk" });
  assert.equal(fp.profile.timezone, "Europe/London");
  assert.equal(fp.profile.locale, "en-GB");
  assert.ok(fp.profile.languages.includes("en-GB"));
  const fp2 = getRandomFingerprint({ region: "pk" });
  assert.equal(fp2.profile.timezone, "Asia/Karachi");
  assert.equal(geoDefaultsFor("sa").timezone, "Asia/Riyadh");
});

test("fingerprint-geo: alignProfile لا يغيّر البروفايل الأصلي", () => {
  const original = PROFILES[0].timezone;
  const aligned = alignProfile(PROFILES[0], "uk");
  assert.equal(aligned.timezone, "Europe/London");
  assert.equal(PROFILES[0].timezone, original, "الأصلى يبقى كما هو");
});

test("fingerprint-geo: buildContextOptions يحترم الموقع الجغرافي للمنطقة", () => {
  const fp = getRandomFingerprint({ region: "gcc" });
  const opts = buildContextOptions(fp);
  assert.equal(opts.geolocation.latitude, 25.2048, "دبي");
  assert.equal(opts.timezoneId, "Asia/Dubai");
});

test("fingerprint-geo: جلسة تدور مع إبقاء المنطقة", () => {
  initSessionFingerprint("uk");
  const s1 = getSessionFingerprint();
  assert.equal(s1.profile.timezone, "Europe/London");
  rotateFingerprint();
  const s2 = getSessionFingerprint();
  assert.equal(s2.profile.timezone, "Europe/London", "تدوير ضمن نفس المنطقة");
  rotateFingerprint("gcc");
  assert.equal(getSessionFingerprint().profile.timezone, "Asia/Dubai");
});

test("fingerprint-geo: portable تتاح بدون مساحة (نصي/جوال)", () => {
  const mobile = getRandomFingerprint({ region: "uk", mobile: true });
  assert.equal(mobile.profile.touchSupport, true);
  const desktop = getRandomFingerprint({ region: "uk", mobile: false });
  assert.equal(desktop.profile.touchSupport, false);
});