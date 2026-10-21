import { ApiError } from "@idea01/api-client";
import { createOrgSchema } from "@idea01/schemas";
import { describe, expect, it } from "vitest";
import { failFromError, failFromZod } from "@/lib/action-result";
import { errorText } from "@/lib/error-text";
import { clean, localizedErrors } from "@/lib/form";
import { defaultHours, hoursFromApi, hoursToApi } from "@/lib/hours";
import { formatRupees, paiseToInput, parseRupees, splitList } from "@/lib/money";
import { validationText } from "@/lib/validation-text";
import en from "../messages/en.json";
import hi from "../messages/hi.json";

/** Minimal stand-in for next-intl's translator, backed by the real message files. */
function translator(messages: Record<string, unknown>) {
  const get = (key: string) =>
    key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
  const t = ((key: string, values: Record<string, unknown> = {}) =>
    String(get(key)).replace(/\{(\w+)\}/g, (_, n) => String(values[n] ?? ""))) as unknown as Parameters<
    typeof errorText
  >[0];
  (t as unknown as { has: (k: string) => boolean }).has = (k) => typeof get(k) === "string";
  return t;
}
const tEn = translator(en);
const tHi = translator(hi);

describe("errorText", () => {
  it("shows the remaining tries for a wrong code, in either language", () => {
    const e = { code: "OTP_INVALID", message: "That code is not right. 4 tries left." };
    expect(errorText(tEn, e)).toBe("That code is not right. 4 tries left.");
    expect(errorText(tHi, e)).toContain("4");
    expect(errorText(tHi, e)).toMatch(/[ऀ-ॿ]/);
  });
  it("turns retry-after seconds into minutes for the OTP send limit", () => {
    expect(errorText(tEn, { code: "OTP_SEND_LIMIT", message: "", retryAfter: 1800 })).toContain("30 minutes");
  });
  it("uses the code, never the server's English message", () => {
    expect(errorText(tHi, { code: "PERMISSION_DENIED", message: "You do not have permission" })).toMatch(
      /[ऀ-ॿ]/,
    );
  });
  it("falls back to a generic message for codes it does not know", () => {
    expect(errorText(tEn, { code: "SOMETHING_NEW", message: "x" })).toBe(
      "Something went wrong. Please try again.",
    );
  });
  it("covers a lost connection", () => {
    expect(errorText(tEn, { code: "NETWORK_ERROR", message: "" })).toContain("No internet");
  });
});

describe("validationText", () => {
  it("translates the shared schema messages", () => {
    expect(validationText(tHi, "Enter a valid 10-digit Indian mobile number.")).toMatch(/[ऀ-ॿ]/);
    expect(validationText(tEn, "PIN code must be 6 digits.")).toBe("PIN code must be 6 digits.");
  });
  it("translates the weekday inside hours messages", () => {
    expect(validationText(tHi, "Closing time must be after opening time for mon.")).toContain("सोम");
  });
  it("leaves unknown messages untouched and tolerates undefined", () => {
    expect(validationText(tEn, "Something unexpected")).toBe("Something unexpected");
    expect(validationText(tEn, undefined)).toBeUndefined();
  });
});

describe("form helpers", () => {
  it("clean() trims text and drops empty optional fields (an empty GSTIN is not an invalid GSTIN)", () => {
    expect(clean({ name: "  Shop  ", gstin: "", phone: "   ", n: null, flag: false })).toEqual({
      name: "Shop",
      flag: false,
    });
  });
  it("localizedErrors() returns the first message per field in the user's language", () => {
    const parsed = createOrgSchema.safeParse(clean({ name: "A", category: "hardware", gstin: "BAD" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errs = localizedErrors(tHi, parsed.error);
      expect(Object.keys(errs).sort()).toEqual(["gstin", "name"]);
      expect(errs.name).toMatch(/[ऀ-ॿ]/);
    }
  });
});

describe("action results", () => {
  it("keeps the API error code, field errors and support reference", () => {
    const r = failFromError(
      new ApiError({
        status: 400,
        code: "VALIDATION_FAILED",
        trace_id: "abc",
        errors: [{ path: "pincode", message: "PIN code must be 6 digits." }],
      }),
    );
    expect(r).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      traceId: "abc",
      fieldErrors: { pincode: "PIN code must be 6 digits." },
    });
  });
  it("hides unexpected exceptions behind a generic error", () => {
    expect(failFromError(new Error("secret db password in message"))).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
    });
  });
  it("maps zod problems to field errors", () => {
    const parsed = createOrgSchema.safeParse({});
    if (!parsed.success) expect(Object.keys(failFromZod(parsed.error).fieldErrors ?? {})).toContain("name");
  });
});

describe("opening hours", () => {
  it("defaults to Monday-Saturday 09:00-21:00 with Sunday closed", () => {
    expect(hoursToApi(defaultHours())).toEqual({
      mon: [["09:00", "21:00"]],
      tue: [["09:00", "21:00"]],
      wed: [["09:00", "21:00"]],
      thu: [["09:00", "21:00"]],
      fri: [["09:00", "21:00"]],
      sat: [["09:00", "21:00"]],
    });
  });
  it("round-trips what the API stores", () => {
    const stored = { mon: [["10:00", "14:00"]], sun: [["11:00", "13:00"]] } as const;
    const state = hoursFromApi(stored as never);
    expect(state.mon).toEqual({ on: true, from: "10:00", to: "14:00" });
    expect(state.tue.on).toBe(false);
    expect(hoursToApi(state)).toEqual(stored);
  });
  it("shows defaults when nothing was saved yet", () => {
    expect(hoursFromApi(undefined)).toEqual(defaultHours());
    expect(hoursFromApi({})).toEqual(defaultHours());
  });
});

describe("money", () => {
  it("parses what people type into whole paise", () => {
    expect(parseRupees("249")).toEqual({ ok: true, paise: 24900 });
    expect(parseRupees("249.5")).toEqual({ ok: true, paise: 24950 });
    expect(parseRupees("₹ 1,299.05")).toEqual({ ok: true, paise: 129905 });
    expect(parseRupees("  ")).toEqual({ ok: true, paise: null });
    expect(parseRupees("0.07")).toEqual({ ok: true, paise: 7 }); // no floating-point drift
    for (const bad of ["abc", "-5", "1.234", "1,2,3.x", "12 34"])
      expect(parseRupees(bad), bad).toEqual({ ok: false });
  });
  it("shows rupees with Indian grouping", () => {
    expect(formatRupees(129900)).toBe("₹1,299");
    expect(formatRupees(24950)).toBe("₹249.50");
    expect(formatRupees(12345600)).toBe("₹1,23,456");
    expect(formatRupees(null)).toBe("");
  });
  it("round-trips through the price input", () => {
    for (const paise of [0, 7, 24900, 24950, 129905]) {
      expect(parseRupees(paiseToInput(paise))).toEqual({ ok: true, paise });
    }
  });
  it("splits comma/newline lists without blanks or repeats", () => {
    expect(splitList("a, b,\nc, a, ,")).toEqual(["a", "b", "c"]);
    expect(splitList("")).toEqual([]);
  });
});

describe("product validation text", () => {
  it("is available in Hindi", () => {
    expect(validationText(tHi, "Enter the product name (at least 2 letters).")).toContain("प्रोडक्ट");
    expect(validationText(tEn, "Price cannot be negative.")).toBe("Price cannot be negative.");
  });
});
