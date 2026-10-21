import { randomUUID } from "node:crypto";
import type {
  Branch,
  Category,
  ImportJob,
  ImportPage,
  ImportPreview,
  ImportRowPage,
  Invitation,
  MeResponse,
  ProductPage,
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

const GOOD = [
  "name,category,unit,price,barcode,stock",
  "Claw hammer,Hardware,pcs,₹250,8901000000011,10",
  "Nails,हार्डवेयर,kg,80.50,,2.5",
  "Tape,hardware,piece,40,,",
].join("\n");

const preview = (s: S, csv: string, over: Record<string, unknown> = {}, c: Client = s.owner) =>
  c.post(`${s.base}/imports/preview`, {
    branchId: s.branch.id,
    csv,
    fileName: "stock.csv",
    ...over,
  });
const ok = async (s: S, csv: string, over: Record<string, unknown> = {}): Promise<ImportPreview> => {
  const r = await preview(s, csv, over);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as ImportPreview;
};
const apply = (s: S, id: string, c: Client = s.owner) => c.post<ImportJob>(`${s.base}/imports/${id}/apply`);
const products = async (s: S, q = "") =>
  (await s.owner.get<ProductPage>(`${s.base}/products?status=all&limit=100${q}`)).body;
const drift = async (s: S) =>
  (await admin.query("select * from v_balance_drift where org_id = $1", [s.org.id])).rows;

describe("importing products with opening stock", () => {
  it("previews without changing anything, then applies exactly what was previewed", async () => {
    const s = await setup();
    const p = await ok(s, GOOD);
    expect(p.job).toMatchObject({
      status: "validated",
      kind: "opening_stock",
      totalRows: 3,
      okRows: 3,
      skippedRows: 0,
      errorRows: 0,
      fileName: "stock.csv",
    });
    expect(p.recognised.map((r) => r.field)).toEqual([
      "name",
      "category",
      "unit",
      "price",
      "barcode",
      "stock",
    ]);
    expect(p.rows.every((r) => r.status === "ok")).toBe(true);
    expect((await products(s)).total).toBe(0); // nothing yet

    const job = await apply(s, p.job.id);
    expect(job.status, JSON.stringify(job.body)).toBe(200);
    expect(job.body).toMatchObject({ status: "applied", appliedRows: 3 });
    const list = await products(s);
    expect(list.items.map((x) => x.name).sort()).toEqual(["Claw hammer", "Nails", "Tape"]);
    const hammer = list.items.find((x) => x.name === "Claw hammer")!;
    expect(hammer).toMatchObject({ pricePaise: 25000, unit: "pcs" });
    expect(hammer.identifiers).toEqual([{ kind: "barcode", value: "8901000000011" }]);
    const nails = list.items.find((x) => x.name === "Nails")!;
    expect(nails).toMatchObject({ unit: "kg", pricePaise: 8050, allowFraction: true });
    expect(nails.shortCode).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);

    const stock = (await s.owner.get<StockPage>(`${s.base}/branches/${s.branch.id}/stock`)).body.items;
    expect(Object.fromEntries(stock.map((l) => [l.name, l.onHand]))).toMatchObject({
      "Claw hammer": 10,
      Nails: 2.5,
      Tape: 0,
    });
    expect(await drift(s)).toEqual([]);
    const audit = await admin.query(
      "select 1 from audit_event where target_id = $1 and action = 'import.applied'",
      [p.job.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("applying twice, or five times at once, creates each product once", async () => {
    const s = await setup();
    const p = await ok(s, GOOD);
    const rs = await Promise.all(Array.from({ length: 5 }, () => apply(s, p.job.id)));
    expect(rs.every((r) => r.status === 200 && r.body.status === "applied")).toBe(true);
    expect((await products(s)).total).toBe(3);
    expect((await apply(s, p.job.id)).body.appliedRows).toBe(3);
    expect(await drift(s)).toEqual([]);
  });

  it("uploading the same file again skips everything and tells you which products exist", async () => {
    const s = await setup();
    const first = await ok(s, GOOD);
    await apply(s, first.job.id);
    const again = await ok(s, GOOD);
    expect(again.job).toMatchObject({ okRows: 0, skippedRows: 3, errorRows: 0 });
    expect(
      again.rows.every(
        (r) => r.status === "skipped" && r.errorCode === "ALREADY_EXISTS" && r.existingProductId,
      ),
    ).toBe(true);
    expect(again.rows.map((r) => r.field).sort()).toEqual(["barcode", "name", "name"]);
    const r = await apply(s, again.job.id);
    expect(r.status).toBe(400); // nothing to import
    expect((await products(s)).total).toBe(3);
  });

  it("works with Hindi headers, other columns are ignored, and a default category fills a missing column", async () => {
    const s = await setup();
    const csv = "नाम,कीमत,Colour\nहथौड़ा,₹100,red";
    const noCat = await preview(s, csv);
    expect(noCat.status).toBe(400);
    const p = await ok(s, csv, { defaultCategoryId: hardwareId });
    expect(p.ignored).toEqual(["Colour"]);
    expect(p.job.kind).toBe("products");
    await apply(s, p.job.id);
    expect((await products(s)).items[0]).toMatchObject({
      name: "हथौड़ा",
      pricePaise: 10000,
      categoryId: hardwareId,
    });
  });

  it("accepts Excel-style files: semicolons, byte-order mark, CRLF", async () => {
    const s = await setup();
    const p = await ok(s, "﻿name;category;price\r\nFile;Hardware;99\r\n");
    expect(p.job.okRows).toBe(1);
  });
});

describe("what is wrong with a row is said clearly", () => {
  it("each problem has its own code, field and value, and good rows still go through", async () => {
    const s = await setup();
    const csv = [
      "name,category,unit,price,barcode,sku,stock",
      "Good,Hardware,pcs,10,,,1",
      ",Hardware,pcs,10,,,",
      "No category,Gadgets,pcs,10,,,",
      "Bad unit,Hardware,furlong,10,,,",
      "Bad price,Hardware,pcs,ten,,,",
      "Negative price,Hardware,pcs,-5,,,",
      "Bad stock,Hardware,pcs,10,,,-3",
      "Fraction of pieces,Hardware,pcs,10,,,2.5",
      "Short barcode,Hardware,pcs,10,12,,",
      "Bad code,Hardware,pcs,10,,a b c,",
      `${"x".repeat(200)},Hardware,pcs,10,,,`,
    ].join("\n");
    const p = await ok(s, csv);
    expect(p.job).toMatchObject({ totalRows: 11, okRows: 1, errorRows: 10 });
    const rows = (await s.owner.get<ImportRowPage>(`${s.base}/imports/${p.job.id}/rows?limit=200`)).body
      .items;
    const byName = (n: string | RegExp) =>
      rows.find((r) => (typeof n === "string" ? r.name === n : r.name && n.test(r.name)))!;
    expect(rows.find((r) => r.rowNo === 3)).toMatchObject({
      status: "error",
      errorCode: "MISSING_NAME",
      field: "name",
    });
    expect(byName("No category")).toMatchObject({
      errorCode: "UNKNOWN_CATEGORY",
      field: "category",
      detail: "Gadgets",
    });
    expect(byName("Bad unit")).toMatchObject({ errorCode: "BAD_UNIT", field: "unit", detail: "furlong" });
    expect(byName("Bad price")).toMatchObject({ errorCode: "BAD_PRICE", field: "price", detail: "ten" });
    expect(byName("Negative price")).toMatchObject({ errorCode: "BAD_PRICE" });
    expect(byName("Bad stock")).toMatchObject({ errorCode: "BAD_STOCK", field: "stock" });
    expect(byName("Fraction of pieces")).toMatchObject({ errorCode: "BAD_STOCK" });
    expect(byName("Short barcode")).toMatchObject({ errorCode: "BAD_BARCODE", field: "barcode" });
    expect(byName("Bad code")).toMatchObject({ errorCode: "BAD_SKU", field: "sku" });
    expect(byName(/^x{200}$/)).toMatchObject({ errorCode: "TOO_LONG" });
    // the preview shows problems first
    expect(p.rows.slice(0, 10).every((r) => r.status === "error")).toBe(true);
    expect((await products(s)).total).toBe(0);

    await apply(s, p.job.id);
    expect((await products(s)).items.map((x) => x.name)).toEqual(["Good"]);
  });

  it("the same barcode or product twice in a file keeps the first and flags the rest", async () => {
    const s = await setup();
    const csv = [
      "name,category,barcode,sku",
      "First,Hardware,7770001112223,",
      "Second,Hardware,7770001112223,",
      "Third,Hardware,,S-1",
      "Fourth,Hardware,,S-1",
      "Same name,Hardware,,",
      "same NAME,Hardware,,",
    ].join("\n");
    const p = await ok(s, csv);
    const rows = (await s.owner.get<ImportRowPage>(`${s.base}/imports/${p.job.id}/rows?limit=200`)).body
      .items;
    expect(rows.map((r) => [r.rowNo, r.status, r.errorCode, r.detail])).toEqual([
      [2, "ok", null, null],
      [3, "error", "DUPLICATE_IN_FILE", "2"],
      [4, "ok", null, null],
      [5, "error", "DUPLICATE_IN_FILE", "4"],
      [6, "ok", null, null],
      [7, "error", "DUPLICATE_IN_FILE", "6"],
    ]);
  });

  it("spreadsheet formulas are refused, not stored or evaluated", async () => {
    const s = await setup();
    const csv = [
      "name,category",
      '"=HYPERLINK(""http://evil"",""x"")",Hardware',
      "+1+1,Hardware",
      "@SUM(A1),Hardware",
      "Fine,Hardware",
    ].join("\n");
    const p = await ok(s, csv);
    expect(p.job).toMatchObject({ okRows: 1, errorRows: 3 });
    expect(p.rows.filter((r) => r.errorCode === "FORMULA")).toHaveLength(3);
    await apply(s, p.job.id);
    expect((await products(s)).items.map((x) => x.name)).toEqual(["Fine"]);
  });

  it("whole-unit products refuse fractional stock; measured units take it", async () => {
    const s = await setup();
    const p = await ok(s, "name,category,unit,stock\nNuts,Hardware,box,1.5\nRope,Hardware,m,1.5");
    expect(p.rows.map((r) => [r.name, r.status])).toEqual([
      ["Nuts", "error"],
      ["Rope", "ok"],
    ]);
  });
});

describe("files that should not be accepted", () => {
  it("empty, binary, broken, huge and wrong-shaped files are 400 with a reason, never a crash", async () => {
    const s = await setup();
    const rows = (n: number) =>
      `name,category\n${Array.from({ length: n }, (_, i) => `P${i},Hardware`).join("\n")}`;
    const cases: Array<[string, string, Record<string, unknown>?]> = [
      ["empty", ""],
      ["spaces only", "  \n \n"],
      ["header only", "name,category"],
      ["no name column", "product_code,category\n1,Hardware"],
      ["binary", "PK\u0003\u0004\u0000\u0000\u0001\u0002"],
      ["unclosed quote", 'name,category\n"Hammer,Hardware'],
      ["too many rows", rows(2001)],
      ["huge file", `name,category\n${"A".repeat(950_000)}`],
      ["huge cell", `name,category\n${"A".repeat(600)},Hardware`],
      ["too many columns", `${Array.from({ length: 60 }, (_, i) => `c${i}`).join(",")}\nx`],
      ["unknown branch", "name,category\nA,Hardware", { branchId: randomUUID() }],
      ["bad branch id", "name,category\nA,Hardware", { branchId: "nope" }],
      ["bad default category", "name\nA", { defaultCategoryId: randomUUID() }],
    ];
    for (const [name, csv, over] of cases) {
      const r = await preview(s, csv, over);
      expect([400, 404, 413], `${name}: ${JSON.stringify(r.body).slice(0, 200)}`).toContain(r.status);
    }
    expect((await s.owner.get<ImportPage>(`${s.base}/imports`)).body.total).toBe(0);
    const edge = await preview(s, rows(2000));
    expect(edge.status).toBe(200);
  });
});

describe("taking an import back", () => {
  it("reverses the opening stock and switches the products off, once", async () => {
    const s = await setup();
    const p = await ok(s, GOOD);
    await apply(s, p.job.id);
    const undo = await s.owner.post<ImportJob>(`${s.base}/imports/${p.job.id}/undo`);
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(undo.body).toMatchObject({ status: "undone" });
    expect((await products(s)).items.every((x) => x.status === "inactive")).toBe(true);
    const stock = await admin.query(
      "select coalesce(sum(on_hand),0)::float as n from inventory_balance where org_id = $1",
      [s.org.id],
    );
    expect(stock.rows[0].n).toBe(0);
    expect(await drift(s)).toEqual([]);
    expect((await s.owner.post(`${s.base}/imports/${p.job.id}/undo`)).status).toBe(200); // repeat is harmless
    expect((await apply(s, p.job.id)).status).toBe(409);
    // the barcode is free again for a corrected file
    const again = await ok(s, GOOD);
    expect(again.job.skippedRows).toBeGreaterThan(0); // inactive products still hold their codes (history is kept)
  });

  it("is refused once stock has been recorded on those products", async () => {
    const s = await setup();
    const p = await ok(s, GOOD);
    await apply(s, p.job.id);
    const hammer = (await products(s)).items.find((x) => x.name === "Claw hammer")!;
    await s.owner.post(`${s.base}/branches/${s.branch.id}/stock/movements`, {
      productId: hammer.id,
      kind: "sale",
      quantity: 1,
      eventId: randomUUID(),
    });
    const undo = await s.owner.post(`${s.base}/imports/${p.job.id}/undo`);
    expect(undo.status).toBe(409);
    expect((await products(s)).items.every((x) => x.status === "active")).toBe(true);
    const job = (await s.owner.get<ImportJob>(`${s.base}/imports/${p.job.id}`)).body;
    expect(job.status).toBe("applied");
  });

  it("only an applied import can be undone", async () => {
    const s = await setup();
    const p = await ok(s, GOOD);
    expect((await s.owner.post(`${s.base}/imports/${p.job.id}/undo`)).status).toBe(409);
  });
});

describe("the shop changes between preview and apply", () => {
  it("a barcode taken in the meantime makes that row skip instead of failing the import", async () => {
    const s = await setup();
    const p = await ok(s, GOOD);
    await s.owner.post(`${s.base}/products`, {
      name: "Added by hand",
      categoryId: hardwareId,
      barcode: "8901000000011",
    });
    const job = await apply(s, p.job.id);
    expect(job.status, JSON.stringify(job.body)).toBe(200);
    expect(job.body.appliedRows).toBe(2);
    const rows = (await s.owner.get<ImportRowPage>(`${s.base}/imports/${p.job.id}/rows?status=skipped`)).body
      .items;
    expect(rows.map((r) => r.errorCode)).toEqual(["ALREADY_EXISTS"]);
    expect(await drift(s)).toEqual([]);
  });
});

describe("who can import", () => {
  it("follows the role matrix and branch limits", async () => {
    const s = await setup();
    const other = (await s.owner.post<Branch>(`${s.base}/branches`, validBranch({ name: "Other" }))).body;
    const keeper = await join(s, "inventory_operator");
    const seller = await join(s, "sales_operator");
    const auditor = await join(s, "auditor");
    const manager = await join(s, "branch_manager", [s.branch.id]);
    for (const c of [keeper, seller, auditor]) {
      const r = await preview(s, GOOD, {}, c);
      expect(r.status).toBe(403);
      expect((await c.get(`${s.base}/imports`)).status).toBe(403);
    }
    const wrong = await preview(s, GOOD, { branchId: other.id }, manager);
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("BRANCH_OUT_OF_SCOPE");
    const mine = await preview(s, GOOD, {}, manager);
    expect(mine.status).toBe(200);
    expect((await apply(s, mine.body.job.id, manager)).status).toBe(200);
  });

  it("strangers get 404; a read-only shop cannot change anything", async () => {
    const a = await setup();
    const b = await setup();
    const p = await ok(a, GOOD);
    expect((await b.owner.get(`${b.base}/imports/${p.job.id}`)).status).toBe(404);
    expect((await apply(b, p.job.id, b.owner)).status).toBe(404);
    expect((await b.owner.get<ImportRowPage>(`${b.base}/imports/${p.job.id}/rows`)).status).toBe(404);
    expect(
      (await b.owner.post(`${b.base}/imports/preview`, { branchId: a.branch.id, csv: GOOD })).status,
    ).toBe(404);
    await admin.query("update organization set status = 'read_only' where id = $1", [a.org.id]);
    expect((await preview(a, GOOD)).status).toBe(403);
    expect((await apply(a, p.job.id)).status).toBe(403);
  });

  it("lists past imports, newest first, and pages the rows", async () => {
    const s = await setup();
    const one = await ok(s, GOOD);
    const two = await ok(s, "name,category\nOnly,Hardware");
    const list = (await s.owner.get<ImportPage>(`${s.base}/imports`)).body;
    expect(list.items.map((j) => j.id)).toEqual([two.job.id, one.job.id]);
    expect(list.items[0]!.branchName).toBe("Main shop");
    const rows = (await s.owner.get<ImportRowPage>(`${s.base}/imports/${one.job.id}/rows?limit=2&offset=1`))
      .body;
    expect(rows).toMatchObject({ total: 3, limit: 2 });
    expect(rows.items.map((r) => r.rowNo)).toEqual([3, 4]);
    for (const url of ["?status=weird", "?limit=0", "?offset=-1"]) {
      expect((await s.owner.get(`${s.base}/imports/${one.job.id}/rows${url}`)).status, url).toBe(400);
    }
    expect((await s.owner.get(`${s.base}/imports/not-a-uuid`)).status).toBe(400);
    expect((await s.owner.get(`${s.base}/imports/${randomUUID()}`)).status).toBe(404);
  });
});
