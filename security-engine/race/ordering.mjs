/**
 * race/ordering.mjs — ordering log + release attestation.
 *
 * The log is the evidentiary record of what the barrier did, in order:
 * registration, release, dispatch, completion, timeout/cancel events —
 * each with a monotonic sequence number. Wall timestamps are recorded
 * where available but are explicitly SUPPLEMENTARY (reviewer visibility
 * only): no verdict may rest on timestamp proximity. Decisions rest on
 * release attestation (did every required participant cross one release
 * event?) plus state differentials, never on timing.
 */
import {
  requireObject,
  requireNonEmptyString,
  isoNow,
  freezeRecord,
} from "../common.mjs";

export function createOrderingLog(correlation_id = null) {
  let seq = 0;
  const events = [];
  const corr = correlation_id === null || correlation_id === undefined
    ? null
    : requireNonEmptyString(correlation_id, "correlation_id");

  return {
    append(type, detail = {}) {
      const t = requireNonEmptyString(type, "type");
      requireObject(detail, "detail");
      seq += 1;
      const event = freezeRecord({ seq, type: t, at: isoNow(), correlation_id: corr, ...detail });
      events.push(event);
      return event;
    },

    events() {
      return Object.freeze([...events]);
    },

    size() {
      return events.length;
    },
  };
}

/**
 * Release attestation: exactly one release event must exist, and every
 * required party must show a dispatch event sequenced after it. This
 * attests CONTROLLED RELEASE — permission crossing one gate — never
 * physical simultaneity and never target-side overlap.
 */
export function attestRelease(log, partyIds) {
  requireObject(log, "log");
  if (!Array.isArray(partyIds) || partyIds.length === 0 || partyIds.some((p) => typeof p !== "string" || !p)) {
    throw new Error("partyIds must be a non-empty array of strings");
  }
  const evts = typeof log.events === "function" ? log.events() : [];
  const releases = evts.filter((e) => e.type === "release");
  if (releases.length !== 1) {
    return freezeRecord({
      attested: false,
      reason: releases.length === 0 ? "no-release-event" : "multiple-release-events",
      release_seq: null,
      parties_covered: 0,
      parties_total: partyIds.length,
    });
  }
  const relSeq = releases[0].seq;
  const dispatched = new Set(
    evts.filter((e) => e.type === "dispatch" && e.seq > relSeq).map((e) => e.participant_id)
  );
  const missing = partyIds.filter((p) => !dispatched.has(p));
  if (missing.length > 0) {
    return freezeRecord({
      attested: false,
      reason: `undispatched-participants:${missing.length}`,
      release_seq: relSeq,
      parties_covered: partyIds.length - missing.length,
      parties_total: partyIds.length,
    });
  }
  return freezeRecord({
    attested: true,
    reason: "all-parties-dispatched-after-single-release",
    release_seq: relSeq,
    parties_covered: partyIds.length,
    parties_total: partyIds.length,
  });
}

/**
 * Dispatch timestamps for reviewer visibility ONLY. Returned as-is from
 * dispatch events; must never feed a verdict (see module header).
 */
export function dispatchTimestamps(log) {
  requireObject(log, "log");
  const evts = typeof log.events === "function" ? log.events() : [];
  return Object.freeze(
    evts
      .filter((e) => e.type === "dispatch")
      .map((e) => freezeRecord({ participant_id: e.participant_id ?? null, seq: e.seq, t_wall: e.t_wall ?? null }))
  );
}
