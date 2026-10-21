import "server-only";
import { headers } from "next/headers";
import { type ActionResult, failFromError, ok } from "../action-result";

/** Wraps an action body: returns data, or an ActionResult error the UI can translate. Never throws to the client. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (err) {
    return failFromError(err);
  }
}

/**
 * The visitor's IP as reported by the edge proxy in front of this server. It is forwarded to the API so its per-IP
 * limits apply per visitor, not to this server as a whole. In production the edge must overwrite X-Forwarded-For.
 */
export async function clientIpHeaders(): Promise<Record<string, string>> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip");
  return ip ? { "x-forwarded-for": ip } : {};
}
