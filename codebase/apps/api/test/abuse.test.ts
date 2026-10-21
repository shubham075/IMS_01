import { randomUUID } from "node:crypto";
import type {
  Branch,
  Category,
  Invitation,
  MeResponse,
  MovementResult,
  ProductDetail,
  StockPage,
} from "@idea01/schemas";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPool, Client, createOrg, createTestApp, validBranch } from "./helpers";

/**
 * "How would real users break this?" Each test is an attack or a clumsy-but-realistic mistake:
 * double taps, two tabs, retries after a dropped connection, hostile input, tampered IDs.
 */
let app: NestFastifyApplication;
let admin: pg.Pool;
let hardwareId: string;
beforeAll(async () => {
  app = await createTestApp();
  admin = adminPool();
  const c = await Client.login(app);
  const org = await createOrg(c);
  hardwareId = (await c.get<Category[]>(`/merchant/orgs/${org.id}/categories`)).body.find(
    (x) => x.slug === "hardware",
  )!.id;
});
afterAll(async () => {
  await app.close();
  await admin.end();
});

async function setup() {
  const owner = await Client.login(app);
  const org = await createOrg(owner);
  const base = `/merchant/orgs/${org.id}`;
  const branch = (await owner.post<Branch>(`${base}/branches`, validBranch())).body;
  return { owner, org, base, branch, stock: `${base}/branches/${branch.id}/stock` };
}
type S = Awaited<ReturnType<typeof setup>>;
const product = async (s: S, over: Record<string, unknown> = {}) =>
  (
    await s.owner.post<ProductDetail>(`${s.base}/products`, {
      name: "Hammer",
      categoryId: hardwareId,
      ...over,
    })
  ).body;
const move = (
  s: S,
  productId: string,
  kind: string,
  quantity: number,
  over: Record<string, unknown> = {},
  c = s.owner,
  stock = s.stock,
) => c.post(`${stock}/movements`, { productId, kind, quantity, eventId: randomUUID(), ...over });
const onHand = async (s: S, productId: string) =>
  (await s.owner.get<StockPage>(`${s.stock}?limit=100`)).body.items.find((l) => l.productId === productId)!
    .onHand;
const drift = async (s: S) =>
  (await admin.query("select * from v_balance_drift where org_id = $1", [s.org.id])).rows;
const count = (rs: { status: number }[], status: number) => rs.filter((r) => r.status === status).length;

describe("1. double taps and two tabs", () => {
  it("ten simultaneous submits of one form record one entry", async () => {
    const s = await setup();
    const p = await product(s);
    const eventId = randomUUID();
    const rs = await Promise.all(Array.from({ length: 10 }, () => move(s, p.id, "receipt", 5, { eventId })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => !r.body.duplicate)).toHaveLength(1);
    expect(await onHand(s, p.id)).toBe(5);
    expect(await drift(s)).toEqual([]);
  });

  it("many different sales at the same moment never lose or invent stock", async () => {
    const s = await setup();
    const p = await product(s);
    await move(s, p.id, "receipt", 100);
    const rs = await Promise.all(Array.from({ length: 25 }, () => move(s, p.id, "sale", 1)));
    expect(count(rs, 200)).toBe(25);
    expect(await onHand(s, p.id)).toBe(75);
    expect(await drift(s)).toEqual([]);
  });

  it("five tabs undoing the same sale undo it once", async () => {
    const s = await setup();
    const p = await product(s);
    await move(s, p.id, "receipt", 10);
    const sale = (await move(s, p.id, "sale", 4)).body;
    const rs = await Promise.all(
      Array.from({ length: 5 }, () =>
        s.owner.post(`${s.stock}/movements/${sale.movementId}/reverse`, { eventId: randomUUID() }),
      ),
    );
    expect(count(rs, 200)).toBe(1);
    expect(count(rs, 409)).toBe(4);
    expect(await onHand(s, p.id)).toBe(10);
    expect(await drift(s)).toEqual([]);
  });

  it("two people setting opening stock at once: one wins, the other is told", async () => {
    const s = await setup();
    const p = await product(s);
    const rs = await Promise.all([10, 20, 30].map((q) => move(s, p.id, "opening", q)));
    expect(count(rs, 200)).toBe(1);
    expect(rs.filter((r) => r.status !== 200).every((r) => r.body.code === "OPENING_ALREADY_SET")).toBe(true);
    expect([10, 20, 30]).toContain(await onHand(s, p.id));
  });

  it("two people adding the same barcode at once: one product, one clear error, never a crash", async () => {
    const s = await setup();
    const rs = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        s.owner.post(`${s.base}/products`, {
          name: `Box ${i}`,
          categoryId: hardwareId,
          barcode: "9990001112223",
        }),
      ),
    );
    expect(count(rs, 201)).toBe(1);
    expect(
      rs
        .filter((r) => r.status !== 201)
        .every((r) => r.status === 409 && r.body.code === "DUPLICATE_IDENTIFIER"),
    ).toBe(true);
  });
});

describe("2. retries after a dropped connection", () => {
  it("re-sending the same event with a different amount is refused, not silently ignored", async () => {
    const s = await setup();
    const p = await product(s);
    const eventId = randomUUID();
    await move(s, p.id, "receipt", 5, { eventId });
    const changed = await move(s, p.id, "receipt", 50, { eventId });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await onHand(s, p.id)).toBe(5);
  });

  it("re-using an event id for another product or branch does not swallow the new entry", async () => {
    const s = await setup();
    const other = (await s.owner.post<Branch>(`${s.base}/branches`, validBranch({ name: "Other" }))).body;
    const a = await product(s, { name: "Aa" });
    const b = await product(s, { name: "Bb" });
    const eventId = randomUUID();
    await move(s, a.id, "receipt", 5, { eventId });
    expect((await move(s, b.id, "receipt", 5, { eventId })).status).toBe(409);
    expect(
      (await move(s, a.id, "receipt", 5, { eventId }, s.owner, `${s.base}/branches/${other.id}/stock`))
        .status,
    ).toBe(409);
    expect(await onHand(s, b.id)).toBe(0);
  });
});

describe("3. hostile and silly input", () => {
  it("absurd numbers, enormous text and control characters are rejected with 400, never a 500", async () => {
    const s = await setup();
    const p = await product(s);
    const bad = [
      move(s, p.id, "receipt", 1e300),
      move(s, p.id, "receipt", Number.MAX_SAFE_INTEGER),
      move(s, p.id, "receipt", 1, { note: "x".repeat(10_000) }),
      move(s, p.id, "receipt", 1, { note: "bad\u0000note" }),
      s.owner.post(`${s.base}/products`, { name: "x".repeat(5_000), categoryId: hardwareId }),
      s.owner.post(`${s.base}/products`, { name: "null\u0000byte", categoryId: hardwareId }),
      s.owner.post(`${s.base}/products`, {
        name: "Fine",
        categoryId: hardwareId,
        attrs: { a: { nested: "object" } },
      }),
      s.owner.post(`${s.base}/products`, { name: "Fine", categoryId: hardwareId, lowStockThreshold: 1e30 }),
      s.owner.post(`${s.base}/products`, { name: "Fine", categoryId: hardwareId, pricePaise: 1e30 }),
      s.owner.post(`${s.base}/products`, "not json at all"),
      s.owner.post(`${s.base}/products`, [1, 2, 3]),
    ];
    for (const r of await Promise.all(bad))
      expect([400, 413, 415], JSON.stringify(r.body)).toContain(r.status);
    expect(await onHand(s, p.id)).toBe(0);
  });

  it("SQL, wildcards and odd characters in search are just text", async () => {
    const s = await setup();
    await product(s, { name: "Safe product" });
    for (const q of [
      "'; DROP TABLE product;--",
      "%",
      "_",
      "\\",
      "a%b_c",
      "𝒳🔥",
      "' OR '1'='1",
      "x".repeat(80),
    ]) {
      const r = await s.owner.get(`${s.base}/products?q=${encodeURIComponent(q)}`);
      expect(r.status, q).toBe(200);
      const st = await s.owner.get(`${s.stock}?q=${encodeURIComponent(q)}`);
      expect(st.status, q).toBe(200);
      const cat = await s.owner.get(`${s.base}/catalogue/search?q=${encodeURIComponent(q)}`);
      expect(cat.status, q).toBe(200);
    }
    const all = await s.owner.get(`${s.base}/products`);
    expect(all.body.total).toBe(1); // nothing was dropped, and % did not match everything
    expect((await s.owner.get(`${s.base}/products?q=%25`)).body.total).toBe(0);
  });

  it("broken IDs, limits and offsets are 400, not crashes", async () => {
    const s = await setup();
    for (const url of [
      `${s.base}/products/not-a-uuid`,
      `${s.base}/products?limit=-1`,
      `${s.base}/products?limit=abc`,
      `${s.base}/products?limit=100000`,
      `${s.base}/products?offset=-5`,
      `${s.base}/products?offset=1e9`,
      `${s.base}/products?q=${"x".repeat(10_000)}`,
      `${s.base}/products?categoryId=nope`,
      `${s.stock}?filter=everything`,
      `${s.stock}/movements?from=yesterday`,
      `${s.stock}/movements?productId=1`,
      `${s.base}/branches/not-a-uuid/stock`,
    ]) {
      const r = await s.owner.get(url);
      expect(r.status, url.slice(0, 80)).toBe(400);
    }
  });
});

describe("4. tampering with IDs and fields", () => {
  it("another shop's IDs in any position reveal and change nothing", async () => {
    const a = await setup();
    const b = await setup();
    const p = await product(a);
    const m = (await move(a, p.id, "receipt", 5)).body;
    // history of someone else's product, through my own branch
    const h = await b.owner.get(`${b.stock}/movements?productId=${p.id}`);
    expect(h.body.total).toBe(0);
    // undoing someone else's entry through my own branch
    expect(
      (await b.owner.post(`${b.stock}/movements/${m.movementId}/reverse`, { eventId: randomUUID() })).status,
    ).toBe(404);
    // threshold / status / listing on someone else's product
    expect((await b.owner.put(`${b.stock}/threshold`, { productId: p.id, threshold: 1 })).status).toBe(404);
    expect(
      (await b.owner.put(`${b.base}/products/${p.id}/identifiers`, { barcodes: ["12345678"] })).status,
    ).toBe(404);
    expect(
      (await b.owner.put(`${b.base}/products/${p.id}/listings/${b.branch.id}`, { isPublished: false }))
        .status,
    ).toBe(404);
    // someone else's branch in my URL
    expect(
      (
        await b.owner.put(`${b.base}/products/${(await product(b)).id}/listings/${a.branch.id}`, {
          isPublished: false,
        })
      ).status,
    ).toBe(404);
    expect(await onHand(a, p.id)).toBe(5);
  });

  it("extra fields cannot move a product to another shop or change protected values", async () => {
    const a = await setup();
    const b = await setup();
    const p = await product(a);
    const r = await a.owner.patch(`${a.base}/products/${p.id}`, {
      name: "Renamed",
      org_id: b.org.id,
      orgId: b.org.id,
      id: randomUUID(),
      createdBy: randomUUID(),
      canonicalId: randomUUID(),
    });
    expect(r.status).toBe(200);
    const row = (await admin.query("select org_id, canonical_id from product where id = $1", [p.id])).rows[0];
    expect(row).toMatchObject({ org_id: a.org.id, canonical_id: null });
    for (const status of ["merged", "deleted", ""]) {
      expect((await a.owner.patch(`${a.base}/products/${p.id}`, { status })).status, status).toBe(400);
    }
  });

  it("a person cannot give themselves permissions through the request body", async () => {
    const s = await setup();
    const p = await product(s);
    const seller = await Client.login(app);
    await s.owner.post<Invitation>(`${s.base}/invitations`, { phone: seller.phone, role: "sales_operator" });
    const me = await seller.get<MeResponse>("/me");
    await seller.post(`/me/invitations/${me.body.pendingInvitations[0]!.id}/accept`);
    const r = await move(
      s,
      p.id,
      "receipt",
      5,
      { permissions: ["stock.write"], role: "owner", actorUserId: s.owner.userId },
      seller,
    );
    expect(r.status).toBe(403);
    expect(await onHand(s, p.id)).toBe(0);
  });
});

describe("5. changing things under existing stock", () => {
  it("the unit cannot change once stock has been recorded", async () => {
    const s = await setup();
    const p = await product(s, { unit: "kg" });
    expect((await s.owner.patch(`${s.base}/products/${p.id}`, { unit: "g" })).status).toBe(200); // nothing recorded yet
    await move(s, p.id, "receipt", 2.5);
    const r = await s.owner.patch(`${s.base}/products/${p.id}`, { unit: "pcs" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION_FAILED");
    expect((await s.owner.patch(`${s.base}/products/${p.id}`, { name: "Renamed nails" })).status).toBe(200);
    expect(await onHand(s, p.id)).toBe(2.5);
  });

  it("switching a product to not-counted while stock exists keeps the ledger intact", async () => {
    const s = await setup();
    const p = await product(s);
    await move(s, p.id, "receipt", 5);
    expect((await s.owner.patch(`${s.base}/products/${p.id}`, { trackingMode: "status_only" })).status).toBe(
      200,
    );
    expect((await move(s, p.id, "sale", 1)).status).toBe(400);
    expect(await drift(s)).toEqual([]);
  });
});

describe("6. people who should no longer have access", () => {
  it("a removed colleague cannot keep recording stock with their old session", async () => {
    const s = await setup();
    const p = await product(s);
    const keeper = await Client.login(app);
    await s.owner.post<Invitation>(`${s.base}/invitations`, {
      phone: keeper.phone,
      role: "inventory_operator",
    });
    const me = await keeper.get<MeResponse>("/me");
    await keeper.post(`/me/invitations/${me.body.pendingInvitations[0]!.id}/accept`);
    expect((await move(s, p.id, "receipt", 1, {}, keeper)).status).toBe(200);
    const members = (await s.owner.get<{ membershipId: string; userId: string }[]>(`${s.base}/members`)).body;
    await s.owner.del(`${s.base}/members/${members.find((m) => m.userId === keeper.userId)!.membershipId}`);
    const after = await move(s, p.id, "receipt", 1, {}, keeper);
    expect([401, 403, 404]).toContain(after.status);
    expect(await onHand(s, p.id)).toBe(1);
  });

  it("garbage, expired or stripped tokens never reach stock data", async () => {
    const s = await setup();
    for (const headers of [
      {},
      { authorization: "Bearer nonsense" },
      { authorization: "Bearer " },
      { authorization: "Basic YTpi" },
    ]) {
      const r = await app.inject({ method: "GET", url: `/v1${s.stock}`, headers });
      expect(r.statusCode, JSON.stringify(headers)).toBe(401);
    }
  });
});

describe("7. hammering the API", () => {
  it("a script firing hundreds of requests a minute is slowed down with 429 and Retry-After", async () => {
    const limited = await createTestApp({ RATE_LIMIT_ENABLED: "true" });
    try {
      const c = await Client.login(limited);
      const org = await createOrg(c);
      const url = `/merchant/orgs/${org.id}/products`;
      const rs = [];
      for (let i = 0; i < 320; i++) rs.push(await c.get(url));
      const throttled = rs.filter((r) => r.status === 429);
      expect(throttled.length).toBeGreaterThan(0);
      expect(rs.slice(0, 50).every((r) => r.status === 200)).toBe(true);
      expect(throttled[0]!.body.code).toBe("RATE_LIMITED");
      expect(Number(throttled[0]!.headers["retry-after"])).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });
});
