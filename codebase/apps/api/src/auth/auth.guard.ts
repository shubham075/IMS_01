import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { Errors } from "../common/errors";
import { AuthService } from "./auth.service";
import { IS_PUBLIC } from "./decorators";

/** Global default: every route needs a valid, non-revoked access token unless it is marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]))
      return true;
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    const match = header?.match(/^Bearer\s+(\S+)$/i);
    if (!match) throw Errors.authRequired();
    req.auth = await this.auth.authenticate(match[1]!);
    return true;
  }
}
