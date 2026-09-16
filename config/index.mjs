import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const defaults = JSON.parse(
  fs.readFileSync(path.join(__dirname, "defaults.json"), "utf8")
);
export const rateLimit = defaults.rateLimit;
export const timeouts = defaults.timeouts;
export const stealth = defaults.stealth;
export const siteDelay = defaults.siteDelay;
export const pipeline = defaults.pipeline;
export const scoring = defaults.scoring;
export const banDetection = defaults.banDetection;
export const circuitBreaker = defaults.circuitBreaker;
export const fingerprint = defaults.fingerprint;