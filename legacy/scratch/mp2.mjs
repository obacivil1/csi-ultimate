const PHONE_RX_INTL = /\+\d{1,3}[\s().-]*\d{1,4}[\s().-]*\d{1,4}[\s().-]*\d{2,10}/g;
const PHONE_RX_LOCAL = /\b0\d{9,10}\b/g;
const src = "Call +971501234567 or +966 55 123 4567 or 0501234567. Not a year 2026 and not 123.";
console.log("intl1:", JSON.stringify([...src.matchAll(PHONE_RX_INTL)].map((m) => m[0])));
console.log("intl regex:", PHONE_RX_INTL.toString(), "global?", PHONE_RX_INTL.global, "lastIndex", PHONE_RX_INTL.lastIndex);