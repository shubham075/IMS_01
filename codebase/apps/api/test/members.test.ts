import type { Branch, Invitation, Member, MeResponse, Org, Role } from "@idea01/schemas";
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

async function setup() {
  const owner = await Client.login(app);
  const org = await createOrg(owner);
  const base = `/merchant/orgs/${org.id}`;
  const b1 = (await owner.post<Branch>(`${base}/branches`, validBranch({ name: "North shop" }))).body;
  const b2 = (await owner.post<Branch>(`${base}/branches`, validBranch({ name: "South shop" }))).body;
  return { owner, org, base, b1, b2 };
}
type S = Awaited<ReturnType<typeof setup>>;

/** Invites a fresh person (inviter defaults to the owner), has them accept, and returns their client. */
async function join(s: S, role: Exclude<Role, "owner">, branchIds: string[] = [], inviter: Client = s.owner) {
  const c = await Client.login(app);
  const inv = await inviter.post<Invitation>(`${s.base}/invitations`, { phone: c.phone, role, branchIds });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  const me = await c.get<MeResponse>("/me");
  const acc = await c.post(`/me/invitations/${me.body.pendingInvitations[0]!.id}/accept`);
  expect(acc.status, JSON.stringify(acc.body)).toBe(200);
  return c;
}
const members = async (s: S) => (await s.owner.get<Member[]>(`${s.base}/members`)).body;
const roleOf = async (s: S, c: Client) => (await members(s)).find((m) => m.userId === c.userId)!;

describe("invitations", () => {
  it("an invited person sees the invitation after OTP login, accepts it, and gets the role's permissions", async () => {
    const s = await setup();
    const c = await Client.login(app);
    const inv = await s.owner.post<Invitation>(`${s.base}/invitations`, {
      phone: c.phone!.replace("+91", "98 7"),
      role: "inventory_operator",
    });
    expect(inv.status).toBe(400); // not a valid number

    const ok = await s.owner.post<Invitation>(`${s.base}/invitations`, {
      phone: c.phone,
      role: "inventory_operator",
      branchIds: [s.b1.id],
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      phone: c.phone,
      role: "inventory_operator",
      status: "pending",
      branchIds: [s.b1.id],
    });

    const me = await c.get<MeResponse>("/me");
    expect(me.body.pendingInvitations).toHaveLength(1);
    expect(me.body.pendingInvitations[0]).toMatchObject({
      orgName: "Test Hardware",
      role: "inventory_operator",
    });
    expect(me.body.memberships).toEqual([]);

    const acc = await c.post(`/me/invitations/${me.body.pendingInvitations[0]!.id}/accept`);
    expect(acc.body).toMatchObject({ orgId: s.org.id, role: "inventory_operator", branchIds: [s.b1.id] });

    const after = await c.get<MeResponse>("/me");
    expect(after.body.pendingInvitations).toEqual([]);
    expect(after.body.memberships).toHaveLength(1);

    const org = await c.get<Org>(`/merchant/orgs/${s.org.id}`);
    expect(org.body.myRole).toBe("inventory_operator");
    expect(org.body.permissions).toContain("stock.write");
    expect(org.body.permissions).not.toContain("staff.manage");
  });

  it("is only visible to, and acceptable by, the invited number", async () => {
    const s = await setup();
    const invitee = await Client.login(app);
    const stranger = await Client.login(app);
    const inv = await s.owner.post<Invitation>(`${s.base}/invitations`, {
      phone: invitee.phone,
      role: "auditor",
    });
    expect((await stranger.get<MeResponse>("/me")).body.pendingInvitations).toEqual([]);
    expect((await stranger.post(`/me/invitations/${inv.body.id}/accept`)).status).toBe(404);
    expect((await stranger.post(`/me/invitations/${inv.body.id}/decline`)).status).toBe(404);
    expect((await stranger.get(`${s.base}/invitations`)).status).toBe(404);
    expect((await invitee.post(`/me/invitations/${inv.body.id}/accept`)).status).toBe(200);
  });

  it("can be declined, after which the owner may invite again", async () => {
    const s = await setup();
    const c = await Client.login(app);
    await s.owner.post(`${s.base}/invitations`, { phone: c.phone, role: "auditor" });
    const id = (await c.get<MeResponse>("/me")).body.pendingInvitations[0]!.id;
    expect((await c.post(`/me/invitations/${id}/decline`)).status).toBe(204);
    expect((await c.get<MeResponse>("/me")).body.pendingInvitations).toEqual([]);
    expect((await s.owner.post(`${s.base}/invitations`, { phone: c.phone, role: "auditor" })).status).toBe(
      201,
    );
  });

  it("cannot be accepted after it expires", async () => {
    const s = await setup();
    const c = await Client.login(app);
    const inv = await s.owner.post<Invitation>(`${s.base}/invitations`, { phone: c.phone, role: "auditor" });
    await admin.query("update invitation set expires_at = now() - interval '1 minute' where id = $1", [
      inv.body.id,
    ]);
    expect((await c.get<MeResponse>("/me")).body.pendingInvitations).toEqual([]);
    expect((await c.post(`/me/invitations/${inv.body.id}/accept`)).status).toBe(409);
    // an expired invitation does not block a fresh one
    expect((await s.owner.post(`${s.base}/invitations`, { phone: c.phone, role: "auditor" })).status).toBe(
      201,
    );
  });

  it("rejects duplicates: an open invitation, and someone already on the team", async () => {
    const s = await setup();
    const c = await Client.login(app);
    await s.owner.post(`${s.base}/invitations`, { phone: c.phone, role: "auditor" });
    const dup = await s.owner.post(`${s.base}/invitations`, { phone: c.phone, role: "auditor" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("DUPLICATE");
    const member = await join(s, "auditor");
    const again = await s.owner.post(`${s.base}/invitations`, { phone: member.phone, role: "org_admin" });
    expect(again.status).toBe(409);
  });

  it("cannot invite an owner, an unknown role, or branches that do not exist", async () => {
    const s = await setup();
    const phone = (await Client.login(app)).phone;
    expect((await s.owner.post(`${s.base}/invitations`, { phone, role: "owner" })).status).toBe(400);
    expect((await s.owner.post(`${s.base}/invitations`, { phone, role: "god" })).status).toBe(400);
    const other = await setup();
    const r = await s.owner.post(`${s.base}/invitations`, {
      phone,
      role: "auditor",
      branchIds: [other.b1.id],
    });
    expect(r.status).toBe(400);
    expect(r.body.errors[0].path).toBe("branchIds");
  });

  it("the owner can cancel an open invitation", async () => {
    const s = await setup();
    const c = await Client.login(app);
    const inv = await s.owner.post<Invitation>(`${s.base}/invitations`, { phone: c.phone, role: "auditor" });
    expect((await s.owner.get<Invitation[]>(`${s.base}/invitations`)).body).toHaveLength(1);
    expect((await s.owner.del(`${s.base}/invitations/${inv.body.id}`)).status).toBe(204);
    expect((await c.get<MeResponse>("/me")).body.pendingInvitations).toEqual([]);
    expect((await s.owner.del(`${s.base}/invitations/${inv.body.id}`)).status).toBe(404);
  });

  it("two simultaneous accepts make exactly one membership", async () => {
    const s = await setup();
    const c = await Client.login(app);
    const inv = await s.owner.post<Invitation>(`${s.base}/invitations`, { phone: c.phone, role: "auditor" });
    const results = await Promise.all([1, 2, 3].map(() => c.post(`/me/invitations/${inv.body.id}/accept`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 200).every((r) => [404, 409].includes(r.status))).toBe(true);
    expect(
      (
        await admin.query("select count(*)::int n from membership where org_id = $1 and user_id = $2", [
          s.org.id,
          c.userId,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it("the same Idempotency-Key does not send two invitations", async () => {
    const s = await setup();
    const c = await Client.login(app);
    const h = { "idempotency-key": `inv-${Date.now()}-1` };
    const a = await s.owner.post<Invitation>(`${s.base}/invitations`, { phone: c.phone, role: "auditor" }, h);
    const b = await s.owner.post<Invitation>(`${s.base}/invitations`, { phone: c.phone, role: "auditor" }, h);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
  });
});

describe("who may do what (permission matrix)", () => {
  it.each([
    ["inventory_operator", 403],
    ["sales_operator", 403],
    ["auditor", 403],
  ] as const)("a %s cannot see or manage the team", async (role, expected) => {
    const s = await setup();
    const c = await join(s, role);
    expect((await c.get(`${s.base}/members`)).status).toBe(expected);
    expect((await c.get(`${s.base}/invitations`)).status).toBe(expected);
    const inv = await c.post(`${s.base}/invitations`, {
      phone: (await Client.login(app)).phone,
      role: "auditor",
    });
    expect(inv.status).toBe(expected);
    expect(inv.body.code).toBe("PERMISSION_DENIED");
  });

  it.each(["inventory_operator", "sales_operator", "auditor", "branch_manager"] as const)(
    "a %s cannot create branches or change the organisation",
    async (role) => {
      const s = await setup();
      const c = await join(s, role, role === "branch_manager" ? [s.b1.id] : []);
      expect((await c.post(`${s.base}/branches`, validBranch())).status).toBe(403);
      expect((await c.patch(`${s.base}/branches/${s.b1.id}`, { name: "X1" })).status).toBe(403);
      expect((await c.patch(`${s.base}`, { name: "Hijack" })).status).toBe(403);
    },
  );

  it("an org admin can manage branches but not the organisation record", async () => {
    const s = await setup();
    const admin1 = await join(s, "org_admin");
    expect((await admin1.post(`${s.base}/branches`, validBranch({ name: "Admin branch" }))).status).toBe(201);
    expect((await admin1.patch(`${s.base}`, { name: "Renamed" })).status).toBe(403);
  });

  it("people only see the branches they are assigned to", async () => {
    const s = await setup();
    const op = await join(s, "inventory_operator", [s.b1.id]);
    const list = await op.get<Branch[]>(`${s.base}/branches`);
    expect(list.body.map((b) => b.id)).toEqual([s.b1.id]);
    expect((await op.get(`${s.base}/branches/${s.b1.id}`)).status).toBe(200);
    const out = await op.get(`${s.base}/branches/${s.b2.id}`);
    expect(out.status).toBe(403);
    expect(out.body.code).toBe("BRANCH_OUT_OF_SCOPE");
  });

  it("someone with no branch limit sees every branch", async () => {
    const s = await setup();
    const aud = await join(s, "auditor");
    expect((await aud.get<Branch[]>(`${s.base}/branches`)).body).toHaveLength(2);
  });
});

describe("privilege escalation is blocked", () => {
  it("an org admin cannot create another admin or an owner, but can create lower roles", async () => {
    const s = await setup();
    const adm = await join(s, "org_admin");
    const phone = () => Client.login(app).then((c) => c.phone);
    const a = await adm.post(`${s.base}/invitations`, { phone: await phone(), role: "org_admin" });
    expect(a.status).toBe(403);
    expect(a.body.code).toBe("PERMISSION_DENIED");
    expect((await adm.post(`${s.base}/invitations`, { phone: await phone(), role: "owner" })).status).toBe(
      400,
    );
    expect(
      (
        await adm.post(`${s.base}/invitations`, {
          phone: await phone(),
          role: "branch_manager",
          branchIds: [s.b1.id],
        })
      ).status,
    ).toBe(201);
  });

  it("a branch manager can only hand out access within their own branches", async () => {
    const s = await setup();
    const mgr = await join(s, "branch_manager", [s.b1.id]);
    const phone = async () => (await Client.login(app)).phone;
    expect(
      (
        await mgr.post(`${s.base}/invitations`, {
          phone: await phone(),
          role: "branch_manager",
          branchIds: [s.b1.id],
        })
      ).status,
    ).toBe(403);
    const other = await mgr.post(`${s.base}/invitations`, {
      phone: await phone(),
      role: "inventory_operator",
      branchIds: [s.b2.id],
    });
    expect(other.status).toBe(403);
    expect(other.body.code).toBe("BRANCH_OUT_OF_SCOPE");
    const none = await mgr.post(`${s.base}/invitations`, {
      phone: await phone(),
      role: "inventory_operator",
      branchIds: [],
    });
    expect(none.body.code).toBe("BRANCH_OUT_OF_SCOPE"); // "no branches" would mean ALL branches
    expect(
      (
        await mgr.post(`${s.base}/invitations`, {
          phone: await phone(),
          role: "inventory_operator",
          branchIds: [s.b1.id],
        })
      ).status,
    ).toBe(201);
  });

  it("an owner can never be changed or removed through the team endpoints", async () => {
    const s = await setup();
    const adm = await join(s, "org_admin");
    const ownerRow = (await members(s)).find((m) => m.role === "owner")!;
    expect((await adm.patch(`${s.base}/members/${ownerRow.membershipId}`, { role: "auditor" })).status).toBe(
      403,
    );
    expect((await adm.del(`${s.base}/members/${ownerRow.membershipId}`)).status).toBe(403);
    expect(
      (await s.owner.patch(`${s.base}/members/${ownerRow.membershipId}`, { role: "auditor" })).status,
    ).toBe(403);
    expect((await s.owner.del(`${s.base}/members/${ownerRow.membershipId}`)).status).toBe(403);
  });

  it("nobody can change or remove themselves", async () => {
    const s = await setup();
    const adm = await join(s, "org_admin");
    const me = await roleOf(s, adm);
    expect((await adm.patch(`${s.base}/members/${me.membershipId}`, { role: "auditor" })).status).toBe(403);
    expect((await adm.del(`${s.base}/members/${me.membershipId}`)).status).toBe(403);
  });

  it("cannot promote someone to your own level or above", async () => {
    const s = await setup();
    const adm = await join(s, "org_admin");
    const op = await join(s, "inventory_operator");
    const row = await roleOf(s, op);
    expect((await adm.patch(`${s.base}/members/${row.membershipId}`, { role: "org_admin" })).status).toBe(
      403,
    );
    expect(
      (
        await adm.patch(`${s.base}/members/${row.membershipId}`, {
          role: "branch_manager",
          branchIds: [s.b1.id],
        })
      ).status,
    ).toBe(200);
  });

  it("a team member cannot cancel an invitation for a role at or above their own", async () => {
    const s = await setup();
    const mgr = await join(s, "branch_manager", [s.b1.id]);
    const c = await Client.login(app);
    const inv = await s.owner.post<Invitation>(`${s.base}/invitations`, {
      phone: c.phone,
      role: "org_admin",
    });
    expect((await mgr.del(`${s.base}/invitations/${inv.body.id}`)).status).toBe(403);
  });
});

describe("changing and removing team members", () => {
  it("changes role and branches, and audits it", async () => {
    const s = await setup();
    const op = await join(s, "inventory_operator", [s.b1.id]);
    const row = await roleOf(s, op);
    const r = await s.owner.patch<Member>(`${s.base}/members/${row.membershipId}`, {
      role: "sales_operator",
      branchIds: [s.b2.id],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ role: "sales_operator", branchIds: [s.b2.id] });
    expect((await op.get<Org>(`${s.base}`)).body.permissions).toEqual(["sale.record"]);
    const audit = await admin.query(
      "select action, meta from audit_event where org_id = $1 and target_id = $2",
      [s.org.id, row.membershipId],
    );
    expect(audit.rows[0]).toMatchObject({
      action: "role.changed",
      meta: { from: "inventory_operator", to: "sales_operator" },
    });
  });

  it("a suspended member is locked out on their next request and can be restored", async () => {
    const s = await setup();
    const op = await join(s, "inventory_operator");
    const row = await roleOf(s, op);
    await s.owner.patch(`${s.base}/members/${row.membershipId}`, { status: "suspended" });
    expect((await op.get(`${s.base}/branches`)).status).toBe(404);
    await s.owner.patch(`${s.base}/members/${row.membershipId}`, { status: "active" });
    expect((await op.get(`${s.base}/branches`)).status).toBe(200);
  });

  it("removal takes effect immediately and the person can be invited back", async () => {
    const s = await setup();
    const op = await join(s, "inventory_operator", [s.b1.id]);
    const row = await roleOf(s, op);
    expect((await s.owner.del(`${s.base}/members/${row.membershipId}`)).status).toBe(204);
    expect((await op.get(`${s.base}/branches`)).status).toBe(404);
    expect((await op.get<MeResponse>("/me")).body.memberships).toEqual([]);
    expect((await members(s)).some((m) => m.userId === op.userId)).toBe(false);
    expect(
      (
        await admin.query("select count(*)::int n from membership_branch where membership_id = $1", [
          row.membershipId,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect((await s.owner.del(`${s.base}/members/${row.membershipId}`)).status).toBe(404);

    const back = await s.owner.post<Invitation>(`${s.base}/invitations`, {
      phone: op.phone,
      role: "auditor",
    });
    expect(back.status).toBe(201);
    const id = (await op.get<MeResponse>("/me")).body.pendingInvitations[0]!.id;
    expect((await op.post(`/me/invitations/${id}/accept`)).status).toBe(200);
    expect((await roleOf(s, op)).role).toBe("auditor");
    const actions = (
      await admin.query(
        "select action from audit_event where org_id = $1 and action in ('staff.removed','invitation.accepted') order by at",
        [s.org.id],
      )
    ).rows.map((r) => r.action);
    expect(actions).toEqual(["invitation.accepted", "staff.removed", "invitation.accepted"]);
  });

  it("lists members with names, roles and branch scope", async () => {
    const s = await setup();
    await join(s, "inventory_operator", [s.b1.id]);
    const list = await members(s);
    expect(list).toHaveLength(2);
    expect(list.find((m) => m.role === "owner")!.branchIds).toEqual([]);
    expect(list.find((m) => m.role === "inventory_operator")!.branchIds).toEqual([s.b1.id]);
  });
});

describe("profile", () => {
  it("updates display name and language", async () => {
    const c = await Client.login(app);
    const r = await c.patch("/me", { displayName: "  Rajesh Sharma ", locale: "hi" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ displayName: "Rajesh Sharma", locale: "hi" });
    expect((await c.patch("/me", {})).status).toBe(400);
    expect((await c.patch("/me", { locale: "fr" })).status).toBe(400);
  });
});
