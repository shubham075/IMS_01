import { randomUUID } from "node:crypto";
import type { OtpVerify, TokenResponse, UserProfile } from "@idea01/schemas";
import { Injectable, Logger } from "@nestjs/common";
import { sql } from "kysely";
import { Errors } from "../common/errors";
import { maskPhone } from "../common/util";
import { Db, type Trx } from "../db/db.service";
import type { AuthContext } from "./auth.types";
import { OtpService } from "./otp.service";
import { TokenService } from "./token.service";

/** A refresh token presented again right after it was rotated is almost always two tabs racing, not theft. */
const ROTATION_GRACE_MS = 10_000;

type RefreshOutcome =
  | { kind: "ok"; tokens: TokenResponse }
  | { kind: "reuse" }
  | { kind: "revoked" }
  | { kind: "race" }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "suspended" };

@Injectable()
export class AuthService {
  private readonly log = new Logger("Auth");

  constructor(
    private readonly db: Db,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
  ) {}

  /** Verifies the OTP and signs the user in, creating the account on first use. */
  async loginWithOtp(dto: OtpVerify, ip: string | undefined): Promise<TokenResponse> {
    const challengeId = await this.otp.check(dto.phone, dto.code);

    const existing = await this.db.kysely
      .selectFrom("app_user")
      .select(["id", "status"])
      .where("phone_e164", "=", dto.phone)
      .executeTakeFirst();
    if (existing && existing.status !== "active") throw Errors.suspended();
    // Only someone holding the right code gets to learn whether the number is new. The code is not consumed yet, so
    // the client can resubmit the same code with acceptTerms=true.
    if (!existing && dto.acceptTerms !== true) throw Errors.termsRequired();

    if (!(await this.otp.consume(challengeId))) throw Errors.otpInvalid();

    const result = await this.db.tx({}, async (trx) => {
      let userId = existing?.id;
      let isNewUser = false;
      if (!userId) {
        const created = await trx
          .insertInto("app_user")
          .values({ kind: "merchant", phone_e164: dto.phone })
          .onConflict((oc) => oc.column("phone_e164").doNothing())
          .returning("id")
          .executeTakeFirst();
        isNewUser = !!created;
        userId =
          created?.id ??
          (
            await trx
              .selectFrom("app_user")
              .select("id")
              .where("phone_e164", "=", dto.phone)
              .executeTakeFirstOrThrow()
          ).id;
        if (isNewUser) {
          await this.audit(trx, userId, "user.created", { channel: "otp" });
          await this.audit(trx, userId, "terms.accepted", { documents: ["terms-of-use", "privacy-notice"] });
        }
      }

      const device = await trx
        .insertInto("device")
        .values({
          user_id: userId,
          platform: dto.device?.platform ?? "web",
          label: dto.device?.label ?? null,
          app_version: dto.device?.appVersion ?? null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const session = await this.issueSession(trx, { userId, deviceId: device.id });
      await trx
        .updateTable("app_user")
        .set({ last_active_at: sql<Date>`now()` })
        .where("id", "=", userId)
        .execute();
      await this.audit(trx, userId, "auth.login", {
        platform: dto.device?.platform ?? "web",
        ip: ip ?? null,
      });
      const profile = await this.profile(trx, userId);
      return { session, profile, isNewUser };
    });

    this.log.log(
      { user: result.profile.id, phone: maskPhone(dto.phone), newUser: result.isNewUser },
      "login",
    );
    return {
      ...result.session,
      expiresIn: this.tokens.accessTtlSeconds,
      isNewUser: result.isNewUser,
      user: result.profile,
    };
  }

  /**
   * Rotates a refresh token. Presenting an already-rotated token later means it was copied: the whole login family
   * (every device session derived from that login) is revoked. The revocation is committed before we answer 401.
   */
  async refresh(refreshToken: string): Promise<TokenResponse> {
    const hash = this.tokens.hashRefresh(refreshToken);
    const outcome = await this.db.tx<RefreshOutcome>({}, async (trx) => {
      const s = await trx
        .selectFrom("session")
        .selectAll()
        .where("refresh_hash", "=", hash)
        .forUpdate()
        .executeTakeFirst();
      if (!s) return { kind: "invalid" };

      if (s.revoked_at) {
        const age = Date.now() - new Date(s.revoked_at).getTime();
        if (s.revoked_reason === "rotated") {
          if (age <= ROTATION_GRACE_MS) return { kind: "race" };
          await trx
            .updateTable("session")
            .set({ revoked_at: sql<Date>`now()`, revoked_reason: "reuse_detected" })
            .where("family_id", "=", s.family_id)
            .where("revoked_at", "is", null)
            .execute();
          await this.audit(trx, s.user_id, "auth.refresh_reuse_detected", { family: s.family_id });
          return { kind: "reuse" };
        }
        return { kind: "revoked" }; // signed out, or the family was revoked after theft was detected
      }
      if (new Date(s.expires_at).getTime() <= Date.now()) return { kind: "expired" };

      const user = await trx
        .selectFrom("app_user")
        .select("status")
        .where("id", "=", s.user_id)
        .executeTakeFirstOrThrow();
      if (user.status !== "active") return { kind: "suspended" };

      await trx
        .updateTable("session")
        .set({ revoked_at: sql<Date>`now()`, revoked_reason: "rotated" })
        .where("id", "=", s.id)
        .execute();
      const next = await this.issueSession(trx, {
        userId: s.user_id,
        deviceId: s.device_id,
        familyId: s.family_id,
        rotatedFrom: s.id,
      });
      await trx
        .updateTable("app_user")
        .set({ last_active_at: sql<Date>`now()` })
        .where("id", "=", s.user_id)
        .execute();
      const profile = await this.profile(trx, s.user_id);
      return {
        kind: "ok",
        tokens: { ...next, expiresIn: this.tokens.accessTtlSeconds, isNewUser: false, user: profile },
      };
    });

    switch (outcome.kind) {
      case "ok":
        return outcome.tokens;
      case "reuse":
        throw Errors.tokenRevoked("This sign-in was used somewhere else. For your safety, sign in again.");
      case "revoked":
        throw Errors.tokenRevoked();
      case "race":
        throw Errors.tokenExpired("Your session was just renewed. Retry with the newest token.");
      case "expired":
        throw Errors.tokenExpired();
      case "suspended":
        throw Errors.suspended();
      default:
        throw Errors.authRequired();
    }
  }

  /** Signs out this device: revokes the whole refresh-token family of the current session. */
  async logout(auth: AuthContext): Promise<void> {
    await this.db.tx({ userId: auth.userId }, async (trx) => {
      const s = await trx
        .selectFrom("session")
        .select("family_id")
        .where("id", "=", auth.sessionId)
        .executeTakeFirst();
      if (!s) return;
      await trx
        .updateTable("session")
        .set({ revoked_at: sql<Date>`now()`, revoked_reason: "logout" })
        .where("family_id", "=", s.family_id)
        .where("revoked_at", "is", null)
        .execute();
    });
  }

  /** Validates an access token and that its session is still alive (so revocation is immediate). */
  async authenticate(accessToken: string): Promise<AuthContext> {
    const claims = await this.tokens.verifyAccess(accessToken);
    const row = await this.db.kysely
      .selectFrom("session as s")
      .innerJoin("app_user as u", "u.id", "s.user_id")
      .select(["s.revoked_at", "s.expires_at", "u.status", "u.phone_e164"])
      .where("s.id", "=", claims.sessionId)
      .where("s.user_id", "=", claims.userId)
      .executeTakeFirst();
    if (!row || row.revoked_at) throw Errors.tokenRevoked();
    if (new Date(row.expires_at).getTime() <= Date.now()) throw Errors.tokenExpired();
    if (row.status !== "active") throw Errors.suspended();
    return { userId: claims.userId, sessionId: claims.sessionId, phone: row.phone_e164 };
  }

  private async issueSession(
    trx: Trx,
    p: { userId: string; deviceId: string | null; familyId?: string; rotatedFrom?: string },
  ) {
    const id = randomUUID();
    const { token, hash } = this.tokens.newRefreshToken(id);
    await trx
      .insertInto("session")
      .values({
        id,
        user_id: p.userId,
        device_id: p.deviceId,
        family_id: p.familyId ?? randomUUID(),
        refresh_hash: hash,
        rotated_from: p.rotatedFrom ?? null,
        expires_at: new Date(Date.now() + this.tokens.refreshTtlMs),
      })
      .execute();
    const accessToken = await this.tokens.signAccess({ userId: p.userId, sessionId: id });
    return { accessToken, refreshToken: token };
  }

  async profile(trx: Trx | Db["kysely"], userId: string): Promise<UserProfile> {
    const u = await trx
      .selectFrom("app_user")
      .select(["id", "phone_e164", "display_name", "locale"])
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    return {
      id: u.id,
      phone: u.phone_e164,
      displayName: u.display_name,
      locale: u.locale as UserProfile["locale"],
    };
  }

  /** Audit is part of the same transaction: if it cannot be written, the action does not happen (fail closed). */
  private async audit(trx: Trx, actor: string, action: string, meta: Record<string, unknown>) {
    await trx
      .insertInto("audit_event")
      .values({ actor_user_id: actor, action, meta: JSON.stringify(meta) })
      .execute();
  }
}
