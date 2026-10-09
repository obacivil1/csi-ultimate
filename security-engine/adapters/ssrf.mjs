/**
 * adapters/ssrf.mjs — SSRF adapter (§23).
 *
 * The ONLY bridge between security-engine and core/ssrf-guard.mjs. It wraps
 * assertPublicUrl so the scope gate consumes existing SSRF protection without
 * duplicating it — and without modifying it. Never throws: every outcome is
 * data, and any failure means "not safe".
 */
import { assertPublicUrl } from "../../core/ssrf-guard.mjs";

export async function checkUrlSafety(rawUrl) {
  try {
    const u = await assertPublicUrl(rawUrl);
    return { safe: true, normalized: u.href, reason: "public-url" };
  } catch (e) {
    return { safe: false, normalized: null, reason: e?.message || "blocked" };
  }
}
