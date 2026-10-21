import { randomUUID } from "node:crypto";
import type {
  Branch,
  Category,
  CountDetail,
  CountPage,
  Invitation,
  LookupResult,
  MeResponse,
  ProductDetail,
  Role,
  StockPage,
} from "@idea01/schemas";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPool, Client, createOrg, createTestApp, validBranch } from "./helpers";

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
  return { owner, org, base, branch, counts: `${base}/branches/${branch.id}/counts` };
}
type S = Awaited<ReturnType<typeof setup>>;
async function join(s: S, role: Exclude<Role, "owner">, branchIds: string[] = []) {
  const c = await Client.login(app);
  await s.owner.post<Invitation>(`${s.base}/invitations`, { phone: c.phone, role, branchIds });
  const me = await c.get<MeResponse>("/me");
  await c.post(`/me/invitations/${me.body.pendingInvitations[0]!.id}/accept`);
  return c;
}
const product = async (s: S, over: Record<string, unknown> = {}) =>
  (
    await s.owner.post<ProductDetail>(`${s.base}/products`, {
      name: "Hammer",
      categoryId: hardwareId,
      ...over,
    })
  ).body;
const move = (s: S, productId: string, kind: string, quantity: number, branchId = s.branch.id) =>
  s.owner.post(`${s.base}/branches/${branchId}/stock/movements`, {
    productId,
    kind,
    quantity,
    eventId: randomUUID(),
  });
const onHand = async (s: S, productId: string) =>
  (await s.owner.get<StockPage>(`${s.base}/branches/${s.branch.id}/stock?limit=100`)).body.items.find(
    (l) => l.productId === productId,
  )!.onHand;
const lookup = (s: S, code: string, extra = "", c: Client = s.owner) =>
  c.get<LookupResult>(`${s.base}/catalogue/lookup?code=${encodeURIComponent(code)}${extra}`);
const startCount = (s: S, c: Client = s.owner) => c.post<CountDetail>(s.counts, {});
const line = (s: S, countId: string, productId: string, quantity: number, c: Client = s.owner) =>
  c.post(`${s.counts}/${countId}/lines`, { productId, quantity });
const drift = async (s: S) =>
  (await admin.query("select * from v_balance_drift where org_id = $1", [s.org.id])).rows;

describe("finding a product by code", () => {
  it("matches barcode, product code, search name and quick code (any case)", async () => {
    const s = await setup();
    const p = await product(s, { barcode: "8901000000011", sku: "HAM-5" });
    await s.owner.put(`${s.base}/products/${p.id}/identifiers`, {
      barcodes: ["8901000000011"],
      skus: ["HAM-5"],
      aliases: ["hathoda"],
    });
    const q = await product(s, { name: "No barcode" });
    for (const code of ["8901000000011", "HAM-5", "hathoda"]) {
      const r = await lookup(s, code);
      expect(r.body.product?.id, code).toBe(p.id);
    }
    expect((await lookup(s, q.shortCode!.toLowerCase())).body.product?.id).toBe(q.id);
    expect((await lookup(s, ` ${q.shortCode} `)).body.product?.id).toBe(q.id);
  });

  it("includes the stock at a branch, and nothing for an unknown code", async () => {
    const s = await setup();
    const p = await product(s, { barcode: "7770000000001" });
    await move(s, p.id, "receipt", 7);
    const r = await lookup(s, "7770000000001", `&branchId=${s.branch.id}`);
    expect(r.body.stock).toMatchObject({ productId: p.id, onHand: 7 });
    expect((await lookup(s, "7770000000001")).body.stock).toBeNull();
    const none = await lookup(s, "0000000000000");
    expect(none.body).toEqual({ product: null, canonical: null, stock: null });
  });

  it("falls back to the shared catalogue so a new product can be prefilled", async () => {
    const s = await setup();
    const code = `99${Date.now().toString().slice(-8)}`;
    await admin.query(
      "insert into canonical_product (name, brand, barcode, category_id) values ('Shared saw', 'Stanley', $1, $2)",
      [code, hardwareId],
    );
    const r = await lookup(s, code);
    expect(r.body.product).toBeNull();
    expect(r.body.canonical).toMatchObject({ name: "Shared saw", brand: "Stanley", barcode: code });
  });

  it("never shows another shop's product, and switched-off products carry no stock", async () => {
    const a = await setup();
    const b = await setup();
    const p = await product(a, { barcode: "6660000000001" });
    expect((await lookup(b, "6660000000001")).body.product).toBeNull();
    await a.owner.patch(`${a.base}/products/${p.id}`, { status: "inactive" });
    const r = await lookup(a, "6660000000001", `&branchId=${a.branch.id}`);
    expect(r.body.product).toMatchObject({ id: p.id, status: "inactive" });
    expect(r.body.stock).toBeNull();
    expect((await lookup(b, "6660000000001", `&branchId=${a.branch.id}`)).status).toBe(404);
  });

  it("odd input is harmless: SQL, wildcards, emoji, huge and empty codes", async () => {
    const s = await setup();
    await product(s, { barcode: "5550000000001" });
    for (const code of [
      "'; DROP TABLE product;--",
      "%",
      "_",
      "\\",
      "5550000000001' OR '1'='1",
      "🔥",
      "x".repeat(65),
      "",
      "   ",
      "a\u0000b",
    ]) {
      const r = await lookup(s, code);
      expect([200, 400], JSON.stringify(code)).toContain(r.status);
      if (r.status === 200) expect(r.body.product, JSON.stringify(code)).toBeNull();
    }
    expect((await lookup(s, "5550000000001")).body.product).not.toBeNull();
    expect((await s.owner.get(`${s.base}/catalogue/lookup`)).status).toBe(400);
    expect((await lookup(s, "123456", "&branchId=nope")).status).toBe(400);
  });
});

describe("a stock count", () => {
  it("corrects stock to what was counted, and a sale made during the count is not lost", async () => {
    const s = await setup();
    const p = await product(s);
    await move(s, p.id, "receipt", 10);
    const c = (await startCount(s)).body;
    expect(c).toMatchObject({ status: "draft", kind: "cycle", lineCount: 0, corrections: 0 });

    const counted = await line(s, c.id, p.id, 8);
    expect(counted.status, JSON.stringify(counted.body)).toBe(200);
    expect(counted.body.lines[0]).toMatchObject({ counted: 8, expected: 10, difference: -2 });
    expect(counted.body.corrections).toBe(1);

    await move(s, p.id, "sale", 1); // sold while counting
    expect(await onHand(s, p.id)).toBe(9);

    const done = await s.owner.post<CountDetail>(`${s.counts}/${c.id}/finalize`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.status).toBe("finalized");
    expect(await onHand(s, p.id)).toBe(7); // 9 - 2: the correction is relative to the moment of counting
    expect(await drift(s)).toEqual([]);
    expect((await s.owner.post(`${s.counts}/${c.id}/finalize`)).status).toBe(200); // repeating is harmless
    expect(await onHand(s, p.id)).toBe(7);
  });

  it("the latest number counted for a product wins, and a product never stocked counts from zero", async () => {
    const s = await setup();
    const p = await product(s);
    const fresh = await product(s, { name: "Fresh" });
    const c = (await startCount(s)).body;
    await line(s, c.id, p.id, 3);
    await line(s, c.id, p.id, 5);
    const r = await line(s, c.id, fresh.id, 4);
    expect(
      r.body.lines
        .map((l: { name: string; counted: number; expected: number }) => [l.name, l.counted, l.expected])
        .sort(),
    ).toEqual([
      ["Fresh", 4, 0],
      ["Hammer", 5, 0],
    ]);
    await s.owner.post(`${s.counts}/${c.id}/finalize`);
    expect(await onHand(s, p.id)).toBe(5);
    expect(await onHand(s, fresh.id)).toBe(4);
  });

  it("starting twice, even at the same moment, gives the same count", async () => {
    const s = await setup();
    const rs = await Promise.all(Array.from({ length: 5 }, () => startCount(s)));
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    const list = (await s.owner.get<CountPage>(s.counts)).body;
    expect(list.total).toBe(1);
  });

  it("five people finishing the count at once correct the stock once", async () => {
    const s = await setup();
    const p = await product(s);
    await move(s, p.id, "receipt", 10);
    const c = (await startCount(s)).body;
    await line(s, c.id, p.id, 6);
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => s.owner.post(`${s.counts}/${c.id}/finalize`)),
    );
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(await onHand(s, p.id)).toBe(6);
    expect(await drift(s)).toEqual([]);
  });

  it("refuses bad lines: negative, fractional pieces, uncounted, switched-off, unknown and other shops' products", async () => {
    const s = await setup();
    const other = await setup();
    const p = await product(s);
    const loose = await product(s, { name: "Loose", trackingMode: "status_only" });
    const off = await product(s, { name: "Off" });
    await s.owner.patch(`${s.base}/products/${off.id}`, { status: "inactive" });
    const theirs = await product(other);
    const c = (await startCount(s)).body;
    const cases: Array<[string, string, number, number]> = [
      ["negative", p.id, -1, 400],
      ["fractional pieces", p.id, 1.5, 422],
      ["too many decimals", p.id, 1.0001, 400],
      ["huge", p.id, 1e12, 400],
      ["uncounted product", loose.id, 1, 400],
      ["switched off", off.id, 1, 400],
      ["unknown", randomUUID(), 1, 404],
      ["other shop's product", theirs.id, 1, 404],
    ];
    for (const [name, id, qty, status] of cases)
      expect((await line(s, c.id, id, qty)).status, name).toBe(status);
    expect((await s.owner.post(`${s.counts}/${c.id}/lines`, { productId: "x", quantity: 1 })).status).toBe(
      400,
    );
    expect((await s.owner.post(`${s.counts}/${c.id}/lines`, {})).status).toBe(400);
    expect((await s.owner.post(`${s.counts}/${c.id}/finalize`)).status).toBe(400); // nothing counted yet
  });

  it("a finished or cancelled count cannot be changed; cancelling changes no stock", async () => {
    const s = await setup();
    const p = await product(s);
    await move(s, p.id, "receipt", 10);
    const c = (await startCount(s)).body;
    await line(s, c.id, p.id, 1);
    const cancelled = await s.owner.post<CountDetail>(`${s.counts}/${c.id}/abandon`);
    expect(cancelled.body.status).toBe("abandoned");
    expect(await onHand(s, p.id)).toBe(10);
    expect((await s.owner.post(`${s.counts}/${c.id}/abandon`)).status).toBe(200);
    expect((await line(s, c.id, p.id, 2)).status).toBe(409);
    expect((await s.owner.post(`${s.counts}/${c.id}/finalize`)).status).toBe(409);

    const d = (await startCount(s)).body;
    expect(d.id).not.toBe(c.id); // a new one can be started
    await line(s, d.id, p.id, 4);
    await s.owner.post(`${s.counts}/${d.id}/finalize`);
    expect((await line(s, d.id, p.id, 9)).status).toBe(409);
    expect((await s.owner.post(`${s.counts}/${d.id}/abandon`)).status).toBe(409);
  });

  it("a count left open for a week closes itself without touching the stock", async () => {
    const s = await setup();
    const p = await product(s);
    await move(s, p.id, "receipt", 10);
    const c = (await startCount(s)).body;
    await line(s, c.id, p.id, 1);
    await admin.query("update stock_count set expires_at = now() - interval '1 minute' where id = $1", [
      c.id,
    ]);
    expect((await line(s, c.id, p.id, 2)).status).toBe(409);
    const detail = (await s.owner.get<CountDetail>(`${s.counts}/${c.id}`)).body;
    expect(detail.status).toBe("abandoned");
    expect(await onHand(s, p.id)).toBe(10);
    expect((await startCount(s)).body.id).not.toBe(c.id);
  });

  it("lists counts with status filters and pages", async () => {
    const s = await setup();
    const p = await product(s);
    const one = (await startCount(s)).body;
    await s.owner.post(`${s.counts}/${one.id}/abandon`);
    const two = (await startCount(s)).body;
    await line(s, two.id, p.id, 1);
    expect((await s.owner.get<CountPage>(s.counts)).body.items.map((c) => c.id)).toEqual([two.id, one.id]);
    expect((await s.owner.get<CountPage>(`${s.counts}?status=draft`)).body.items.map((c) => c.id)).toEqual([
      two.id,
    ]);
    expect(
      (await s.owner.get<CountPage>(`${s.counts}?limit=1&offset=1`)).body.items.map((c) => c.id),
    ).toEqual([one.id]);
    for (const url of ["?status=weird", "?limit=0", "?offset=-1"])
      expect((await s.owner.get(`${s.counts}${url}`)).status, url).toBe(400);
  });
});

describe("who can count", () => {
  it("follows the role matrix and branch limits", async () => {
    const s = await setup();
    const other = (await s.owner.post<Branch>(`${s.base}/branches`, validBranch({ name: "Other" }))).body;
    const p = await product(s);
    const keeper = await join(s, "inventory_operator", [s.branch.id]);
    const seller = await join(s, "sales_operator");
    const auditor = await join(s, "auditor");
    for (const c of [seller, auditor]) {
      const r = await startCount(s, c);
      expect(r.status).toBe(403);
      expect((await c.get(s.counts)).status).toBe(403);
    }
    const mine = await startCount(s, keeper);
    expect(mine.status).toBe(200);
    expect((await line(s, mine.body.id, p.id, 3, keeper)).status).toBe(200);
    const elsewhere = await keeper.post(`${s.base}/branches/${other.id}/counts`, {});
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.body.code).toBe("BRANCH_OUT_OF_SCOPE");
    // a count belongs to its branch: it cannot be reached through another branch's URL
    expect((await s.owner.get(`${s.base}/branches/${other.id}/counts/${mine.body.id}`)).status).toBe(404);
    expect((await keeper.post(`${s.counts}/${mine.body.id}/finalize`)).status).toBe(200);
  });

  it("strangers get 404 and read-only shops cannot count", async () => {
    const a = await setup();
    const b = await setup();
    const p = await product(a);
    const c = (await startCount(a)).body;
    expect((await b.owner.get(`${a.counts}/${c.id}`)).status).toBe(404);
    expect((await b.owner.post(a.counts, {})).status).toBe(404);
    expect((await b.owner.get(`${b.base}/branches/${b.branch.id}/counts/${c.id}`)).status).toBe(404);
    await admin.query("update organization set status = 'read_only' where id = $1", [a.org.id]);
    expect((await line(a, c.id, p.id, 1)).status).toBe(403);
    expect((await startCount(a)).status).toBe(403);
  });
});
