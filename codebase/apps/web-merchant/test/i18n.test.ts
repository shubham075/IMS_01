import { readFileSync } from "node:fs";
import path from "node:path";
import { ERROR_CODES } from "@idea01/schemas";
import { describe, expect, it } from "vitest";

const load = (locale: string) =>
  JSON.parse(readFileSync(path.resolve(__dirname, `../messages/${locale}.json`), "utf8"));
const en = load("en");
const hi = load("hi");

function flatten(obj: unknown, prefix = ""): Record<string, string> {
  if (typeof obj === "string") return { [prefix]: obj };
  return Object.entries(obj as Record<string, unknown>).reduce(
    (acc, [k, v]) => Object.assign(acc, flatten(v, prefix ? `${prefix}.${k}` : k)),
    {} as Record<string, string>,
  );
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  const e = flatten(en);
  const h = flatten(hi);

  it("Hindi has exactly the same keys as English (nothing missing, nothing stray)", () => {
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
  });

  it("no translation is empty", () => {
    for (const [k, v] of [...Object.entries(e), ...Object.entries(h)]) expect(v.trim(), k).not.toBe("");
  });

  it("every placeholder in English exists in Hindi, so no value is silently dropped", () => {
    for (const k of Object.keys(e)) expect(placeholders(h[k]!), k).toEqual(placeholders(e[k]!));
  });

  it("Hindi text is actually Hindi (Devanagari), apart from product and technical terms", () => {
    const allowedLatin = new Set([
      "common.appName",
      "login.channel.sms",
      "login.channel.whatsapp",
      "branchForm.days",
      "shopForm.gstin",
    ]);
    const untranslated = Object.entries(h).filter(
      ([k, v]) => !/[ऀ-ॿ]/.test(v) && ![...allowedLatin].some((a) => k.startsWith(a)),
    );
    expect(untranslated.map(([k]) => k)).toEqual([]);
  });

  it("every API error code the user can meet has a friendly message in both languages", () => {
    const covered = new Set(Object.keys(en.errors.codes));
    // Codes the web app never surfaces to people directly are exempt: they indicate bugs or other clients.
    const exempt = new Set([
      "UNIT_NOT_CONVERTIBLE",
      "QTY_NOT_INTEGRAL",
      "DATE_OUT_OF_RANGE",
      "PRODUCT_INACTIVE",
      "CLIENT_UPGRADE_REQUIRED",
      "STEP_UP_REQUIRED",
      "RATE_LIMITED",
      "OTP_SEND_LIMIT",
    ]);
    const missing = ERROR_CODES.filter((c) => !covered.has(c) && !exempt.has(c));
    expect(missing).toEqual([]);
    expect(Object.keys(hi.errors.codes).sort()).toEqual(Object.keys(en.errors.codes).sort());
  });
});
