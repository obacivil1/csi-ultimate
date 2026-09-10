import { env } from "../config/env.mjs";

const LEVELS = { SILENT: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4 };

export const level = LEVELS[env.LOG_LEVEL] ?? LEVELS.INFO;

function emit(sev, msg, meta) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level: sev,
    msg: String(msg ?? ""),
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  });
  if (sev === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

function ok(sev) {
  return LEVELS[sev] !== undefined && LEVELS[sev] <= level;
}

export const logger = {
  debug: (msg, meta) => ok("DEBUG") && emit("debug", msg, meta),
  info: (msg, meta) => ok("INFO") && emit("info", msg, meta),
  warn: (msg, meta) => ok("WARN") && emit("warn", msg, meta),
  error: (msg, meta) => ok("ERROR") && emit("error", msg, meta),
  child(bindings = {}) {
    return {
      debug: (m, meta) => this.debug(m, { ...bindings, ...meta }),
      info: (m, meta) => this.info(m, { ...bindings, ...meta }),
      warn: (m, meta) => this.warn(m, { ...bindings, ...meta }),
      error: (m, meta) => this.error(m, { ...bindings, ...meta }),
    };
  },
};