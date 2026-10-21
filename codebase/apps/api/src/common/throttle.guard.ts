import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { RATE_LIMIT_KEY } from "../auth/decorators";
import { ENV, type Env } from "../config/env";
import { Errors } from "./errors";

interface Limit {
  limit: number;
  windowSeconds: number;
}
const DEFAULT_LIMIT: Limit = { limit: 300, windowSeconds: 60 };

/**
 * Fixed-window rate limit per client IP and route. In-memory: correct for a single instance. When the API runs on
 * several instances, swap `hits` for a Redis counter (same interface) so the limit is shared.
 */
@Injectable()
export class ThrottleGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = Date.now();

  constructor(
    private readonly reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.env.RATE_LIMIT_ENABLED) return true;
    const cfg =
      this.reflector.getAllAndOverride<Limit>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]) ??
      DEFAULT_LIMIT;
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const key = `${req.ip}|${context.getClass().name}.${context.getHandler().name}`;
    const now = Date.now();
    this.sweep(now);

    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + cfg.windowSeconds * 1000 });
      return true;
    }
    cur.count++;
    if (cur.count > cfg.limit) throw Errors.rateLimited(Math.max(1, Math.ceil((cur.resetAt - now) / 1000)));
    return true;
  }

  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
