import type { Branch, Org } from "@idea01/schemas";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminPool, Client, createOrg, createTestApp, validBranch } from "./helpers";

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

describe("organisations", () => {
  it("creates a shop: caller is owner, Free plan, default adjustment reasons, audit entry", async () => {
    const c = await Client.login(app);
    const r = await c.post<Org>("/merchant/orgs", {
      name: "  Sharma Hardware  ",
      category: "hardware",
      gstin: "29aaaaa0001a1z5",
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      name: "Sharma Hardware",
      gstin: "29AAAAA0001A1Z5",
      myRole: "owner",
      status: "active",
      contactPhone: c.phone,
    });
    expect(r.body.permissions).toContain("staff.manage");
    expect(r.body.permissions).toHaveLength(17);

    const sub = await admin.query("select plan_id, status from subscription where org_id = $1", [r.body.id]);
    expect(sub.rows[0]).toEqual({ plan_id: "free", status: "active" });
    expect(
      (await admin.query("select count(*)::int n from adjustment_reason where org_id = $1", [r.body.id]))
        .rows[0].n,
    ).toBe(5);
    expect(
      (
        await admin.query("select 1 from audit_event where org_id = $1 and action = 'org.created'", [
          r.body.id,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it.each([
    [{ name: "A", category: "hardware" }, "name"],
    [{ name: "Shop", category: "weapons" }, "category"],
    [{ name: "Shop", category: "hardware", gstin: "BADGSTIN" }, "gstin"],
    [{ name: "Shop", category: "hardware", contactPhone: "123" }, "contactPhone"],
  ])("rejects invalid input %j", async (body, field) => {
    const r = await (await Client.login(app)).post("/merchant/orgs", body);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION_FAILED");
    expect(r.body.errors.map((e: { path: string }) => e.path)).toContain(field);
  });

  it("lists only the caller's organisations", async () => {
    const a = await Client.login(app);
    const b = await Client.login(app);
    const orgA = await createOrg(a, "A shop");
    await createOrg(b, "B shop");
    const list = await a.get<Org[]>("/merchant/orgs");
    expect(list.status).toBe(200);
    expect(list.body.map((o) => o.id)).toEqual([orgA.id]);
  });

  it("shows another tenant's organisation as 404, never 403 (its existence is not confirmed)", async () => {
    const a = await Client.login(app);
    const b = await Client.login(app);
    const orgA = await createOrg(a);
    for (const [method, url] of [
      ["get", `/merchant/orgs/${orgA.id}`],
      ["get", `/merchant/orgs/${orgA.id}/branches`],
      ["get", `/merchant/orgs/${orgA.id}/members`],
      ["get", `/merchant/orgs/${orgA.id}/invitations`],
    ] as const) {
      const r = await b[method](url);
      expect(r.status, url).toBe(404);
      expect(r.body.code).toBe("NOT_FOUND");
    }
    const patch = await b.patch(`/merchant/orgs/${orgA.id}`, { name: "Hijacked" });
    expect(patch.status).toBe(404);
    expect((await a.get<Org>(`/merchant/orgs/${orgA.id}`)).body.name).toBe("Test Hardware");
  });

  it("returns 404 for a malformed or unknown organisation id", async () => {
    const c = await Client.login(app);
    expect((await c.get("/merchant/orgs/not-a-uuid")).status).toBe(404);
    expect((await c.get("/merchant/orgs/11111111-1111-4111-8111-111111111111")).status).toBe(404);
  });

  it("lets the owner update details, and audits it", async () => {
    const c = await Client.login(app);
    const org = await createOrg(c);
    const r = await c.patch<Org>(`/merchant/orgs/${org.id}`, {
      name: "Renamed",
      gstin: "29AAAAA0002A1Z5",
      legalName: "Renamed Traders",
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "Renamed", legalName: "Renamed Traders", gstin: "29AAAAA0002A1Z5" });
    expect(
      (await admin.query("select 1 from audit_event where org_id = $1 and action = 'org.updated'", [org.id]))
        .rowCount,
    ).toBe(1);
    expect((await c.patch(`/merchant/orgs/${org.id}`, {})).status).toBe(400);
  });

  it("replays the first response for the same Idempotency-Key and creates only one shop", async () => {
    const c = await Client.login(app);
    const h = { "idempotency-key": `key-${Date.now()}-a` };
    const body = { name: "Once Only", category: "hardware" };
    const first = await c.post<Org>("/merchant/orgs", body, h);
    const second = await c.post<Org>("/merchant/orgs", body, h);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect((await c.get<Org[]>("/merchant/orgs")).body).toHaveLength(1);
  });

  it("rejects the same Idempotency-Key with a different payload", async () => {
    const c = await Client.login(app);
    const h = { "idempotency-key": `key-${Date.now()}-b` };
    await c.post("/merchant/orgs", { name: "First", category: "hardware" }, h);
    const r = await c.post("/merchant/orgs", { name: "Second", category: "hardware" }, h);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("frees the key when the first attempt failed, so a corrected retry works", async () => {
    const c = await Client.login(app);
    const h = { "idempotency-key": `key-${Date.now()}-c` };
    expect((await c.post("/merchant/orgs", { name: "X", category: "hardware" }, h)).status).toBe(400);
    expect((await c.post("/merchant/orgs", { name: "Fixed name", category: "hardware" }, h)).status).toBe(
      201,
    );
  });

  it("keeps idempotency keys private per user", async () => {
    const a = await Client.login(app);
    const b = await Client.login(app);
    const h = { "idempotency-key": `key-${Date.now()}-d` };
    const ra = await a.post<Org>("/merchant/orgs", { name: "Shop A", category: "hardware" }, h);
    const rb = await b.post<Org>("/merchant/orgs", { name: "Shop B", category: "hardware" }, h);
    expect(rb.status).toBe(201);
    expect(rb.body.id).not.toBe(ra.body.id);
  });

  it("rejects a malformed Idempotency-Key", async () => {
    const r = await (await Client.login(app)).post(
      "/merchant/orgs",
      { name: "Shop", category: "hardware" },
      { "idempotency-key": "bad key!" },
    );
    expect(r.status).toBe(400);
  });

  it("a read-only organisation (lapsed subscription) can be read but not changed", async () => {
    const c = await Client.login(app);
    const org = await createOrg(c);
    await admin.query("update organization set status = 'read_only' where id = $1", [org.id]);
    expect((await c.get(`/merchant/orgs/${org.id}`)).status).toBe(200);
    const w = await c.post(`/merchant/orgs/${org.id}/branches`, validBranch());
    expect(w.status).toBe(403);
    expect(w.body.code).toBe("ENTITLEMENT_REQUIRED");
  });

  it("a suspended organisation is closed to everyone", async () => {
    const c = await Client.login(app);
    const org = await createOrg(c);
    await admin.query("update organization set status = 'suspended' where id = $1", [org.id]);
    const r = await c.get(`/merchant/orgs/${org.id}`);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("ACCOUNT_SUSPENDED");
  });
});

describe("branches", () => {
  async function setup() {
    const owner = await Client.login(app);
    const org = await createOrg(owner);
    return { owner, org, base: `/merchant/orgs/${org.id}/branches` };
  }

  it("creates, reads, lists and updates a branch (location round-trips through PostGIS)", async () => {
    const { owner, base } = await setup();
    const created = await owner.post<Branch>(
      base,
      validBranch({ phonePublic: "98765 43210", contactOptions: ["call", "whatsapp"], area: "Jayanagar" }),
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Main shop",
      pincode: "560011",
      hoursVerified: true,
      isPublished: false,
      phonePublic: "+919876543210",
      contactOptions: ["call", "whatsapp"],
    });
    expect(created.body.location!.lat).toBeCloseTo(12.925, 5);
    expect(created.body.location!.lng).toBeCloseTo(77.583, 5);
    expect(created.body.hours).toEqual({ mon: [["09:00", "21:00"]] });

    expect((await owner.get<Branch>(`${base}/${created.body.id}`)).body.id).toBe(created.body.id);
    expect((await owner.get<Branch[]>(base)).body).toHaveLength(1);

    const upd = await owner.patch<Branch>(`${base}/${created.body.id}`, {
      name: "Renamed",
      location: { lat: 13.0, lng: 77.6 },
      hours: { tue: [["10:00", "20:00"]] },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe("Renamed");
    expect(upd.body.location!.lat).toBeCloseTo(13.0, 5);
    expect(upd.body.hours).toEqual({ tue: [["10:00", "20:00"]] });
  });

  it("marks hours as unverified until the merchant supplies them", async () => {
    const { owner, base } = await setup();
    const b = await owner.post<Branch>(base, validBranch({ hours: undefined }));
    expect(b.body.hoursVerified).toBe(false);
    expect(b.body.hours).toEqual({});
  });

  it("clears the WhatsApp number when the option is removed", async () => {
    const { owner, base, org } = await setup();
    const b = await owner.post<Branch>(
      base,
      validBranch({ phonePublic: "9876543210", contactOptions: ["call", "whatsapp"] }),
    );
    expect(
      (await admin.query("select whatsapp_public from branch where id = $1", [b.body.id])).rows[0]
        .whatsapp_public,
    ).toBe("+919876543210");
    await owner.patch(`${base}/${b.body.id}`, { contactOptions: ["call"] });
    expect(
      (
        await admin.query("select whatsapp_public from branch where id = $1 and org_id = $2", [
          b.body.id,
          org.id,
        ])
      ).rows[0].whatsapp_public,
    ).toBeNull();
  });

  it.each([
    ["short pincode", { pincode: "560" }, "pincode"],
    ["pincode starting with 0", { pincode: "060011" }, "pincode"],
    ["blank address", { addressLine: " " }, "addressLine"],
    ["location outside India", { location: { lat: 51.5, lng: -0.12 } }, "location.lat"],
    ["closing before opening", { hours: { mon: [["21:00", "09:00"]] } }, "hours.mon"],
    [
      "overlapping slots",
      {
        hours: {
          mon: [
            ["09:00", "13:00"],
            ["12:00", "18:00"],
          ],
        },
      },
      "hours.mon",
    ],
    ["bad time format", { hours: { mon: [["9am", "9pm"]] } }, "hours.mon.0.0"],
    ["unknown weekday", { hours: { funday: [["09:00", "10:00"]] } }, "hours"],
  ])("rejects %s", async (_n, over, path) => {
    const { owner, base } = await setup();
    const r = await owner.post(base, validBranch(over));
    expect(r.status).toBe(400);
    expect(r.body.errors.map((e: { path: string }) => e.path).join("|")).toContain(path);
  });

  it("returns 404 for another organisation's branch id, even inside my own organisation's URL", async () => {
    const a = await setup();
    const b = await setup();
    const branchB = await b.owner.post<Branch>(b.base, validBranch());
    const r = await a.owner.get(`${a.base}/${branchB.body.id}`);
    expect(r.status).toBe(404);
    expect((await a.owner.patch(`${a.base}/${branchB.body.id}`, { name: "Stolen" })).status).toBe(404);
    expect((await b.owner.get<Branch>(`${b.base}/${branchB.body.id}`)).body.name).toBe("Main shop");
  });

  it("audits creation and update", async () => {
    const { owner, base, org } = await setup();
    const b = await owner.post<Branch>(base, validBranch());
    await owner.patch(`${base}/${b.body.id}`, { name: "Second name" });
    const actions = (
      await admin.query("select action from audit_event where org_id = $1 and target_id = $2 order by at", [
        org.id,
        b.body.id,
      ])
    ).rows.map((r) => r.action);
    expect(actions).toEqual(["branch.created", "branch.updated"]);
  });

  it("rejects malformed branch ids and empty updates", async () => {
    const { owner, base } = await setup();
    expect((await owner.get(`${base}/not-a-uuid`)).status).toBe(400);
    const b = await owner.post<Branch>(base, validBranch());
    expect((await owner.patch(`${base}/${b.body.id}`, {})).status).toBe(400);
  });
});
