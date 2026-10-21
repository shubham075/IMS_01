import "reflect-metadata";
import { randomInt } from "node:crypto";
import type { Org, TokenResponse } from "@idea01/schemas";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import pg from "pg";
import { createAppModule } from "../src/app.module";
import { configureApp, createAdapter } from "../src/bootstrap";

export const CODE = "123456";

export async function createTestApp(env: Record<string, string> = {}): Promise<NestFastifyApplication> {
  const mod = await Test.createTestingModule({
    imports: [createAppModule({ RATE_LIMIT_ENABLED: "false", ...env })],
  }).compile();
  const app = mod.createNestApplication<NestFastifyApplication>(createAdapter(false));
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** Superuser connection for arranging and checking data directly (bypasses row-level security). */
export function adminPool() {
  return new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
}

export const randomPhone = () => `+9199${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;

type Json = Record<string, any>;
export interface Res<T = Json> {
  status: number;
  body: T;
  headers: Record<string, any>;
}

export class Client {
  constructor(
    readonly app: NestFastifyApplication,
    public accessToken?: string,
    public refreshToken?: string,
    public userId?: string,
    readonly phone?: string,
  ) {}

  async call<T = Json>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Res<T>> {
    const res = await this.app.inject({
      method,
      url: `/v1${url}`,
      payload: body === undefined ? undefined : (body as object),
      headers: { ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}), ...headers },
    });
    let parsed: unknown;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = res.body;
    }
    return { status: res.statusCode, body: parsed as T, headers: res.headers };
  }
  get = <T = Json>(url: string, h?: Record<string, string>) => this.call<T>("GET", url, undefined, h);
  post = <T = Json>(url: string, body?: unknown, h?: Record<string, string>) =>
    this.call<T>("POST", url, body, h);
  patch = <T = Json>(url: string, body?: unknown) => this.call<T>("PATCH", url, body);
  del = <T = Json>(url: string) => this.call<T>("DELETE", url);

  /** Full login: ask for a code, verify it, accept the terms. */
  static async login(app: NestFastifyApplication, phone = randomPhone()): Promise<Client> {
    const anon = new Client(app);
    const req = await anon.post("/auth/otp/request", { phone });
    if (req.status !== 200) throw new Error(`otp request failed: ${JSON.stringify(req.body)}`);
    const ver = await anon.post<TokenResponse>("/auth/otp/verify", {
      phone,
      code: CODE,
      acceptTerms: true,
      device: { platform: "web" },
    });
    if (ver.status !== 200) throw new Error(`otp verify failed: ${JSON.stringify(ver.body)}`);
    return new Client(app, ver.body.accessToken, ver.body.refreshToken, ver.body.user.id, phone);
  }
}

export async function createOrg(c: Client, name = "Test Hardware"): Promise<Org> {
  const r = await c.post<Org>("/merchant/orgs", { name, category: "hardware" });
  if (r.status !== 201) throw new Error(`create org failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

export const validBranch = (over: Json = {}) => ({
  name: "Main shop",
  addressLine: "12, 4th Block Main Road",
  pincode: "560011",
  location: { lat: 12.925, lng: 77.583 },
  hours: { mon: [["09:00", "21:00"]] },
  ...over,
});
