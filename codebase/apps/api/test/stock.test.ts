import { randomUUID } from "node:crypto";
import type {
  Branch,
  Category,
  Invitation,
  MeResponse,
  MovementPage,
  MovementResult,
  ProductDetail,
  Role,
  StockLine,
  StockPage,
  StockSummary,
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
  const owner = await Client.login(app);
  const org = await createOrg(owner);
  hardwareId = (await owner.get<Category[]>(`/merchant/orgs/${org.id}/categories`)).body.find(
    (c) => c.slug === "hardware",
  )!.id;
});
afterAll(async () => {
  await app.close();
  await admin.end();
});

async function setup() {
  const owner = await Client.login(app);
  await owner.patch("/me", { displayName: "Asha Verma" });
  const org = await createOrg(owner);
  const base = `/merchant/orgs/${org.id}`;
  const branch = (await owner.post<Branch>(`${base}/branches`, validBranch())).body;
  const stock = `${base}/branches/${branch.id}/stock`;
  return { owner, org, base, branch, stock };
}
type S = Awaited<ReturnType<typeof setup>>;

async function join(s: S, role: Exclude<Role, "owner">, branchIds: string[] = []) {
  const c = await Client.login(app);
  await s.owner.post<Invitation>(`${s.base}/invitations`, { phone: c.phone, role, branchIds });
  const me = await c.get<MeResponse>("/me");
  await c.post(`/me/invitations/${me.body.pendingInvitations[0]!.id}/accept`);
  return c;
}

const product = async (s: S, over: Record<string, unknown> = {}) => {
  const r = await s.owner.post<ProductDetail>(`${s.base}/products`, {
    name: "Claw hammer",
    categoryId: hardwareId,
    ...over,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};
const move = (
  c: Client,
  s: S,
  productId: string,
  kind: string,
  quantity: number,
  over: Record<string, unknown> = {},
) => c.post(`${s.stock}/movements`, { productId, kind, quantity, eventId: randomUUID(), ...over });
const ok = async (
  c: Client,
  s: S,
  productId: string,
  kind: string,
  quantity: number,
  over: Record<string, unknown> = {},
) => {
  const r = await move(c, s, productId, kind, quantity, over);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const line = async (s: S, productId: string) =>
  (await s.owner.get<StockPage>(`${s.stock}?limit=100`)).body.items.find((l) => l.productId === productId)!;
const summary = async (s: S) => (await s.owner.get<StockSummary>(`${s.stock}/summary`)).body;

describe("recording stock", () => {
  it("opening, receipt and sale add up, and the history says who and why", async () => {
    const s = await setup();
    const p = await product(s);
    await ok(s.owner, s, p.id, "opening", 20, { note: "first count" });
    await ok(s.owner, s, p.id, "receipt", 10);
    const afterSale = await ok(s.owner, s, p.id, "sale", 4);
    expect(afterSale.line).toMatchObject({
      onHand: 26,
      sellable: 26,
      isLow: false,
      isOut: false,
      needsCheck: false,
    });
    expect(await line(s, p.id)).toMatchObject({ onHand: 26 });

    const h = (await s.owner.get<MovementPage>(`${s.stock}/movements?productId=${p.id}`)).body;
    expect(h.total).toBe(3);
    expect(h.items.map((m) => [m.reason, m.qtyDelta])).toEqual([
      ["sale", -4],
      ["receipt", 10],
      ["opening", 20],
    ]);
    expect(h.items[0]).toMatchObject({
      actorName: "Asha Verma",
      source: "manual",
      isReversal: false,
      isReversed: false,
    });
    expect(h.items[2]!.note).toBe("first count");
  });

  it("the same eventId is counted once, even if the form is sent twice", async () => {
    const s = await setup();
    const p = await product(s);
    const eventId = randomUUID();
    const a = await ok(s.owner, s, p.id, "receipt", 5, { eventId });
    const b = await ok(s.owner, s, p.id, "receipt", 5, { eventId });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.movementId).toBe(a.movementId);
    expect((await line(s, p.id)).onHand).toBe(5);
  });

  it("selling more than you have is allowed, and flags the product for a check", async () => {
    const s = await setup();
    const p = await product(s);
    await ok(s.owner, s, p.id, "receipt", 2);
    const r = await ok(s.owner, s, p.id, "sale", 5);
    expect(r.line).toMatchObject({ onHand: -3, needsCheck: true, isOut: true });
    expect(await summary(s)).toMatchObject({ needsCheck: 1, out: 1 });
    const flagged = (await s.owner.get<StockPage>(`${s.stock}?filter=check`)).body;
    expect(flagged.items.map((l) => l.productId)).toEqual([p.id]);
    // a count fixes it
    const fixed = await ok(s.owner, s, p.id, "adjustment", 8, { direction: "in", note: "recount" });
    expect(fixed.line).toMatchObject({ onHand: 5, needsCheck: false });
  });

  it("whole-unit products refuse fractions; measured ones accept them", async () => {
    const s = await setup();
    const pcs = await product(s);
    const kg = await product(s, { name: "Nails", unit: "kg" });
    const bad = await move(s.owner, s, pcs.id, "receipt", 2.5);
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("QTY_NOT_INTEGRAL");
    expect((await ok(s.owner, s, kg.id, "receipt", 2.5)).line.onHand).toBe(2.5);
  });

  it("validates the request", async () => {
    const s = await setup();
    const p = await product(s);
    for (const bad of [
      { quantity: 0 },
      { quantity: -3 },
      { quantity: 1.0005 },
      { kind: "teleport" },
      { eventId: "not-a-uuid" },
      { kind: "adjustment", direction: "in" }, // no reason given
      { kind: "adjustment", note: "recount" }, // no direction
    ]) {
      const r = await move(s.owner, s, p.id, "receipt", 1, bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.code).toBe("VALIDATION_FAILED");
    }
    expect((await move(s.owner, s, randomUUID(), "receipt", 1)).status).toBe(404);
  });

  it("opening stock can only be set once", async () => {
    const s = await setup();
    const p = await product(s);
    await ok(s.owner, s, p.id, "opening", 10);
    const again = await move(s.owner, s, p.id, "opening", 12);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("OPENING_ALREADY_SET");
    // ...even if the first entry was an ordinary receipt
    const q = await product(s, { name: "Saw" });
    await ok(s.owner, s, q.id, "receipt", 1);
    expect((await move(s.owner, s, q.id, "opening", 5)).body.code).toBe("OPENING_ALREADY_SET");
  });

  it("unusually large amounts need a second confirmation", async () => {
    const s = await setup();
    const p = await product(s);
    for (const q of [5, 6, 4]) await ok(s.owner, s, p.id, "receipt", q);
    const big = await move(s.owner, s, p.id, "receipt", 500);
    expect(big.status).toBe(422);
    expect(big.body.code).toBe("CONFIRM_REQUIRED");
    expect((await line(s, p.id)).onHand).toBe(15);
    expect((await ok(s.owner, s, p.id, "receipt", 500, { confirmLarge: true })).line.onHand).toBe(515);
  });

  it("refuses dates in the future and more than 30 days back, accepts yesterday", async () => {
    const s = await setup();
    const p = await product(s);
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();
    const future = await move(s.owner, s, p.id, "receipt", 1, { occurredAt: at(3_600_000) });
    expect(future.status).toBe(400);
    expect(future.body.code).toBe("DATE_OUT_OF_RANGE");
    const old = await move(s.owner, s, p.id, "receipt", 1, { occurredAt: at(-31 * 86_400_000) });
    expect(old.body.code).toBe("DATE_OUT_OF_RANGE");
    expect((await move(s.owner, s, p.id, "receipt", 1, { occurredAt: at(-86_400_000) })).status).toBe(200);
  });

  it("a switched-off product cannot receive stock", async () => {
    const s = await setup();
    const p = await product(s);
    await s.owner.patch(`${s.base}/products/${p.id}`, { status: "inactive" });
    const r = await move(s.owner, s, p.id, "receipt", 1);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("PRODUCT_INACTIVE");
  });

  it("returns can go to the unsellable pile, which is not counted as sellable", async () => {
    const s = await setup();
    const p = await product(s);
    await ok(s.owner, s, p.id, "receipt", 10);
    const r = await ok(s.owner, s, p.id, "customer_return", 2, { returnToUnsellable: true });
    expect(r.line).toMatchObject({ onHand: 10, unsellable: 2, sellable: 8 });
    expect((await ok(s.owner, s, p.id, "damage", 3)).line).toMatchObject({ onHand: 7, sellable: 5 });
  });

  it("balances always match the ledger", async () => {
    const s = await setup();
    const p = await product(s);
    await ok(s.owner, s, p.id, "opening", 9);
    await ok(s.owner, s, p.id, "sale", 12);
    await ok(s.owner, s, p.id, "customer_return", 1, { returnToUnsellable: true });
    const drift = await admin.query("select * from v_balance_drift where org_id = $1", [s.org.id]);
    expect(drift.rows).toEqual([]);
  });
});

describe("low stock and out of stock", () => {
  it("uses the product level, a branch level when set, and ignores products never stocked", async () => {
    const s = await setup();
    const p = await product(s, { lowStockThreshold: 5 });
    const untouched = await product(s, { name: "Never stocked", lowStockThreshold: 5 });
    await ok(s.owner, s, p.id, "receipt", 10);
    expect(await summary(s)).toMatchObject({ products: 2, low: 0, out: 0 });

    const r = await ok(s.owner, s, p.id, "sale", 6);
    expect(r.line).toMatchObject({ onHand: 4, threshold: 5, isLow: true, isOut: false });
    expect(await summary(s)).toMatchObject({ low: 1, out: 0 });
    expect(await line(s, untouched.id)).toMatchObject({ isLow: false, isOut: false, onHand: 0 });

    // a branch-specific level
    const custom = await s.owner.put<StockLine>(`${s.stock}/threshold`, { productId: p.id, threshold: 2 });
    expect(custom.body).toMatchObject({ threshold: 2, thresholdIsCustom: true, isLow: false });
    const back = await s.owner.put<StockLine>(`${s.stock}/threshold`, { productId: p.id, threshold: null });
    expect(back.body).toMatchObject({ threshold: 5, thresholdIsCustom: false, isLow: true });

    await ok(s.owner, s, p.id, "sale", 4);
    expect(await summary(s)).toMatchObject({ low: 0, out: 1 });
    const low = (await s.owner.get<StockPage>(`${s.stock}?filter=out`)).body;
    expect(low.items.map((l) => l.productId)).toEqual([p.id]);
  });

  it("searches by name and code, and paginates with problem products first", async () => {
    const s = await setup();
    const a = await product(s, { name: "Alpha drill", barcode: "5550000000001" });
    const b = await product(s, { name: "Beta saw" });
    await ok(s.owner, s, b.id, "sale", 1); // negative: floats to the top
    const all = (await s.owner.get<StockPage>(`${s.stock}`)).body;
    expect(all.items.map((l) => l.name)).toEqual(["Beta saw", "Alpha drill"]);
    expect(all.items[1]!.code).toBe("5550000000001");
    const byCode = (await s.owner.get<StockPage>(`${s.stock}?q=555000`)).body;
    expect(byCode.items.map((l) => l.productId)).toEqual([a.id]);
    const page = (await s.owner.get<StockPage>(`${s.stock}?limit=1&offset=1`)).body;
    expect(page).toMatchObject({ total: 2 });
    expect(page.items).toHaveLength(1);
  });

  it("products that are not counted are marked in or out of stock instead", async () => {
    const s = await setup();
    const p = await product(s, { name: "Loose screws", trackingMode: "status_only" });
    const counted = await product(s, { name: "Counted" });
    const rejected = await move(s.owner, s, p.id, "receipt", 5);
    expect(rejected.status).toBe(400);
    expect(
      (await s.owner.put(`${s.stock}/status`, { productId: counted.id, status: "in_stock" })).status,
    ).toBe(400);

    // a not-counted product nobody has marked yet is listed as "not set", not an error
    const fresh = (await s.owner.get<StockPage>(`${s.stock}`)).body.items.find((l) => l.productId === p.id)!;
    expect(fresh).toMatchObject({ statusOverride: null, isOut: false, isLow: false, needsCheck: false });
    expect(await summary(s)).toMatchObject({ out: 0 });
    const out = await s.owner.put<StockLine>(`${s.stock}/status`, {
      productId: p.id,
      status: "out_of_stock",
    });
    expect(out.body).toMatchObject({ statusOverride: "out_of_stock", isOut: true });
    const back = await s.owner.put<StockLine>(`${s.stock}/status`, { productId: p.id, status: "in_stock" });
    expect(back.body).toMatchObject({ statusOverride: "in_stock", isOut: false });
    expect((await s.owner.put(`${s.stock}/status`, { productId: p.id, status: "maybe" })).status).toBe(400);
  });
});

describe("undoing an entry", () => {
  it("adds the opposite entry once, and never twice", async () => {
    const s = await setup();
    const p = await product(s);
    await ok(s.owner, s, p.id, "receipt", 10);
    const sale = await ok(s.owner, s, p.id, "sale", 3);
    const undo = await s.owner.post<MovementResult>(`${s.stock}/movements/${sale.movementId}/reverse`, {
      eventId: randomUUID(),
      note: "wrong item",
    });
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(undo.body.line.onHand).toBe(10);

    const h = (await s.owner.get<MovementPage>(`${s.stock}/movements?productId=${p.id}`)).body.items;
    expect(h[0]).toMatchObject({ reason: "reversal", qtyDelta: 3, isReversal: true, note: "wrong item" });
    expect(h.find((m) => m.id === sale.movementId)).toMatchObject({ isReversed: true });

    const twice = await s.owner.post(`${s.stock}/movements/${sale.movementId}/reverse`, {
      eventId: randomUUID(),
    });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe("ALREADY_REVERSED");
    const ofReversal = await s.owner.post(`${s.stock}/movements/${undo.body.movementId}/reverse`, {
      eventId: randomUUID(),
    });
    expect(ofReversal.body.code).toBe("ALREADY_REVERSED");
    expect((await line(s, p.id)).onHand).toBe(10);
  });

  it("an unknown entry, or one from another branch, is 404", async () => {
    const s = await setup();
    const other = (await s.owner.post<Branch>(`${s.base}/branches`, validBranch({ name: "Other" }))).body;
    const p = await product(s);
    const m = await ok(s.owner, s, p.id, "receipt", 1);
    expect(
      (await s.owner.post(`${s.stock}/movements/${randomUUID()}/reverse`, { eventId: randomUUID() })).status,
    ).toBe(404);
    const wrongBranch = await s.owner.post(
      `${s.base}/branches/${other.id}/stock/movements/${m.movementId}/reverse`,
      { eventId: randomUUID() },
    );
    expect(wrongBranch.status).toBe(404);
  });
});

describe("what shoppers see", () => {
  it("follows the stock as in, limited or out, and never carries a number", async () => {
    const s = await setup();
    await admin.query("update branch set is_published = true where id = $1", [s.branch.id]);
    const p = await product(s, { lowStockThreshold: 3 });
    await s.owner.put(`${s.base}/products/${p.id}/listings/${s.branch.id}`, { isPublished: true });
    const status = async () =>
      (
        await admin.query("select * from public_listing where branch_id = $1 and product_id = $2", [
          s.branch.id,
          p.id,
        ])
      ).rows[0];

    expect((await status()).base_status).toBe("unknown");
    await ok(s.owner, s, p.id, "receipt", 10);
    expect((await status()).base_status).toBe("in");
    await ok(s.owner, s, p.id, "sale", 8);
    expect((await status()).base_status).toBe("limited");
    await ok(s.owner, s, p.id, "sale", 2);
    expect((await status()).base_status).toBe("out");
    await ok(s.owner, s, p.id, "sale", 1); // negative: "check with shop"
    const row = await status();
    expect(row.discrepancy).toBe(true);
    expect(Object.keys(row).filter((k) => /on_hand|qty|quantity|stock_count/.test(k))).toEqual([]);
    const label = await admin.query("select availability_label($1,$2,$3,$4,$5) as l", [
      row.base_status,
      row.last_verified_at,
      row.ttl_seconds,
      row.discrepancy,
      row.branch_synced_at,
    ]);
    expect(label.rows[0].l).toBe("check_with_shop");
  });
});

describe("who can do what", () => {
  it("follows the role matrix", async () => {
    const s = await setup();
    const p = await product(s);
    await ok(s.owner, s, p.id, "receipt", 10);
    const keeper = await join(s, "inventory_operator");
    const seller = await join(s, "sales_operator");
    const auditor = await join(s, "auditor");

    // inventory operator can do everything stock-related
    expect((await move(keeper, s, p.id, "receipt", 1)).status).toBe(200);
    expect((await move(keeper, s, p.id, "sale", 1)).status).toBe(200);
    expect((await keeper.put(`${s.stock}/threshold`, { productId: p.id, threshold: 3 })).status).toBe(200);

    // sales operator: sells and takes returns, nothing else
    expect((await move(seller, s, p.id, "sale", 1)).status).toBe(200);
    expect((await move(seller, s, p.id, "customer_return", 1)).status).toBe(200);
    const denied = await move(seller, s, p.id, "receipt", 1);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("PERMISSION_DENIED");
    expect((await move(seller, s, p.id, "adjustment", 1, { direction: "in", note: "x" })).status).toBe(403);
    expect((await seller.put(`${s.stock}/threshold`, { productId: p.id, threshold: 1 })).status).toBe(403);
    const m = await ok(s.owner, s, p.id, "sale", 1);
    expect(
      (await seller.post(`${s.stock}/movements/${m.movementId}/reverse`, { eventId: randomUUID() })).status,
    ).toBe(403);

    // auditor can look, not touch
    expect((await auditor.get(`${s.stock}`)).status).toBe(200);
    expect((await auditor.get(`${s.stock}/movements`)).status).toBe(200);
    expect((await auditor.get(`${s.stock}/summary`)).status).toBe(200);
    expect((await move(auditor, s, p.id, "sale", 1)).status).toBe(403);
  });

  it("a branch-limited person cannot touch another branch", async () => {
    const s = await setup();
    const other = (await s.owner.post<Branch>(`${s.base}/branches`, validBranch({ name: "Other" }))).body;
    const p = await product(s);
    const keeper = await join(s, "inventory_operator", [s.branch.id]);
    expect((await move(keeper, s, p.id, "receipt", 1)).status).toBe(200);
    const elsewhere = await keeper.post(`${s.base}/branches/${other.id}/stock/movements`, {
      productId: p.id,
      kind: "receipt",
      quantity: 1,
      eventId: randomUUID(),
    });
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.body.code).toBe("BRANCH_OUT_OF_SCOPE");
    expect((await keeper.get(`${s.base}/branches/${other.id}/stock`)).status).toBe(403);
  });

  it("another shop's branch and products are invisible: 404", async () => {
    const a = await setup();
    const b = await setup();
    const p = await product(a);
    expect((await b.owner.get(`${a.stock}`)).status).toBe(404);
    expect((await move(b.owner, a, p.id, "receipt", 1)).status).toBe(404);
    // own branch but someone else's product
    const r = await b.owner.post(`${b.stock}/movements`, {
      productId: p.id,
      kind: "receipt",
      quantity: 1,
      eventId: randomUUID(),
    });
    expect(r.status).toBe(404);
    expect((await b.owner.get<StockPage>(`${b.stock}`)).body.total).toBe(0);
  });

  it("a read-only organisation can look but not record", async () => {
    const s = await setup();
    const p = await product(s);
    await ok(s.owner, s, p.id, "receipt", 5);
    await admin.query("update organization set status = 'read_only' where id = $1", [s.org.id]);
    expect((await s.owner.get(`${s.stock}`)).status).toBe(200);
    expect((await move(s.owner, s, p.id, "sale", 1)).status).toBe(403);
  });
});
