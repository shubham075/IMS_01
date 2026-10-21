import { randomUUID } from "node:crypto";
import type { Branch, Category, Invitation, MeResponse, ProductDetail, Role } from "@idea01/schemas";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPool, Client, createOrg, createTestApp, validBranch } from "./helpers";

let app: NestFastifyApplication;
let admin: pg.Pool;
let hardwareId: string;
let pharmacyId: string;
beforeAll(async () => {
  app = await createTestApp();
  admin = adminPool();
  const c = await Client.login(app);
  const org = await createOrg(c);
  const cats = (await c.get<Category[]>(`/merchant/orgs/${org.id}/categories`)).body;
  hardwareId = cats.find((x) => x.slug === "hardware")!.id;
  pharmacyId = cats.find((x) => x.slug === "pharmacy")!.id;
});
afterAll(async () => {
  await app.close();
  await admin.end();
});

async function setup(branchOver: Record<string, unknown> = {}) {
  const owner = await Client.login(app);
  const org = await createOrg(owner);
  const base = `/merchant/orgs/${org.id}`;
  const branch = (await owner.post<Branch>(`${base}/branches`, validBranch(branchOver))).body;
  return { owner, org, base, branch, pub: `${base}/branches/${branch.id}/publication` };
}
type S = Awaited<ReturnType<typeof setup>>;

async function join(s: S, role: Exclude<Role, "owner">, branchIds: string[] = []) {
  const c = await Client.login(app);
  await s.owner.post<Invitation>(`${s.base}/invitations`, { phone: c.phone, role, branchIds });
  const me = await c.get<MeResponse>("/me");
  await c.post(`/me/invitations/${me.body.pendingInvitations[0]!.id}/accept`);
  return c;
}
const showProduct = async (s: S, name = "Claw hammer", categoryId = hardwareId, branchId = s.branch.id) => {
  const p = (await s.owner.post<ProductDetail>(`${s.base}/products`, { name, categoryId })).body;
  if (categoryId !== pharmacyId) {
    const r = await s.owner.put(`${s.base}/products/${p.id}/listings/${branchId}`, { isPublished: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
  return p;
};
const publicRows = async (branchId: string) =>
  (await admin.query("select product_name, branch_name from public_listing where branch_id = $1", [branchId]))
    .rows;
const branchNow = async (s: S, id = s.branch.id) =>
  (await s.owner.get<Branch>(`${s.base}/branches/${id}`)).body;

describe("going live", () => {
  it("is refused until the branch has a pin, hours and a product, and says what is missing", async () => {
    const s = await setup({ location: undefined, hours: undefined });
    const r = await s.owner.put(s.pub, { isPublished: true });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("BRANCH_NOT_READY");
    expect(r.body.errors.map((e: { path: string }) => e.path).sort()).toEqual([
      "hours",
      "location",
      "products",
    ]);
    expect((await branchNow(s)).isPublished).toBe(false);

    // each missing piece on its own
    const noProducts = await setup();
    const r2 = await noProducts.owner.put(noProducts.pub, { isPublished: true });
    expect(r2.body.errors.map((e: { path: string }) => e.path)).toEqual(["products"]);
  });

  it("publishes, shows the products, and records who did it", async () => {
    const s = await setup();
    const p = await showProduct(s);
    expect(await publicRows(s.branch.id)).toEqual([]); // product shown, branch not live yet
    expect((await branchNow(s)).liveProductCount).toBe(1);

    const r = await s.owner.put<Branch>(s.pub, { isPublished: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.isPublished).toBe(true);
    expect(await publicRows(s.branch.id)).toEqual([
      { product_name: "Claw hammer", branch_name: "Main shop" },
    ]);
    const audit = await admin.query(
      "select actor_user_id from audit_event where target_id = $1 and action = 'branch.published'",
      [s.branch.id],
    );
    expect(audit.rows).toEqual([{ actor_user_id: s.owner.userId }]);
    expect(p.id).toBeTruthy();

    // doing it twice is harmless and does not write a second audit entry
    expect((await s.owner.put(s.pub, { isPublished: true })).status).toBe(200);
    const again = await admin.query(
      "select count(*)::int as n from audit_event where target_id = $1 and action = 'branch.published'",
      [s.branch.id],
    );
    expect(again.rows[0].n).toBe(1);
  });

  it("hiding the branch removes every public row at once, and going live again brings them back", async () => {
    const s = await setup();
    await showProduct(s, "Hammer one");
    await showProduct(s, "Hammer two");
    await s.owner.put(s.pub, { isPublished: true });
    expect(await publicRows(s.branch.id)).toHaveLength(2);
    const off = await s.owner.put<Branch>(s.pub, { isPublished: false });
    expect(off.body.isPublished).toBe(false);
    expect(await publicRows(s.branch.id)).toEqual([]);
    expect(off.body.liveProductCount).toBe(2); // the product choices are kept
    await s.owner.put(s.pub, { isPublished: true });
    expect(await publicRows(s.branch.id)).toHaveLength(2);
  });

  it("editing a live branch updates what shoppers see, and its pin cannot be removed while live", async () => {
    const s = await setup();
    await showProduct(s);
    await s.owner.put(s.pub, { isPublished: true });
    await s.owner.patch(`${s.base}/branches/${s.branch.id}`, { name: "Renamed shop" });
    expect((await publicRows(s.branch.id))[0]!.branch_name).toBe("Renamed shop");

    const noPin = await s.owner.patch(`${s.base}/branches/${s.branch.id}`, { location: null });
    expect(noPin.status).toBe(422);
    expect(noPin.body.code).toBe("BRANCH_NOT_READY");
    expect((await branchNow(s)).location).not.toBeNull();

    await s.owner.put(s.pub, { isPublished: false });
    expect((await s.owner.patch(`${s.base}/branches/${s.branch.id}`, { location: null })).status).toBe(200);
  });

  it("a product that becomes restricted or is switched off stops counting as live", async () => {
    const s = await setup();
    const a = await showProduct(s, "Hammer");
    const b = await showProduct(s, "Saw");
    await s.owner.put(s.pub, { isPublished: true });
    expect((await branchNow(s)).liveProductCount).toBe(2);
    await s.owner.patch(`${s.base}/products/${a.id}`, { categoryId: pharmacyId });
    await s.owner.patch(`${s.base}/products/${b.id}`, { status: "inactive" });
    expect((await branchNow(s)).liveProductCount).toBe(0);
    expect(await publicRows(s.branch.id)).toEqual([]);
  });

  it("only one product in a medicines category is not enough to go live", async () => {
    const s = await setup();
    await showProduct(s, "Cough syrup", pharmacyId);
    const r = await s.owner.put(s.pub, { isPublished: true });
    expect(r.status).toBe(422);
  });
});

describe("who can go live", () => {
  it("follows the role matrix and branch limits", async () => {
    const s = await setup();
    const other = (await s.owner.post<Branch>(`${s.base}/branches`, validBranch({ name: "Other" }))).body;
    await showProduct(s);
    const keeper = await join(s, "inventory_operator");
    const seller = await join(s, "sales_operator");
    const auditor = await join(s, "auditor");
    const manager = await join(s, "branch_manager", [s.branch.id]);
    for (const c of [keeper, seller, auditor]) {
      const r = await c.put(s.pub, { isPublished: true });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("PERMISSION_DENIED");
    }
    const elsewhere = await manager.put(`${s.base}/branches/${other.id}/publication`, { isPublished: true });
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.body.code).toBe("BRANCH_OUT_OF_SCOPE");
    expect((await manager.put(s.pub, { isPublished: true })).status).toBe(200);
    expect((await branchNow(s)).isPublished).toBe(true);
  });

  it("strangers get 404 and read-only shops cannot change it", async () => {
    const a = await setup();
    const b = await setup();
    await showProduct(a);
    expect((await b.owner.put(a.pub, { isPublished: true })).status).toBe(404);
    expect(
      (await b.owner.put(`${b.base}/branches/${a.branch.id}/publication`, { isPublished: true })).status,
    ).toBe(404);
    await admin.query("update organization set status = 'read_only' where id = $1", [a.org.id]);
    expect((await a.owner.put(a.pub, { isPublished: true })).status).toBe(403);
  });
});

describe("breaking it", () => {
  it("bad bodies and ids are 400, never a crash", async () => {
    const s = await setup();
    for (const body of [{}, { isPublished: "yes" }, { isPublished: null }, "nope", []]) {
      const r = await s.owner.put(s.pub, body);
      expect([400, 415], JSON.stringify(body)).toContain(r.status);
    }
    expect(
      (await s.owner.put(`${s.base}/branches/not-a-uuid/publication`, { isPublished: true })).status,
    ).toBe(400);
    expect(
      (await s.owner.put(`${s.base}/branches/${randomUUID()}/publication`, { isPublished: true })).status,
    ).toBe(404);
  });

  it("ten people flipping it on and off at once end in a consistent state", async () => {
    const s = await setup();
    await showProduct(s);
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => s.owner.put(s.pub, { isPublished: i % 2 === 0 })),
    );
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const live = (await branchNow(s)).isPublished;
    const rows = await publicRows(s.branch.id);
    expect(rows.length).toBe(live ? 1 : 0);
  });

  it("the database refuses a live branch without a pin even if the app is bypassed", async () => {
    const s = await setup({ location: undefined });
    await expect(
      admin.query("update branch set is_published = true where id = $1", [s.branch.id]),
    ).rejects.toThrow();
  });
});
