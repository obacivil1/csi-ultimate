import { PLANNING_RE, ROLE_PHRASE_RE, OTHER_CITY_RE, FOREIGN_CITY_RE, JOB_SEEKER_RE, NON_ROLE_RE, TARGET_ROLE_PHRASES, regionGate, isTargetRole, isJobSeeker, isServiceOffer, isBlockedPage } from "../../core/job-scan.mjs"

export const JOB_DEFAULTS = {
  location: "Riyadh",
  locationRe: /riyadh|الرياض/i,
  keywords: ["planning engineer", "scheduling engineer", "مهندس تخطيط"],
  days: 4,
  // jobs carries the planning/control ads; the other categories only produced
  // "no ads" pages, so they cost time and yielded nothing.
  expatLimits: { jobs: 10, "temp-jobs": 3 },
  globalBudgetMs: 540_000,
  sourceBudgetMs: 150_000,
  visitBudgetMs: 120_000,
  // 1 = serial visits. 3 got us HTTP 403 from Indeed and failed visits on
  // expatriates. Raise with --concurrency only if nothing gets blocked.
  concurrency: 1,
  mxTtlMs: 7 * 24 * 3600 * 1000,
}

export const MONTHS_EN = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sept:8,sep:8,oct:9,nov:10,dec:11 }
export const MONTHS_AR = {
  "يناير":0,"فبراير":1,"مارس":2,"ابريل":3,"أبريل":3,"مايو":4,"ماي":4,
  "يونيو":5,"يوليو":6,"يولية":6,"اغسطس":7,"أغسطس":7,"اوت":7,
  "سبتمبر":8,"شتنبر":8,"اكتوبر":9,"أكتوبر":9,"نوفمبر":10,"ديسمبر":11,
  "كانون الثاني":0,"كانون الثاني":0,"شباط":1,"اذار":2,"آذار":2,"نيسان":3,
  "ايار":4,"أيار":4,"حزيران":5,"تموز":6,"اب":7,"أب":7,"ايلول":8,"أيلول":8,
  "تشرين الاول":9,"تشرين الأول":9,"تشرين الثاني":10,"كانون الاول":11,"كانون الأول":11,
}
export const WEEKDAYS = /(?:mon|tue|wed|thu|fri|sat|sun|الاحد|الاثنين|الثلاثاء|الاربعاء|الأربعاء|الخميس|الجمعة|السبت)[a-z]*/i

export { PLANNING_RE, ROLE_PHRASE_RE, OTHER_CITY_RE, FOREIGN_CITY_RE, JOB_SEEKER_RE, NON_ROLE_RE, TARGET_ROLE_PHRASES, regionGate, isTargetRole, isJobSeeker, isServiceOffer, isBlockedPage }
export const JOBSEEKER_DOMAIN_RE = /gmail|yahoo|hotmail|outlook|icloud|protonmail|zoho/i
export const HARD_BAD_EMAIL_RE = /@expatriates\.(com|net)|noreply|no-reply|example|domain\.com|site\.com|yourdomain|@\[|unknown|\.png|\.jpg|\.jpeg|\.gif|@\d/i
export const MAIL_CTX_RE = /email|e-mail|mail|contact|send.*cv|cv.*(?:to|on)|apply|recruit|hr[.\s]|تواصل|إيميل|بريد|cv|سيرة|قدم|ترسل|راسل|قبول|\bhr\b/i
export const EMAIL_RAW_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g

export const BLOCK_RE = /(captcha|are you a robot|rate.?limit|too many requests|access denied|blocked|cf-error|cf-chl|checking your browser|just a moment|ddos|verify you are human|unusual traffic|enable javascript|please complete the security|cloudflare|attention required|forbidden|pardon our interruption)/i
export const LOGIN_WALL_RE = /(sign in to view|to continue,please sign|join linkedin|login or register|log in|register|you need to be signed in|please sign in)/i