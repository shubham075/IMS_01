/** Prices travel as whole paise (₹1 = 100). People type and read rupees. */

export type ParsedPrice = { ok: true; paise: number | null } | { ok: false };

/** "249", "249.5", "1,299.00", "₹ 99" -> paise. Empty -> null (no price). Anything else -> invalid. */
export function parseRupees(input: string | null | undefined): ParsedPrice {
  const s = (input ?? "").replace(/[₹,]/g, "").trim(); // inner spaces stay, so "12 34" is rejected, not read as 1234
  if (s === "") return { ok: true, paise: null };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false };
  const [rupees = "0", fraction = ""] = s.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? { ok: true, paise } : { ok: false };
}

/** 129900 -> "₹1,299"; 24950 -> "₹249.50" (Indian digit grouping). */
export function formatRupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const whole = paise % 100 === 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

/** For an input's default value: 24950 -> "249.50", 24900 -> "249", null -> "". */
export function paiseToInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

/** "a, b\nc" -> ["a","b","c"] without blanks or repeats. */
export function splitList(input: string | null | undefined): string[] {
  return [
    ...new Set(
      (input ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
