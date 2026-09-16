import { minePhones } from "../../core/contact-miner.mjs";
const phones = minePhones("Call +971501234567 or +966 55 123 4567 or 0501234567. Not a year 2026 and not 123.");
console.log(JSON.stringify(phones));