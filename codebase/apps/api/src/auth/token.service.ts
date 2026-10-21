import { Inject, Injectable } from "@nestjs/common";
import { errors as joseErrors, jwtVerify, SignJWT } from "jose";
import { Errors } from "../common/errors";
import { randomToken, sha256Hex } from "../common/util";
import { ENV, type Env } from "../config/env";

const ISSUER = "idea01-api";
const AUDIENCE = "idea01-merchant";

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = new TextEncoder().encode(env.JWT_SECRET);
  }

  get accessTtlSeconds() {
    return this.env.ACCESS_TOKEN_TTL_SECONDS;
  }
  get refreshTtlMs() {
    return this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000;
  }

  async signAccess({ userId, sessionId }: AccessClaims): Promise<string> {
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.env.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["HS256"],
      });
      if (!payload.sub || typeof payload.sid !== "string") throw Errors.authRequired();
      return { userId: payload.sub, sessionId: payload.sid };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) throw Errors.tokenExpired();
      if (err instanceof Error && "status" in err) throw err; // already an AppError
      throw Errors.authRequired();
    }
  }

  /** Refresh token = `<sessionId>.<random>`. Only the SHA-256 of it is stored. */
  newRefreshToken(sessionId: string) {
    const token = `${sessionId}.${randomToken(32)}`;
    return { token, hash: sha256Hex(token) };
  }

  hashRefresh(token: string) {
    return sha256Hex(token);
  }
}
