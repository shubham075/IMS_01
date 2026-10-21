import { randomUUID } from "node:crypto";
import type {
  Branch,
  Category,
  Invitation,
  MeResponse,
  ProductDetail,
  Role,
  StockPage,
  TransferDetail,
  TransferPage,
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
  const a = (await owner.post<Branch>(`${base}/branches`, validBranch({ name: "North" }))).body;
  const b = (await owner.post<Branch>(`${base}/branches`, validBranch({ name: "South" }))).body;
  return { owner, org, base, a, b };
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
const stockIn = async (s: S, branchId: string, productId: string, quantity: number) => {
  const r = await s.owner.post(`${s.base}/branches/${branchId}/stock/movements`, {
    productId,
    kind: "receipt",
    quantity,
    eventId: randomUUID(),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
};
const onHand = async (s: S, branchId: string, productId: string) =>
  (await s.owner.get<StockPage>(`${s.base}/branches/${branchId}/stock?limit=100`)).body.items.find(
    (l) => l.productId === productId,
  )!.onHand;
const drift = async (s: S) =>
  (await admin.query("select * from v_balance_drift where org_id = $1", [s.org.id])).rows;
const draft = async (
  s: S,
  productId: string,
  quantity: number,
  c: Client = s.owner,
  over: Record<string, unknown> = {},
) =>
  c.post(`${s.base}/transfers`, {
    fromBranchId: s.a.id,
    toBranchId: s.b.id,
    lines: [{ productId, quantity }],
    ...over,
  });
const act = (s: S, id: string, what: string, body: unknown = {}, c: Client = s.owner) =>
  c.post<TransferDetail>(`${s.base}/transfers/${id}/${what}`, body);

describe("a transfer from start to finish", () => {
  it("draft, send, receive: stock leaves one branch, is in transit, then arrives", async () => {
    const s = await setup();
    const p = await product(s);
    await stockIn(s, s.a.id, p.id, 10);
    const d = await draft(s, p.id, 4, s.owner, { note: "weekend sale" });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(d.body).toMatchObject({
      status: "draft",
      fromBranchName: "North",
      toBranchName: "South",
      note: "weekend sale",
      lineCount: 1,
    });
    expect(d.body.lines[0]).toMatchObject({
      name: "Hammer",
      qtySent: 4,
      qtyReceived: null,
      sourceOnHand: 10,
    });
    expect(await onHand(s, s.a.id, p.id)).toBe(10); // a draft moves nothing

    const sent = await act(s, d.body.id, "dispatch");
    expect(sent.body.status).toBe("dispatched");
    expect(sent.body.dispatchedAt).not.toBeNull();
    expect(await onHand(s, s.a.id, p.id)).toBe(6);
    expect(await onHand(s, s.b.id, p.id)).toBe(0); // in transit

    const got = await act(s, d.body.id, "receive");
    expect(got.body.status).toBe("received");
    expect(got.body.lines[0]!.qtyReceived).toBe(4);
    expect(await onHand(s, s.b.id, p.id)).toBe(4);
    expect(await onHand(s, s.a.id, p.id)).toBe(6);
    expect(await drift(s)).toEqual([]);
  });

  it("a shortage on arrival is booked as a loss at the sender", async () => {
    const s = await setup();
    const p = await product(s);
    await stockIn(s, s.a.id, p.id, 10);
    const d = (await draft(s, p.id, 5)).body;
    await act(s, d.id, "dispatch");
    const got = await act(s, d.id, "receive", { received: [{ productId: p.id, quantity: 3 }] });
    expect(got.body.lines[0]).toMatchObject({ qtySent: 5, qtyReceived: 3 });
    expect(await onHand(s, s.b.id, p.id)).toBe(3);
    expect(await onHand(s, s.a.id, p.id)).toBe(5); // 10 - 5 sent; 2 missing are written off, not returned
    const loss = await admin.query("select qty_delta from stock_movement where org_id=$1 and reason='loss'", [
      s.org.id,
    ]);
    expect(loss.rows.map((r) => Number(r.qty_delta))).toEqual([-2]);
    expect(await drift(s)).toEqual([]);
  });

  it("sending more than the branch has is allowed and flagged, like a sale", async () => {
    const s = await setup();
    const p = await product(s);
    await stockIn(s, s.a.id, p.id, 2);
    const d = (await draft(s, p.id, 5)).body;
    expect(d.lines[0]!.sourceOnHand).toBe(2); // the screen can warn
    await act(s, d.id, "dispatch");
    expect(await onHand(s, s.a.id, p.id)).toBe(-3);
    const line = (await s.owner.get<StockPage>(`${s.base}/branches/${s.a.id}/stock?filter=check`)).body.items;
    expect(line.map((l) => l.productId)).toEqual([p.id]);
  });

  it("a draft can be edited, then cancelled; a sent transfer cannot", async () => {
    const s = await setup();
    const p = await product(s);
    const q = await product(s, { name: "Saw" });
    await stockIn(s, s.a.id, p.id, 10);
    const d = (await draft(s, p.id, 1)).body;
    const edited = await s.owner.put<TransferDetail>(`${s.base}/transfers/${d.id}/lines`, {
      lines: [
        { productId: p.id, quantity: 2 },
        { productId: q.id, quantity: 3 },
      ],
    });
    expect(edited.body.lines.map((l) => [l.name, l.qtySent])).toEqual([
      ["Hammer", 2],
      ["Saw", 3],
    ]);
    const cancelled = await act(s, d.id, "cancel");
    expect(cancelled.body.status).toBe("cancelled");
    expect((await act(s, d.id, "cancel")).status).toBe(200); // repeating is harmless
    expect((await act(s, d.id, "dispatch")).status).toBe(409);
    expect(await onHand(s, s.a.id, p.id)).toBe(10);

    const e = (await draft(s, p.id, 1)).body;
    await act(s, e.id, "dispatch");
    expect((await act(s, e.id, "cancel")).status).toBe(409);
    expect(
      (await s.owner.put(`${s.base}/transfers/${e.id}/lines`, { lines: [{ productId: p.id, quantity: 1 }] }))
        .status,
    ).toBe(409);
  });

  it("sending and receiving twice moves stock once; receiving before sending is refused", async () => {
    const s = await setup();
    const p = await product(s);
    await stockIn(s, s.a.id, p.id, 10);
    const d = (await draft(s, p.id, 4)).body;
    const early = await act(s, d.id, "receive");
    expect(early.status).toBe(409);
    await act(s, d.id, "dispatch");
    expect((await act(s, d.id, "dispatch")).status).toBe(200);
    expect(await onHand(s, s.a.id, p.id)).toBe(6);
    await act(s, d.id, "receive");
    expect((await act(s, d.id, "receive")).status).toBe(200);
    expect(await onHand(s, s.b.id, p.id)).toBe(4);
    expect(await drift(s)).toEqual([]);
  });

  it("lists transfers with filters and pages", async () => {
    const s = await setup();
    const p = await product(s);
    await stockIn(s, s.a.id, p.id, 10);
    const one = (await draft(s, p.id, 1)).body;
    const two = (await draft(s, p.id, 1)).body;
    await act(s, two.id, "dispatch");
    const all = (await s.owner.get<TransferPage>(`${s.base}/transfers`)).body;
    expect(all.total).toBe(2);
    expect(all.items[0]!.id).toBe(two.id); // newest first
    expect(
      (await s.owner.get<TransferPage>(`${s.base}/transfers?status=draft`)).body.items.map((t) => t.id),
    ).toEqual([one.id]);
    expect((await s.owner.get<TransferPage>(`${s.base}/transfers?branchId=${s.b.id}`)).body.total).toBe(2);
    expect((await s.owner.get<TransferPage>(`${s.base}/transfers?limit=1&offset=1`)).body.items).toHaveLength(
      1,
    );
  });
});

describe("what is refused", () => {
  it("bad transfers are 400 with a clear reason", async () => {
    const s = await setup();
    const p = await product(s);
    const notCounted = await product(s, { name: "Loose", trackingMode: "status_only" });
    const off = await product(s, { name: "Off" });
    await s.owner.patch(`${s.base}/products/${off.id}`, { status: "inactive" });
    const cases: Array<[string, Record<string, unknown>]> = [
      ["same branch", { toBranchId: s.a.id }],
      ["no lines", { lines: [] }],
      [
        "duplicate product",
        {
          lines: [
            { productId: p.id, quantity: 1 },
            { productId: p.id, quantity: 2 },
          ],
        },
      ],
      ["zero quantity", { lines: [{ productId: p.id, quantity: 0 }] }],
      ["fraction of a piece", { lines: [{ productId: p.id, quantity: 1.5 }] }],
      ["huge quantity", { lines: [{ productId: p.id, quantity: 1e12 }] }],
      ["not counted product", { lines: [{ productId: notCounted.id, quantity: 1 }] }],
      ["switched-off product", { lines: [{ productId: off.id, quantity: 1 }] }],
      ["unknown product", { lines: [{ productId: randomUUID(), quantity: 1 }] }],
      ["101 lines", { lines: Array.from({ length: 101 }, () => ({ productId: randomUUID(), quantity: 1 })) }],
      ["control characters in note", { note: "a\u0000b" }],
      ["long note", { note: "x".repeat(500) }],
    ];
    for (const [name, over] of cases) {
      const r = await draft(s, p.id, 1, s.owner, over);
      expect(r.status, name).toBe(400);
    }
    expect((await s.owner.get<TransferPage>(`${s.base}/transfers`)).body.total).toBe(0);
  });

  it("another shop's branch or product cannot be used", async () => {
    const s = await setup();
    const other = await setup();
    const mine = await product(s);
    const theirs = await product(other);
    const wrongBranch = await draft(s, mine.id, 1, s.owner, { toBranchId: other.a.id });
    expect(wrongBranch.status).toBe(404);
    const wrongProduct = await draft(s, theirs.id, 1);
    expect(wrongProduct.status).toBe(400);
    const d = (await draft(s, mine.id, 1)).body;
    expect((await other.owner.get(`${other.base}/transfers/${d.id}`)).status).toBe(404);
    expect((await act(other, d.id, "dispatch", {}, other.owner)).status).toBe(404);
  });

  it("what arrived is checked: never more than was sent, only products in the transfer", async () => {
    const s = await setup();
    const p = await product(s);
    const kg = await product(s, { name: "Nails", unit: "kg" });
    await stockIn(s, s.a.id, p.id, 10);
    await stockIn(s, s.a.id, kg.id, 10);
    const d = (
      await s.owner.post<TransferDetail>(`${s.base}/transfers`, {
        fromBranchId: s.a.id,
        toBranchId: s.b.id,
        lines: [
          { productId: p.id, quantity: 5 },
          { productId: kg.id, quantity: 5 },
        ],
      })
    ).body;
    await act(s, d.id, "dispatch");
    for (const received of [
      [{ productId: p.id, quantity: 6 }], // more than sent: would create stock from nothing
      [{ productId: p.id, quantity: -1 }],
      [{ productId: p.id, quantity: 2.5 }], // pieces are whole
      [{ productId: randomUUID(), quantity: 1 }],
      [
        { productId: p.id, quantity: 1 },
        { productId: p.id, quantity: 2 },
      ],
      [{ productId: kg.id, quantity: 1.0001 }],
    ]) {
      const r = await act(s, d.id, "receive", { received });
      expect(r.status, JSON.stringify(received)).toBe(400);
    }
    expect(await onHand(s, s.b.id, p.id)).toBe(0);
    const ok = await act(s, d.id, "receive", { received: [{ productId: kg.id, quantity: 4.5 }] }); // pieces default to all arrived
    expect(ok.status).toBe(200);
    expect(await onHand(s, s.b.id, p.id)).toBe(5);
    expect(await onHand(s, s.b.id, kg.id)).toBe(4.5);
    expect(await drift(s)).toEqual([]);
  });

  it("a product switched off after drafting blocks sending, with its name in the message", async () => {
    const s = await setup();
    const p = await product(s);
    await stockIn(s, s.a.id, p.id, 5);
    const d = (await draft(s, p.id, 1)).body;
    await s.owner.patch(`${s.base}/products/${p.id}`, { status: "inactive" });
    const r = await act(s, d.id, "dispatch");
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain("Hammer");
    const left = await admin.query(
      "select on_hand from inventory_balance where branch_id = $1 and product_id = $2",
      [s.a.id, p.id],
    );
    expect(Number(left.rows[0].on_hand)).toBe(5);
  });
});

describe("who can transfer", () => {
  it("follows the role matrix", async () => {
    const s = await setup();
    const p = await product(s);
    await stockIn(s, s.a.id, p.id, 10);
    const keeper = await join(s, "inventory_operator");
    const seller = await join(s, "sales_operator");
    const auditor = await join(s, "auditor");
    expect((await draft(s, p.id, 1, keeper)).status).toBe(201);
    for (const c of [seller, auditor]) {
      const r = await draft(s, p.id, 1, c);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("PERMISSION_DENIED");
    }
    const d = (await draft(s, p.id, 1)).body;
    expect((await act(s, d.id, "dispatch", {}, seller)).status).toBe(403);
    expect((await auditor.get(`${s.base}/transfers/${d.id}`)).status).toBe(200); // looking is fine
    expect((await auditor.get<TransferPage>(`${s.base}/transfers`)).body.total).toBe(2);
  });

  it("branch limits: send from your branch, receive at yours, see only transfers that touch you", async () => {
    const s = await setup();
    const c = (await s.owner.post<Branch>(`${s.base}/branches`, validBranch({ name: "East" }))).body;
    const p = await product(s);
    await stockIn(s, s.a.id, p.id, 10);
    await stockIn(s, s.b.id, p.id, 10);
    const northKeeper = await join(s, "inventory_operator", [s.a.id]);
    const southKeeper = await join(s, "inventory_operator", [s.b.id]);
    const eastKeeper = await join(s, "inventory_operator", [c.id]);

    const d = await draft(s, p.id, 2, northKeeper);
    expect(d.status).toBe(201);
    // cannot start a transfer out of a branch they do not work at
    const wrong = await s.owner.post(`${s.base}/transfers`, {
      fromBranchId: s.b.id,
      toBranchId: s.a.id,
      lines: [{ productId: p.id, quantity: 1 }],
    });
    expect(wrong.status).toBe(201); // owner can
    const denied = await northKeeper.post(`${s.base}/transfers`, {
      fromBranchId: s.b.id,
      toBranchId: s.a.id,
      lines: [{ productId: p.id, quantity: 1 }],
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("BRANCH_OUT_OF_SCOPE");

    // the receiving end cannot send it, the sending end cannot receive it
    expect((await act(s, d.body.id, "dispatch", {}, southKeeper)).status).toBe(403);
    expect((await act(s, d.body.id, "dispatch", {}, northKeeper)).status).toBe(200);
    expect((await act(s, d.body.id, "receive", {}, northKeeper)).status).toBe(403);
    expect((await act(s, d.body.id, "receive", {}, southKeeper)).status).toBe(200);

    // a keeper at an unrelated branch cannot see it at all
    expect((await eastKeeper.get(`${s.base}/transfers/${d.body.id}`)).status).toBe(404);
    expect((await eastKeeper.get<TransferPage>(`${s.base}/transfers`)).body.total).toBe(0);
    expect((await southKeeper.get<TransferPage>(`${s.base}/transfers`)).body.total).toBe(2);
  });

  it("a read-only shop cannot start or send transfers", async () => {
    const s = await setup();
    const p = await product(s);
    await stockIn(s, s.a.id, p.id, 5);
    const d = (await draft(s, p.id, 1)).body;
    await admin.query("update organization set status = 'read_only' where id = $1", [s.org.id]);
    expect((await draft(s, p.id, 1)).status).toBe(403);
    expect((await act(s, d.id, "dispatch")).status).toBe(403);
    expect((await s.owner.get(`${s.base}/transfers/${d.id}`)).status).toBe(200);
  });
});

describe("breaking it", () => {
  it("five tabs sending the same transfer move the stock once", async () => {
    const s = await setup();
    const p = await product(s);
    await stockIn(s, s.a.id, p.id, 10);
    const d = (await draft(s, p.id, 4)).body;
    const rs = await Promise.all(Array.from({ length: 5 }, () => act(s, d.id, "dispatch")));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(await onHand(s, s.a.id, p.id)).toBe(6);
    const rr = await Promise.all(Array.from({ length: 5 }, () => act(s, d.id, "receive")));
    expect(rr.every((r) => r.status === 200)).toBe(true);
    expect(await onHand(s, s.b.id, p.id)).toBe(4);
    expect(await drift(s)).toEqual([]);
  });

  it("sending and cancelling at the same moment ends in one consistent state", async () => {
    const s = await setup();
    const p = await product(s);
    await stockIn(s, s.a.id, p.id, 10);
    const d = (await draft(s, p.id, 4)).body;
    const rs = await Promise.all([
      act(s, d.id, "dispatch"),
      act(s, d.id, "cancel"),
      act(s, d.id, "dispatch"),
      act(s, d.id, "cancel"),
    ]);
    expect(rs.every((r) => [200, 409].includes(r.status))).toBe(true);
    const now = (await s.owner.get<TransferDetail>(`${s.base}/transfers/${d.id}`)).body.status;
    const a = await onHand(s, s.a.id, p.id);
    expect(now === "dispatched" ? a === 6 : a === 10).toBe(true);
    expect(["dispatched", "cancelled"]).toContain(now);
    expect(await drift(s)).toEqual([]);
  });

  it("garbage ids and bodies never crash", async () => {
    const s = await setup();
    expect((await s.owner.get(`${s.base}/transfers/not-a-uuid`)).status).toBe(400);
    expect((await s.owner.get(`${s.base}/transfers/${randomUUID()}`)).status).toBe(404);
    for (const url of ["?status=weird", "?limit=-1", "?offset=abc", "?branchId=zzz"]) {
      expect((await s.owner.get(`${s.base}/transfers${url}`)).status, url).toBe(400);
    }
    for (const body of [{}, { fromBranchId: "x" }, "nope", []]) {
      const r = await s.owner.post(`${s.base}/transfers`, body);
      expect([400, 415], JSON.stringify(body)).toContain(r.status);
    }
  });
});
