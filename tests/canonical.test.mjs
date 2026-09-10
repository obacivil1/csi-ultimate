import test from "node:test";
import assert from "node:assert/strict";
import { cleanPhone, isValidPhone, cleanEmail, cleanPrice, detectCurrency } from "../core/canonical-extractor.mjs";

test("canonical: cleanPhone handles SAR format (+966 55...) when SA context", () => {
  const p = cleanPhone("+966 55 123 4567", "https://sa.example.com/ad/1", "SA");
  assert.equal(p, "+966551234567");
});

test("canonical: cleanPhone converts local 05xx to +966 when SA context", () => {
  const p = cleanPhone("0551234567", "https://sa.example.com/ad/1", "SA");
  assert.equal(p, "+966551234567");
});

test("canonical: isValidPhone accepts SAR format", () => {
  assert.equal(isValidPhone("+966551234567", "SA"), true);
  assert.equal(isValidPhone("0551234567", "SA"), true);
  assert.equal(isValidPhone("051234567", "SA"), false);
});

test("canonical: cleanEmail extracts the address verbatim", () => {
  const out = cleanEmail("  CONTACT@Acme-Firm.com  reach out");
  assert.equal(out.toLowerCase(), "contact@acme-firm.com");
});

test("canonical: cleanEmail rejects blacklisted domains (example.com)", () => {
  assert.equal(cleanEmail("test@example.com"), null);
});

test("canonical: cleanPrice preserves text form with commas", () => {
  assert.equal(cleanPrice("1,234.50"), "1,234.50");
  assert.equal(cleanPrice("  £45.00  "), "45.00");
});

test("canonical: detectCurrency recognizes SAR/USD/GBP", () => {
  assert.equal(detectCurrency("This costs 100 SAR each"), "SAR");
  assert.equal(detectCurrency("Only \$50"), "USD");
  assert.equal(detectCurrency("£45 ono"), "GBP");
});