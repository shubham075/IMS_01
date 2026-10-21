import { randomInt } from "node:crypto";
import { OTP_CHANNELS, type OtpChannel, type OtpRequestResponse } from "@idea01/schemas";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "kysely";
import { Errors } from "../common/errors";
import { hmacHex, maskPhone, safeEqualHex } from "../common/util";
import { ENV, type Env } from "../config/env";
import { Db } from "../db/db.service";
import { OTP_PROVIDER, type OtpProvider } from "./otp-provider";

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_RESEND_SECONDS = 30;
export const OTP_MAX_SENDS_PER_HOUR = 3;
export const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  private readonly log = new Logger("Otp");

  constructor(
    private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
  ) {}

  private hash(phone: string, code: string) {
    return hmacHex(this.env.OTP_HMAC_SECRET, `${phone}:${code}`);
  }

  /**
   * Sends a login code. The response is identical whether or not the number has an account (no enumeration).
   * Limits: one code per 30 s, three per hour per number. If the chosen channel is down we fail over SMS -> WhatsApp -> voice.
   */
  async request(phone: string, channel: OtpChannel, ip: string | undefined): Promise<OtpRequestResponse> {
    const k = this.db.kysely;

    const recent = await k
      .selectFrom("otp_challenge")
      .select(["created_at"])
      .where("target", "=", phone)
      .where("created_at", ">", sql<Date>`now() - interval '1 hour'`)
      .orderBy("created_at", "asc")
      .execute();

    const last = recent.at(-1);
    if (last) {
      const wait = OTP_RESEND_SECONDS - (Date.now() - new Date(last.created_at).getTime()) / 1000;
      if (wait > 0) throw Errors.rateLimited(Math.ceil(wait), "Please wait before asking for another code.");
    }
    if (recent.length >= OTP_MAX_SENDS_PER_HOUR) {
      const oldest = new Date(recent[0]!.created_at).getTime();
      throw Errors.otpSendLimit(Math.max(1, Math.ceil((oldest + 3600_000 - Date.now()) / 1000)));
    }

    const code = this.env.OTP_MOCK_FIXED_CODE ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
    const row = await k
      .insertInto("otp_challenge")
      .values({
        target: phone,
        channel,
        purpose: "login",
        code_hash: this.hash(phone, code),
        max_attempts: OTP_MAX_ATTEMPTS,
        ip: ip ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const order = [channel, ...OTP_CHANNELS.filter((c) => c !== channel)];
    for (const ch of order) {
      try {
        await this.provider.send({ target: phone, channel: ch, code });
        if (ch !== channel)
          await k.updateTable("otp_challenge").set({ channel: ch }).where("id", "=", row.id).execute();
        return { channel: ch, expiresInSeconds: OTP_TTL_SECONDS, resendAfterSeconds: OTP_RESEND_SECONDS };
      } catch (err) {
        this.log.warn(
          { err: String(err), channel: ch, phone: maskPhone(phone) },
          "otp delivery failed, trying next channel",
        );
      }
    }
    // Nothing worked: do not leave a usable challenge behind, and do not count this against the user's hourly limit.
    await k.deleteFrom("otp_challenge").where("id", "=", row.id).execute();
    throw Errors.otpDelivery();
  }

  /**
   * Checks a code against the latest open challenge without consuming it. Every check costs one attempt (atomically),
   * so parallel guessing cannot beat the limit. Returns the challenge id to pass to `consume`.
   */
  async check(phone: string, code: string): Promise<string> {
    const k = this.db.kysely;
    const ch = await k
      .selectFrom("otp_challenge")
      .select(["id", "code_hash", "expires_at", "max_attempts"])
      .where("target", "=", phone)
      .where("consumed_at", "is", null)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst();

    if (!ch) throw Errors.otpInvalid();
    const secondsLeft = Math.ceil((new Date(ch.expires_at).getTime() - Date.now()) / 1000);
    if (secondsLeft <= 0) throw Errors.otpExpired();

    const bumped = await k
      .updateTable("otp_challenge")
      .set({ attempts: sql<number>`attempts + 1` })
      .where("id", "=", ch.id)
      .where("consumed_at", "is", null)
      .where(sql<boolean>`attempts < max_attempts`)
      .returning(["attempts", "max_attempts"])
      .executeTakeFirst();
    if (!bumped) throw Errors.otpLocked(secondsLeft);

    if (!safeEqualHex(ch.code_hash, this.hash(phone, code))) {
      throw Errors.otpInvalid(bumped.max_attempts - bumped.attempts);
    }
    return ch.id;
  }

  /** Marks the challenge used. Returns false if someone else already consumed it (single use, race-safe). */
  async consume(challengeId: string): Promise<boolean> {
    const done = await this.db.kysely
      .updateTable("otp_challenge")
      .set({ consumed_at: sql<Date>`now()` })
      .where("id", "=", challengeId)
      .where("consumed_at", "is", null)
      .returning("id")
      .executeTakeFirst();
    return !!done;
  }
}
