import type { ErrorCode, Problem } from "@idea01/schemas";
import createClient, { type Client, type ClientOptions } from "openapi-fetch";
import type { paths } from "./schema";

export type { components, paths } from "./schema";
export type ApiClient = Client<paths>;

/** Thrown by `unwrap` when the API answers with a problem+json body. Carries the stable `code` clients switch on. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "NETWORK_ERROR";
  readonly traceId?: string;
  readonly retryAfter?: number;
  readonly fieldErrors: Record<string, string>;

  constructor(problem: Partial<Problem> & { status: number }, code?: ErrorCode | "NETWORK_ERROR") {
    super(problem.detail ?? problem.title ?? "Request failed");
    this.status = problem.status;
    this.code = code ?? problem.code ?? "INTERNAL_ERROR";
    this.traceId = problem.trace_id;
    this.retryAfter = problem.retry_after;
    this.fieldErrors = Object.fromEntries((problem.errors ?? []).map((e) => [e.path, e.message]));
  }
}

export function createApiClient(baseUrl: string, options: Omit<ClientOptions, "baseUrl"> = {}): ApiClient {
  return createClient<paths>({ baseUrl, ...options });
}

/** Turns an openapi-fetch result into data or a thrown ApiError. A failed connection becomes code NETWORK_ERROR. */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch (cause) {
    console.error("api call failed before a response", cause);
    throw new ApiError(
      { status: 0, detail: "Could not reach the server. Check your connection and try again." },
      "NETWORK_ERROR",
    );
  }
  if (result.error !== undefined || !result.response.ok) {
    const problem = (result.error ?? {}) as Partial<Problem>;
    throw new ApiError({ ...problem, status: result.response.status });
  }
  return result.data as T;
}
