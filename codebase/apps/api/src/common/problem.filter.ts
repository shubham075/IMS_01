import type { ErrorCode, Problem } from "@idea01/schemas";
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodSerializationException, ZodValidationException } from "nestjs-zod";
import { AppError, type FieldIssue } from "./errors";

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: "VALIDATION_FAILED",
  401: "AUTH_REQUIRED",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
  409: "VERSION_CONFLICT",
  413: "VALIDATION_FAILED",
  415: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
};

function zodIssues(error: unknown): FieldIssue[] {
  const issues =
    (error as { issues?: Array<{ path: PropertyKey[]; message: string; code?: string }> })?.issues ?? [];
  return issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message, code: i.code }));
}

/** Turns every failure into RFC 7807 `application/problem+json` with a stable `code` and the request id as `trace_id`. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger("Problem");

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const traceId = String(request.id);

    let status = 500;
    let code: ErrorCode = "INTERNAL_ERROR";
    let title = "Internal error";
    let detail: string | undefined = "Something went wrong on our side. Please try again.";
    let errors: FieldIssue[] | undefined;
    let retryAfter: number | undefined;
    let existingId: string | undefined;

    if (exception instanceof AppError) {
      ({ status, code, title, detail } = exception);
      errors = exception.extra.errors;
      retryAfter = exception.extra.retryAfter;
      existingId = exception.extra.existingId;
    } else if (exception instanceof ZodValidationException) {
      status = 400;
      code = "VALIDATION_FAILED";
      title = "Bad request";
      detail = "The request is not valid.";
      errors = zodIssues(exception.getZodError());
    } else if (exception instanceof ZodSerializationException) {
      // A response did not match its schema: our bug, never the caller's. Log it, hide the details.
      this.log.error({ err: exception, traceId }, "response failed schema validation");
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_TO_CODE[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_FAILED");
      title = exception.name.replace(/Exception$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
      detail = status >= 500 ? "Something went wrong on our side. Please try again." : exception.message;
    }

    if (status >= 500) {
      // A deliberate 5xx (e.g. a dependency is down) is a warning; anything else reaching here is a bug.
      if (exception instanceof AppError)
        this.log.warn({ code, traceId, path: request.url }, "request failed");
      else this.log.error({ err: exception, traceId, path: request.url }, "unhandled error");
    }

    const body: Problem = {
      type: `https://idea01.app/problems/${code.toLowerCase().replace(/_/g, "-")}`,
      title,
      status,
      code,
      detail,
      trace_id: traceId,
      ...(retryAfter !== undefined ? { retry_after: retryAfter } : {}),
      ...(errors?.length ? { errors } : {}),
      ...(existingId ? { existing_id: existingId } : {}),
    };
    if (retryAfter !== undefined) reply.header("retry-after", String(retryAfter));
    reply.status(status).header("content-type", "application/problem+json; charset=utf-8").send(body);
  }
}
