import { randomUUID } from "node:crypto";
import type {
  Branch,
  CanonicalProduct,
  Category,
  Invitation,
  MeResponse,
  ProductDetail,
  ProductPage,
  Role,
} from "@idea01/schemas";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPool, Client, createOrg, createTestApp, validBranch } from "./helpers";

let app: NestFastifyApplication;
let admin: pg.Pool;
let hardware: Category;
let pharmacy: Category;
beforeAll(async () => {
  app = await createTestApp();
  admin = adminPool();
  const owner = await Client.login(app);
  const org = await createOrg(owner);
  const cats = (await owner.get<Category[]>(`/merchant/orgs/${org.id}/categories`)).body;
  hardware = cats.find((c) => c.slug === "hardware")!;
  pharmacy = cats.find((c) => c.slug === "pharmacy")!;
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
  return { owner, org, base, branch };
}
type S = Awaited<ReturnType<typeof setup>>;

async function join(s: S, role: Exclude<Role, "owner">, branchIds: string[] = []) {
  const c = await Client.login(app);
  await s.owner.post<Invitation>(`${s.base}/invitations`, { phone: c.phone, role, branchIds });
  const me = await c.get<MeResponse>("/me");
  await c.post(`/me/invitations/${me.body.pendingInvitations[0]!.id}/accept`);
  return c;
}

const hammer = (over: Record<string, unknown> = {}) => ({ name: "Claw hammer 500g", categoryId: hardware.id, ...over });
const create = async (s: S, over: Record<string, unknown> = {}) => {
  const r = await s.owner.post<ProductDetail>(`${s.base}/products`, hammer(over));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};
const show = (s: S, productId: string, over: Record<string, unknown> = {}) =>
  s.owner.put(`${s.base}/products/${productId}/listings/${s.branch.id}`, {
    isPublished: true,
    showPrice: true,
    ...over,
  });
const publicRow = async (branchId: string, productId: string) =>
  (await admin.query("select * from public_listing where branch_id = $1 and product_id = $2", [branchId, productId]))
    .rows[0];

describe("custom products", () => {
  it("creates a product with a short code, sensible defaults, and no cost for read-only people", async () => {
    const s = await setup();
    const p = await create(s, { pricePaise: 25000, costPaise: 18000, nameHi: "हथौड़ा" });
    expect(p).toMatchObject({ name: "Claw hammer 500g", unit: "pcs", allowFraction: false, status: "active", pricePaise: 25000 });
    expect(p.shortCode).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(p.costPaise).toBe(18000);
    expect(p.listings).toHaveLength(1);
    expect(p.listings[0]).toMatchObject({ isPublished: false, branchName: "Main shop" });

    const auditor = await join(s, "auditor");
    const seen = await auditor.get<ProductDetail>(`${s.base}/products/${p.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.costPaise).toBeNull();
  });

  it("measured units allow fractions", async () => {
    const s = await setup();
    expect((await create(s, { unit: "kg" })).allowFraction).toBe(true);
    expect((await create(s, { unit: "box" })).allowFraction).toBe(false);
  });

  it("rejects bad input with field messages", async () => {
    const s = await setup();
    for (const bad of [{ name: "A" }, { pricePaise: -1 }, { pricePaise: 12.5 }, { unit: "tonne" }, { barcode: "no" }, { categoryId: "x" }]) {
      const r = await s.owner.post(`${s.base}/products`, hammer(bad));
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.code).toBe("VALIDATION_FAILED");
    }
    const unknownCategory = await s.owner.post(`${s.base}/products`, hammer({ categoryId: randomUUID() }));
    expect(unknownCategory.status).toBe(400);
  });

  it("a barcode or product code can belong to only one product in a shop", async () => {
    const s = await setup();
    const a = await create(s, { barcode: "8901234567890", sku: "HAM-500" });
    expect(a.identifiers).toEqual(
      expect.arrayContaining([
        { kind: "barcode", value: "8901234567890" },
        { kind: "sku", value: "HAM-500" },
      ]),
    );
    expect(a.shortCode).toBeNull(); // a barcode is enough

    const dupBarcode = await s.owner.post(`${s.base}/products`, hammer({ name: "Other", barcode: "8901234567890" }));
    expect(dupBarcode.status).toBe(409);
    expect(dupBarcode.body).toMatchObject({ code: "DUPLICATE_IDENTIFIER", existing_id: a.id });
    const dupSku = await s.owner.post(`${s.base}/products`, hammer({ name: "Other", sku: "HAM-500" }));
    expect(dupSku.body.code).toBe("DUPLICATE_IDENTIFIER");

    // the same barcode in a different shop is fine (barcodes are unique per shop only)
    const other = await setup();
    const ok = await other.owner.post(`${other.base}/products`, hammer({ barcode: "8901234567890" }));
    expect(ok.status).toBe(201);
  });

  it("the same Idempotency-Key creates one product", async () => {
    const s = await setup();
    const key = { "idempotency-key": randomUUID() };
    const first = await s.owner.post<ProductDetail>(`${s.base}/products`, hammer(), key);
    const second = await s.owner.post<ProductDetail>(`${s.base}/products`, hammer(), key);
    expect(second.body.id).toBe(first.body.id);
    const list = await s.owner.get<ProductPage>(`${s.base}/products`);
    expect(list.body.total).toBe(1);
  });
});

describe("shared catalogue", () => {
  const seedCanonical = async (name: string, barcode: string | null = null, categoryId = hardware.id) =>
    (
      await admin.query("insert into canonical_product (name, brand, barcode, category_id) values ($1,'Taparia',$2,$3) returning id", [
        name,
        barcode,
        categoryId,
      ])
    ).rows[0].id as string;

  it("finds products by name, brand or barcode and shows which are already added", async () => {
    const s = await setup();
    const tag = `Zenith${randomUUID().slice(0, 6)}`;
    const id = await seedCanonical(`${tag} screwdriver set`, "8900000000011");
    const byName = await s.owner.get<CanonicalProduct[]>(`${s.base}/catalogue/search?q=${tag.toLowerCase()}`);
    expect(byName.body.map((c) => c.id)).toEqual([id]);
    expect(byName.body[0]!.alreadyAddedProductId).toBeNull();
    const byBarcode = await s.owner.get<CanonicalProduct[]>(`${s.base}/catalogue/search?q=8900000000011`);
    expect(byBarcode.body.map((c) => c.id)).toEqual([id]);

    const added = await s.owner.post<ProductDetail>(`${s.base}/products/from-catalogue`, { canonicalId: id, pricePaise: 49900 });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ name: `${tag} screwdriver set`, brand: "Taparia", canonicalId: id, pricePaise: 49900, categoryId: hardware.id });
    expect(added.body.identifiers).toEqual([{ kind: "barcode", value: "8900000000011" }]);

    const again = await s.owner.get<CanonicalProduct[]>(`${s.base}/catalogue/search?q=${tag.toLowerCase()}`);
    expect(again.body[0]!.alreadyAddedProductId).toBe(added.body.id);
    const dup = await s.owner.post(`${s.base}/products/from-catalogue`, { canonicalId: id });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: "DUPLICATE_IDENTIFIER", existing_id: added.body.id });
  });

  it("an empty search is rejected and an unknown catalogue product is 404", async () => {
    const s = await setup();
    expect((await s.owner.get(`${s.base}/catalogue/search?q=`)).status).toBe(400);
    expect((await s.owner.post(`${s.base}/products/from-catalogue`, { canonicalId: randomUUID() })).status).toBe(404);
  });
});

describe("listing and editing", () => {
  it("search matches names, brands and identifiers; filters by status; paginates", async () => {
    const s = await setup();
    const a = await create(s, { name: "Alpha drill", brand: "Bosch", barcode: "7770000000001" });
    await create(s, { name: "Beta saw" });
    const c = await create(s, { name: "Gamma file" });
    await s.owner.patch(`${s.base}/products/${c.id}`, { status: "inactive" });

    const names = async (qs: string) => (await s.owner.get<ProductPage>(`${s.base}/products${qs}`)).body.items.map((p) => p.name);
    expect(await names("")).toEqual(["Alpha drill", "Beta saw"]);
    expect(await names("?status=inactive")).toEqual(["Gamma file"]);
    expect(await names("?status=all")).toHaveLength(3);
    expect(await names("?q=bosch")).toEqual(["Alpha drill"]);
    expect(await names("?q=7770000")).toEqual(["Alpha drill"]);
    expect(await names("?q=100%25")).toEqual([]); // % is not a wildcard
    const page = await s.owner.get<ProductPage>(`${s.base}/products?limit=1&offset=1`);
    expect(page.body).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(page.body.items.map((p) => p.id)).not.toContain(a.id);
  });

  it("edits only what is sent, and an empty edit is rejected", async () => {
    const s = await setup();
    const p = await create(s, { unit: "kg", lowStockThreshold: 5, pricePaise: 1000 });
    const r = await s.owner.patch<ProductDetail>(`${s.base}/products/${p.id}`, { name: "Renamed" });
    expect(r.body).toMatchObject({ name: "Renamed", unit: "kg", lowStockThreshold: 5, pricePaise: 1000 });
    expect((await s.owner.patch(`${s.base}/products/${p.id}`, {})).status).toBe(400);
    const cleared = await s.owner.patch<ProductDetail>(`${s.base}/products/${p.id}`, { pricePaise: null, brand: null });
    expect(cleared.body.pricePaise).toBeNull();
  });

  it("replaces identifiers and blocks one already used by another product", async () => {
    const s = await setup();
    const a = await create(s, { barcode: "6660000000001" });
    const b = await create(s);
    const r = await s.owner.put<ProductDetail>(`${s.base}/products/${b.id}/identifiers`, {
      barcodes: ["6660000000002"],
      skus: ["B-1"],
      aliases: ["pankha", "table fan"],
    });
    expect(r.status).toBe(200);
    expect(r.body.identifiers).toHaveLength(4);
    expect(r.body.shortCode).toBe(b.shortCode); // the short code survives
    const clash = await s.owner.put(`${s.base}/products/${b.id}/identifiers`, { barcodes: ["6660000000001"] });
    expect(clash.body).toMatchObject({ code: "DUPLICATE_IDENTIFIER", existing_id: a.id });
    // keeping its own barcode is not a clash
    expect((await s.owner.put(`${s.base}/products/${a.id}/identifiers`, { barcodes: ["6660000000001"] })).status).toBe(200);
  });
});

describe("showing products to shoppers", () => {
  it("publishing creates a public row with status only, never quantity or cost", async () => {
    const s = await setup();
    const p = await create(s, { name: "Public hammer", pricePaise: 25000, costPaise: 9000, nameHi: "हथौड़ा" });
    expect(await publicRow(s.branch.id, p.id)).toBeUndefined();

    // the public row only exists once the branch itself is visible
    await admin.query("update branch set is_published = true where id = $1", [s.branch.id]);
    const r = await show(s, p.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.listings[0]).toMatchObject({ isPublished: true, showPrice: true });
    const row = await publicRow(s.branch.id, p.id);
    expect(row).toMatchObject({ product_name: "Public hammer", product_name_hi: "हथौड़ा", price_paise: "25000" });
    expect(Object.keys(row).filter((k) => /qty|quantity|on_hand|cost|supplier/i.test(k))).toEqual([]);

    // hide the price: the public row stops carrying it
    await show(s, p.id, { showPrice: false });
    expect((await publicRow(s.branch.id, p.id)).price_paise).toBeNull();

    // unpublish removes the row; deactivating hides it even when listed
    await show(s, p.id, { isPublished: false });
    expect(await publicRow(s.branch.id, p.id)).toBeUndefined();
    await show(s, p.id);
    expect(await publicRow(s.branch.id, p.id)).toBeDefined();
    await s.owner.patch(`${s.base}/products/${p.id}`, { status: "inactive" });
    expect(await publicRow(s.branch.id, p.id)).toBeUndefined();
    await s.owner.patch(`${s.base}/products/${p.id}`, { status: "active" });
    expect(await publicRow(s.branch.id, p.id)).toBeDefined();
  });

  it("renaming a published product updates what shoppers see", async () => {
    const s = await setup();
    await admin.query("update branch set is_published = true where id = $1", [s.branch.id]);
    const p = await create(s);
    await show(s, p.id);
    await s.owner.patch(`${s.base}/products/${p.id}`, { name: "Sturdy hammer" });
    expect((await publicRow(s.branch.id, p.id)).product_name).toBe("Sturdy hammer");
  });

  it("restricted categories can be stocked but never shown", async () => {
    const s = await setup();
    const p = await create(s, { name: "Cough syrup", categoryId: pharmacy.id });
    const r = await show(s, p.id);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("RESTRICTED_CATEGORY");
    // switching an already-listed product into a restricted category removes it from public view
    const q = await create(s, { name: "Tape" });
    await admin.query("update branch set is_published = true where id = $1", [s.branch.id]);
    await show(s, q.id);
    await s.owner.patch(`${s.base}/products/${q.id}`, { categoryId: pharmacy.id });
    expect(await publicRow(s.branch.id, q.id)).toBeUndefined();
  });

  it("needs a map pin and an active product", async () => {
    const s = await setup();
    const noPin = (await s.owner.post<Branch>(`${s.base}/branches`, validBranch({ name: "No pin", location: undefined }))).body;
    const p = await create(s);
    const r = await s.owner.put(`${s.base}/products/${p.id}/listings/${noPin.id}`, { isPublished: true });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("BRANCH_NOT_READY");
    await s.owner.patch(`${s.base}/products/${p.id}`, { status: "inactive" });
    expect((await show(s, p.id)).status).toBe(400);
    // hiding is always allowed
    expect((await show(s, p.id, { isPublished: false })).status).toBe(200);
  });
});

describe("who can do what", () => {
  it("follows the role matrix", async () => {
    const s = await setup();
    const p = await create(s);
    const keeper = await join(s, "inventory_operator");
    const seller = await join(s, "sales_operator");
    const auditor = await join(s, "auditor");
    const manager = await join(s, "branch_manager");

    // inventory operator: edits the catalogue, cannot publish
    expect((await keeper.post(`${s.base}/products`, hammer({ name: "From keeper" }))).status).toBe(201);
    expect((await keeper.patch(`${s.base}/products/${p.id}`, { name: "Keeper edit" })).status).toBe(200);
    expect((await show(s, p.id)).status).toBe(200);
    const denied = await keeper.put(`${s.base}/products/${p.id}/listings/${s.branch.id}`, { isPublished: false });
    expect(denied.status).toBe(403);

    // sales operator and auditor: read-only
    for (const c of [seller, auditor]) {
      expect((await c.get(`${s.base}/products`)).status).toBe(200);
      expect((await c.get(`${s.base}/catalogue/search?q=ham`)).status).toBe(200);
      expect((await c.post(`${s.base}/products`, hammer())).status).toBe(403);
      expect((await c.patch(`${s.base}/products/${p.id}`, { name: "X" })).status).toBe(403);
      expect((await c.put(`${s.base}/products/${p.id}/identifiers`, {})).status).toBe(403);
    }
    // manager can publish at their branch
    expect((await manager.put(`${s.base}/products/${p.id}/listings/${s.branch.id}`, { isPublished: false })).status).toBe(200);
  });

  it("a branch-limited manager cannot publish at another branch and sees only their branch", async () => {
    const s = await setup();
    const other = (await s.owner.post<Branch>(`${s.base}/branches`, validBranch({ name: "Other shop" }))).body;
    const p = await create(s);
    const mgr = await join(s, "branch_manager", [s.branch.id]);
    const r = await mgr.put(`${s.base}/products/${p.id}/listings/${other.id}`, { isPublished: false });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("BRANCH_OUT_OF_SCOPE");
    const seen = await mgr.get<ProductDetail>(`${s.base}/products/${p.id}`);
    expect(seen.body.listings.map((l) => l.branchId)).toEqual([s.branch.id]);
  });

  it("another shop's products are invisible: 404, never 403", async () => {
    const a = await setup();
    const b = await setup();
    const p = await create(a);
    const strangerRead = await b.owner.get(`${b.base}/products/${p.id}`);
    expect(strangerRead.status).toBe(404);
    expect((await b.owner.patch(`${b.base}/products/${p.id}`, { name: "Hijack" })).status).toBe(404);
    expect((await b.owner.put(`${b.base}/products/${p.id}/listings/${b.branch.id}`, { isPublished: false })).status).toBe(404);
    expect((await b.owner.get<ProductPage>(`${b.base}/products`)).body.total).toBe(0);
    // and a stranger cannot even address the other shop
    expect((await b.owner.get(`${a.base}/products`)).status).toBe(404);
  });

  it("a read-only organisation can browse but not change the catalogue", async () => {
    const s = await setup();
    await admin.query("update organization set status = 'read_only' where id = $1", [s.org.id]);
    expect((await s.owner.get(`${s.base}/products`)).status).toBe(200);
    expect((await s.owner.post(`${s.base}/products`, hammer())).status).toBe(403);
  });
});
