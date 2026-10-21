import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { SignJWT } from "jose";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPool, Client, CODE, createTestApp, randomPhone } from "./helpers";

let app: NestFastifyApplication;
let admin: pg.Pool;
beforeAll(async () => {
  app = await createTestApp();
  admin = adminPool();
});
afterAll(async () => {
  await app.close();
  await admin.end();
});

const anon = () => new Client(app);

describe("platform", () => {
  it("answers liveness and readiness without auth", async () => {
    for (const path of ["/healthz", "/readyz"]) {
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).status).toBe("ok");
    }
  });

  it("returns RFC 7807 problems with a stable code and the request id as trace_id", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
    expect(body.trace_id).toBe(res.headers["x-request-id"]);
  });

  it("unknown routes are 404 problems, not stack traces", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe("NOT_FOUND");
  });

  it("sets security headers and does not leak the framework", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("publishes the min client versions", async () => {
    const r = await anon().get("/meta/min-versions");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("android");
  });
});

describe("OTP request", () => {
  it("normalises Indian numbers and answers identically for known and unknown numbers", async () => {
    const known = await Client.login(app);
    await admin.query(
      "update otp_challenge set created_at = created_at - interval '40 seconds' where target = $1",
      [known.phone],
    );
    const a = await anon().post("/auth/otp/request", { phone: known.phone!.replace("+91", "91 ") });
    const b = await anon().post("/auth/otp/request", { phone: randomPhone().replace("+91", "") });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
    expect(a.body).toMatchObject({ channel: "sms", expiresInSeconds: 300, resendAfterSeconds: 30 });
  });

  it.each(["12345", "5876543210", "abcdefghij", ""])(
    "rejects the invalid phone %j with field errors",
    async (phone) => {
      const r = await anon().post("/auth/otp/request", { phone });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("VALIDATION_FAILED");
      expect(r.body.errors[0].path).toBe("phone");
    },
  );

  it("allows one code per 30 seconds", async () => {
    const phone = randomPhone();
    expect((await anon().post("/auth/otp/request", { phone })).status).toBe(200);
    const again = await anon().post("/auth/otp/request", { phone });
    expect(again.status).toBe(429);
    expect(again.body.code).toBe("RATE_LIMITED");
    expect(again.body.retry_after).toBeGreaterThan(0);
    expect(again.headers["retry-after"]).toBeDefined();
  });

  it("allows three codes per hour per number", async () => {
    const phone = randomPhone();
    for (let i = 0; i < 3; i++) {
      expect((await anon().post("/auth/otp/request", { phone })).status).toBe(200);
      await admin.query(
        "update otp_challenge set created_at = created_at - interval '40 seconds' where target = $1",
        [phone],
      );
    }
    const fourth = await anon().post("/auth/otp/request", { phone });
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe("OTP_SEND_LIMIT");
  });

  it("fails over to the next channel when the provider is down, and says which channel was used", async () => {
    const down = await createTestApp({ OTP_MOCK_FAIL_CHANNELS: "sms" });
    try {
      const r = await new Client(down).post("/auth/otp/request", { phone: randomPhone(), channel: "sms" });
      expect(r.status).toBe(200);
      expect(r.body.channel).toBe("whatsapp");
    } finally {
      await down.close();
    }
  });

  it("returns 503 and leaves no usable code behind when every channel is down", async () => {
    const down = await createTestApp({ OTP_MOCK_FAIL_CHANNELS: "sms,whatsapp,voice" });
    const phone = randomPhone();
    try {
      const r = await new Client(down).post("/auth/otp/request", { phone });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe("OTP_DELIVERY_FAILED");
      const left = await admin.query("select count(*)::int as n from otp_challenge where target = $1", [
        phone,
      ]);
      expect(left.rows[0].n).toBe(0);
    } finally {
      await down.close();
    }
  });

  it("stores only a hash of the code", async () => {
    const phone = randomPhone();
    await anon().post("/auth/otp/request", { phone });
    const row = (await admin.query("select code_hash from otp_challenge where target = $1", [phone])).rows[0];
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.code_hash).not.toContain(CODE);
  });
});

describe("OTP verify", () => {
  it("counts down attempts, then locks the code for good (even the right code fails)", async () => {
    const phone = randomPhone();
    await anon().post("/auth/otp/request", { phone });
    const wrong = { phone, code: "000000", acceptTerms: true };
    const left: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await anon().post("/auth/otp/verify", wrong);
      expect(r.status).toBe(401);
      expect(r.body.code).toBe("OTP_INVALID");
      left.push(r.body.detail);
    }
    expect(left[0]).toContain("4 tries left");
    expect(left[4]).toContain("0 tries left");
    const locked = await anon().post("/auth/otp/verify", { phone, code: CODE, acceptTerms: true });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("OTP_LOCKED");
  });

  it("cannot be beaten by parallel guessing", async () => {
    const phone = randomPhone();
    await anon().post("/auth/otp/request", { phone });
    const results = await Promise.all(
      Array.from({ length: 14 }, () =>
        anon().post("/auth/otp/verify", { phone, code: "999999", acceptTerms: true }),
      ),
    );
    const invalid = results.filter((r) => r.body.code === "OTP_INVALID").length;
    const locked = results.filter((r) => r.body.code === "OTP_LOCKED").length;
    expect(invalid).toBe(5);
    expect(locked).toBe(9);
    const attempts = (await admin.query("select attempts from otp_challenge where target = $1", [phone]))
      .rows[0].attempts;
    expect(attempts).toBe(5);
  });

  it("rejects an expired code", async () => {
    const phone = randomPhone();
    await anon().post("/auth/otp/request", { phone });
    await admin.query("update otp_challenge set expires_at = now() - interval '1 second' where target = $1", [
      phone,
    ]);
    const r = await anon().post("/auth/otp/verify", { phone, code: CODE, acceptTerms: true });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("OTP_EXPIRED");
  });

  it("a code works once", async () => {
    const phone = randomPhone();
    await anon().post("/auth/otp/request", { phone });
    expect((await anon().post("/auth/otp/verify", { phone, code: CODE, acceptTerms: true })).status).toBe(
      200,
    );
    const again = await anon().post("/auth/otp/verify", { phone, code: CODE, acceptTerms: true });
    expect(again.status).toBe(401);
  });

  it("a verify with no request at all is just an invalid code", async () => {
    const r = await anon().post("/auth/otp/verify", { phone: randomPhone(), code: CODE, acceptTerms: true });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("OTP_INVALID");
  });

  it("new numbers must accept the terms, and the code is not burned by asking", async () => {
    const phone = randomPhone();
    await anon().post("/auth/otp/request", { phone });
    const noTerms = await anon().post("/auth/otp/verify", { phone, code: CODE });
    expect(noTerms.status).toBe(422);
    expect(noTerms.body.code).toBe("TERMS_REQUIRED");
    const ok = await anon().post("/auth/otp/verify", { phone, code: CODE, acceptTerms: true });
    expect(ok.status).toBe(200);
    expect(ok.body.isNewUser).toBe(true);
    const audit = await admin.query("select action from audit_event where actor_user_id = $1 order by at", [
      ok.body.user.id,
    ]);
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["user.created", "terms.accepted", "auth.login"]),
    );
  });

  it("an existing user signs in without terms and is not marked new", async () => {
    const first = await Client.login(app);
    await admin.query(
      "update otp_challenge set created_at = created_at - interval '40 seconds' where target = $1",
      [first.phone],
    );
    await anon().post("/auth/otp/request", { phone: first.phone });
    const r = await anon().post("/auth/otp/verify", { phone: first.phone, code: CODE });
    expect(r.status).toBe(200);
    expect(r.body.isNewUser).toBe(false);
    expect(r.body.user.id).toBe(first.userId);
  });

  it("refuses a suspended account", async () => {
    const c = await Client.login(app);
    await admin.query("update app_user set status = 'suspended' where id = $1", [c.userId]);
    expect((await c.get("/me")).body.code).toBe("ACCOUNT_SUSPENDED");
    await admin.query(
      "update otp_challenge set created_at = created_at - interval '40 seconds' where target = $1",
      [c.phone],
    );
    await anon().post("/auth/otp/request", { phone: c.phone });
    const r = await anon().post("/auth/otp/verify", { phone: c.phone, code: CODE });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ACCOUNT_SUSPENDED");
  });
});

describe("tokens and sessions", () => {
  it("gives access to /me with a valid token", async () => {
    const c = await Client.login(app);
    const me = await c.get("/me");
    expect(me.status).toBe(200);
    expect(me.body.user.phone).toBe(c.phone);
    expect(me.body.memberships).toEqual([]);
  });

  it.each(["garbage", "Bearer", "Bearer a.b.c"])("rejects the malformed credential %j", async (h) => {
    const r = await anon().get("/me", { authorization: h });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("AUTH_REQUIRED");
  });

  it("rejects an expired access token with TOKEN_EXPIRED", async () => {
    const c = await Client.login(app);
    const key = new TextEncoder().encode(process.env.JWT_SECRET);
    const expired = await new SignJWT({ sid: "00000000-0000-0000-0000-000000000000" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(c.userId!)
      .setIssuer("idea01-api")
      .setAudience("idea01-merchant")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    const r = await anon().get("/me", { authorization: `Bearer ${expired}` });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("TOKEN_EXPIRED");
  });

  it("rejects a token signed with another key or for another audience", async () => {
    const c = await Client.login(app);
    const forge = (secret: string, aud: string) =>
      new SignJWT({ sid: "x" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(c.userId!)
        .setIssuer("idea01-api")
        .setAudience(aud)
        .setExpirationTime("5m")
        .sign(new TextEncoder().encode(secret));
    for (const t of [
      await forge("another-secret-another-secret-another-123", "idea01-merchant"),
      await forge(process.env.JWT_SECRET!, "idea01-consumer"),
    ]) {
      expect((await anon().get("/me", { authorization: `Bearer ${t}` })).status).toBe(401);
    }
  });

  it("logout revokes the session immediately, not when the token expires", async () => {
    const c = await Client.login(app);
    expect((await c.post("/auth/logout")).status).toBe(204);
    const r = await c.get("/me");
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("TOKEN_REVOKED");
    const refresh = await anon().post("/auth/refresh", { refreshToken: c.refreshToken });
    expect(refresh.body.code).toBe("TOKEN_REVOKED");
  });

  it("rotates refresh tokens: the new pair works, the old access token's session is replaced", async () => {
    const c = await Client.login(app);
    const r = await anon().post("/auth/refresh", { refreshToken: c.refreshToken });
    expect(r.status).toBe(200);
    expect(r.body.refreshToken).not.toBe(c.refreshToken);
    const next = new Client(app, r.body.accessToken, r.body.refreshToken);
    expect((await next.get("/me")).status).toBe(200);
  });

  it("treats an immediate replay of a just-rotated token as a race, without revoking the login", async () => {
    const c = await Client.login(app);
    const first = await anon().post("/auth/refresh", { refreshToken: c.refreshToken });
    const replay = await anon().post("/auth/refresh", { refreshToken: c.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe("TOKEN_EXPIRED");
    const still = await anon().post("/auth/refresh", { refreshToken: first.body.refreshToken });
    expect(still.status).toBe(200);
  });

  it("revokes the whole login when an old refresh token is replayed later (theft)", async () => {
    const c = await Client.login(app);
    const rotated = await anon().post("/auth/refresh", { refreshToken: c.refreshToken });
    await admin.query(
      "update session set revoked_at = now() - interval '5 minutes' where refresh_hash is not null and user_id = $1 and revoked_reason = 'rotated'",
      [c.userId],
    );
    const thief = await anon().post("/auth/refresh", { refreshToken: c.refreshToken });
    expect(thief.status).toBe(401);
    expect(thief.body.code).toBe("TOKEN_REVOKED");
    // the legitimate holder of the newest token is signed out too: the family is dead
    const victim = await anon().post("/auth/refresh", { refreshToken: rotated.body.refreshToken });
    expect(victim.body.code).toBe("TOKEN_REVOKED");
    expect((await new Client(app, rotated.body.accessToken).get("/me")).body.code).toBe("TOKEN_REVOKED");
    const audit = await admin.query(
      "select 1 from audit_event where actor_user_id = $1 and action = 'auth.refresh_reuse_detected'",
      [c.userId],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("rejects unknown and malformed refresh tokens", async () => {
    expect((await anon().post("/auth/refresh", { refreshToken: "x".repeat(40) })).body.code).toBe(
      "AUTH_REQUIRED",
    );
    expect((await anon().post("/auth/refresh", { refreshToken: "short" })).body.code).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("stores only a hash of refresh tokens", async () => {
    const c = await Client.login(app);
    const rows = (await admin.query("select refresh_hash from session where user_id = $1", [c.userId])).rows;
    expect(
      rows.every((r) => /^[0-9a-f]{64}$/.test(r.refresh_hash) && r.refresh_hash !== c.refreshToken),
    ).toBe(true);
  });

  it("lets two devices stay signed in independently", async () => {
    const a = await Client.login(app);
    await admin.query(
      "update otp_challenge set created_at = created_at - interval '40 seconds' where target = $1",
      [a.phone],
    );
    await anon().post("/auth/otp/request", { phone: a.phone });
    const second = await anon().post("/auth/otp/verify", {
      phone: a.phone,
      code: CODE,
      device: { platform: "android", label: "Shop phone" },
    });
    await a.post("/auth/logout");
    expect((await new Client(app, second.body.accessToken).get("/me")).status).toBe(200);
  });
});

describe("rate limiting", () => {
  it("limits OTP requests per client IP", async () => {
    const limited = await createTestApp({ RATE_LIMIT_ENABLED: "true" });
    try {
      const c = new Client(limited);
      const codes: number[] = [];
      for (let i = 0; i < 12; i++)
        codes.push((await c.post("/auth/otp/request", { phone: randomPhone() })).status);
      expect(codes.slice(0, 10).every((s) => s === 200)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });
});
