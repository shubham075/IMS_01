import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256Hex = (v: string) => createHash("sha256").update(v).digest("hex");
export const hmacHex = (secret: string, v: string) => createHmac("sha256", secret).update(v).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** +919876543210 -> +91••••••3210 (never log full phone numbers). */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return `${phone.slice(0, 3)}${"•".repeat(Math.max(0, phone.length - 7))}${phone.slice(-4)}`;
}

export const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;
export const isoReq = (d: Date | string): string => new Date(d).toISOString();
