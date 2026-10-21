// Invariant tests for the database schema. Run against a freshly migrated DB:  pnpm --filter @idea01/db reset && pnpm --filter @idea01/db test
// Fixtures are created as the admin (superuser); assertions run as idea01_app, so row-level security is really tested.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const ADMIN = process.env.DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/idea01_test";
const APP = process.env.DATABASE_URL ?? "postgres://idea01_app:idea01_app_dev@localhost:5432/idea01_test";
const admin = new pg.Pool({ connectionString: ADMIN, max: 2 });
const app = new pg.Pool({ connectionString: APP, max: 25 });
before(async () => {
  if (/prod/i.test(ADMIN)) throw new Error("refusing to run tests against a production-looking database");
  await admin.query("DELETE FROM public_listing");   // derived data; clears leftovers so reruns stay deterministic
});
after(async () => { await admin.end(); await app.end(); });

const q = (sql, p) => admin.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];

/** Run fn inside a transaction with the tenant context set (what the API does per request). */
async function asOrg(org, user, fn) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [org ?? "", user ?? ""]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
/** Assert that fn throws with the given API error code (HINT) — transaction is rolled back. */
const rejects = (promise, hint) => assert.rejects(promise, (e) => { assert.equal(e.hint, hint, e.message); return true; });

const DAY = 86400e3;
let seq = 0;
async function makeOrg(name = "Shop") {
  const user = await one("INSERT INTO app_user (kind, phone_e164) VALUES ('merchant', $1) RETURNING id", ["+9199" + String(Date.now() + ++seq).slice(-8)]);
  const org = await one("INSERT INTO organization (name, created_by) VALUES ($1, $2) RETURNING id", [name + " " + seq, user.id]);
  await q("INSERT INTO membership (org_id, user_id, role_code) VALUES ($1,$2,'owner')", [org.id, user.id]);
  const branch = await one(`INSERT INTO branch (org_id, name, geo, is_published, hours_verified, pincode)
      VALUES ($1, 'Main', ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography, true, true, '560001') RETURNING id`, [org.id]);
  return { org: org.id, user: user.id, branch: branch.id };
}
async function makeProduct(o, name, extra = {}) {
  const cat = await one("SELECT id FROM category WHERE slug = $1", [extra.category ?? "hardware"]);
  return (await one(`INSERT INTO product (org_id, name, name_hi, category_id, allow_fraction, tracking_mode, low_stock_threshold, price_paise, price_updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now()) RETURNING id`,
    [o.org, name, extra.hi ?? null, cat.id, extra.fraction ?? false, extra.mode ?? "quantity", extra.thr ?? 0, extra.price ?? null])).id;
}
let ev = 0;
const move = (c, o, product, qty, reason = "receipt", opts = {}) =>
  c.query("SELECT * FROM apply_stock_movement($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [o.org, opts.branch ?? o.branch, product, qty, opts.bucket ?? "on_hand", reason, opts.source ?? "native",
     opts.event ?? `t-${Date.now()}-${++ev}`, opts.at ?? new Date()]).then((r) => r.rows[0]);
const balance = (c, o, product, branch) => c.query("SELECT * FROM inventory_balance WHERE branch_id = $1 AND product_id = $2", [branch ?? o.branch, product]).then((r) => r.rows[0]);

test("tenant isolation: org B cannot see or write org A rows (RLS)", async () => {
  const A = await makeOrg("A"), B = await makeOrg("B");
  const pa = await makeProduct(A, "A-only item");
  const seenByB = await asOrg(B.org, B.user, (c) => c.query("SELECT id FROM product WHERE id = $1", [pa]));
  assert.equal(seenByB.rowCount, 0);
  await assert.rejects(asOrg(B.org, B.user, (c) => c.query("INSERT INTO product (org_id, name) VALUES ($1,'x')", [A.org])), /row-level security/);
  const noCtx = await asOrg(null, null, (c) => c.query("SELECT id FROM product"));
  assert.equal(noCtx.rowCount, 0, "no org context must see nothing");
  const branches = await asOrg(B.org, B.user, (c) => c.query("SELECT org_id FROM branch"));
  assert.ok(branches.rows.every((r) => r.org_id === B.org));
});

test("user can list their own orgs but not others (membership policy)", async () => {
  const A = await makeOrg("A2"), B = await makeOrg("B2");
  const mine = await asOrg(null, A.user, (c) => c.query("SELECT id FROM organization"));
  assert.deepEqual(mine.rows.map((r) => r.id), [A.org]);
  assert.ok(!mine.rows.some((r) => r.id === B.org));
});

test("stock event is idempotent: same event id applied once (S1)", async () => {
  const o = await makeOrg(), p = await makeProduct(o, "Bulb");
  const r = await asOrg(o.org, o.user, async (c) => {
    const a = await move(c, o, p, 10, "opening", { event: "dup-1" });
    const b = await move(c, o, p, 10, "opening", { event: "dup-1" });
    return { a, b, bal: await balance(c, o, p) };
  });
  assert.equal(r.a.o_duplicate, false);
  assert.equal(r.b.o_duplicate, true);
  assert.equal(r.a.o_movement_id, r.b.o_movement_id);
  assert.equal(Number(r.bal.on_hand), 10);
});

test("negative stock is allowed and flagged (D-01, S3), then clears when corrected", async () => {
  const o = await makeOrg(), p = await makeProduct(o, "Switch");
  await asOrg(o.org, o.user, async (c) => {
    const s = await move(c, o, p, -3, "sale");
    assert.equal(Number(s.o_on_hand), -3);
    assert.equal(s.o_discrepancy, true);
    const f = await move(c, o, p, 5, "receipt");
    assert.equal(Number(f.o_on_hand), 2);
    assert.equal(f.o_discrepancy, false);
  });
});

test("date rules: future rejected, old back-dating needs a flag (S5, S6)", async () => {
  const o = await makeOrg(), p = await makeProduct(o, "Nails");
  await rejects(asOrg(o.org, o.user, (c) => move(c, o, p, 1, "receipt", { at: new Date(Date.now() + 3600e3) })), "DATE_OUT_OF_RANGE");
  await rejects(asOrg(o.org, o.user, (c) => move(c, o, p, 1, "receipt", { at: new Date(Date.now() - 40 * DAY) })), "DATE_OUT_OF_RANGE");
  await asOrg(o.org, o.user, (c) => c.query(
    "SELECT * FROM apply_stock_movement($1,$2,$3,1,'on_hand','receipt','native','old-ok',$4,NULL,NULL,NULL,NULL,NULL,NULL,NULL,true)",
    [o.org, o.branch, p, new Date(Date.now() - 40 * DAY)]));
});

test("validation: zero qty, fractions on whole-unit products, inactive products (S4, S7)", async () => {
  const o = await makeOrg(), whole = await makeProduct(o, "Pen"), kg = await makeProduct(o, "Rice", { fraction: true });
  await rejects(asOrg(o.org, o.user, (c) => move(c, o, whole, 0)), "VALIDATION_FAILED");
  await rejects(asOrg(o.org, o.user, (c) => move(c, o, whole, 1.5)), "QTY_NOT_INTEGRAL");
  await asOrg(o.org, o.user, (c) => move(c, o, kg, 1.5));
  await q("UPDATE product SET status = 'inactive' WHERE id = $1", [whole]);
  await rejects(asOrg(o.org, o.user, (c) => move(c, o, whole, 1, "receipt")), "PRODUCT_INACTIVE");
  await asOrg(o.org, o.user, (c) => move(c, o, whole, 1, "customer_return"));   // returns/corrections still allowed
});

test("a movement can be reversed once; a reversal cannot be reversed (S8)", async () => {
  const o = await makeOrg(), p = await makeProduct(o, "Tape");
  const m = await asOrg(o.org, o.user, (c) => move(c, o, p, 10, "receipt"));
  const rev = await asOrg(o.org, o.user, (c) => c.query("SELECT * FROM reverse_stock_movement($1,$2,$3,'rev-1')", [o.org, m.o_movement_id, o.user]).then((r) => r.rows[0]));
  assert.equal(Number(rev.o_on_hand), 0);
  await rejects(asOrg(o.org, o.user, (c) => c.query("SELECT * FROM reverse_stock_movement($1,$2,$3,'rev-2')", [o.org, m.o_movement_id, o.user])), "ALREADY_REVERSED");
  await rejects(asOrg(o.org, o.user, (c) => c.query("SELECT * FROM reverse_stock_movement($1,$2,$3,'rev-3')", [o.org, rev.o_movement_id, o.user])), "ALREADY_REVERSED");
});

test("ledger is append-only (BR-09)", async () => {
  const o = await makeOrg(), p = await makeProduct(o, "Glue");
  await asOrg(o.org, o.user, (c) => move(c, o, p, 4, "receipt"));
  await assert.rejects(asOrg(o.org, o.user, (c) => c.query("UPDATE stock_movement SET qty_delta = 99 WHERE product_id = $1", [p])), /append-only/);
  await assert.rejects(asOrg(o.org, o.user, (c) => c.query("DELETE FROM stock_movement WHERE product_id = $1", [p])), /append-only/);
});

test("concurrent sales never lose updates; balance equals ledger (S2, reconciliation)", async () => {
  const o = await makeOrg(), p = await makeProduct(o, "Cement");
  await asOrg(o.org, o.user, (c) => move(c, o, p, 100, "opening"));
  await Promise.all(Array.from({ length: 20 }, (_, i) => asOrg(o.org, o.user, (c) => move(c, o, p, -2, "sale", { event: `par-${i}` }))));
  const bal = await asOrg(o.org, o.user, (c) => balance(c, o, p));
  assert.equal(Number(bal.on_hand), 60);
  assert.equal(Number(bal.version), 21);
  const drift = await asOrg(o.org, o.user, (c) => c.query("SELECT * FROM v_balance_drift"));
  assert.equal(drift.rowCount, 0);
});

test("stock count does not freeze sales: correction uses balance as of counted_at (D-06)", async () => {
  const o = await makeOrg(), p = await makeProduct(o, "Bolts");
  await asOrg(o.org, o.user, (c) => move(c, o, p, 50, "opening", { at: new Date(Date.now() - 3 * 3600e3) }));
  const count = await one("INSERT INTO stock_count (org_id, branch_id) VALUES ($1,$2) RETURNING id", [o.org, o.branch]);
  const countedAt = new Date(Date.now() - 3600e3);
  await q("INSERT INTO stock_count_line (org_id, count_id, product_id, counted_qty, counted_at) VALUES ($1,$2,$3,45,$4)", [o.org, count.id, p, countedAt]);
  await asOrg(o.org, o.user, (c) => move(c, o, p, -4, "sale", { at: new Date(Date.now() - 1800e3) }));   // sold AFTER counting
  const n = await asOrg(o.org, o.user, (c) => c.query("SELECT finalize_stock_count($1,$2,$3) AS n", [o.org, count.id, o.user]).then((r) => Number(r.rows[0].n)));
  assert.equal(n, 1);
  const bal = await asOrg(o.org, o.user, (c) => balance(c, o, p));
  assert.equal(Number(bal.on_hand), 41, "counted 45 at that time, minus the 4 sold afterwards");
});

test("transfer: dispatch removes from source, receive adds, shortage is a loss (T1-T3)", async () => {
  const o = await makeOrg(), p = await makeProduct(o, "Paint");
  const b2 = (await one("INSERT INTO branch (org_id, name) VALUES ($1,'Second') RETURNING id", [o.org])).id;
  await asOrg(o.org, o.user, (c) => move(c, o, p, 20, "opening"));
  const t = await one("INSERT INTO stock_transfer (org_id, from_branch, to_branch) VALUES ($1,$2,$3) RETURNING id", [o.org, o.branch, b2]);
  await q("INSERT INTO stock_transfer_line (org_id, transfer_id, product_id, qty_sent) VALUES ($1,$2,$3,10)", [o.org, t.id, p]);
  await asOrg(o.org, o.user, (c) => c.query("SELECT dispatch_stock_transfer($1,$2,$3)", [o.org, t.id, o.user]));
  assert.equal(Number((await asOrg(o.org, o.user, (c) => balance(c, o, p))).on_hand), 10);
  await asOrg(o.org, o.user, (c) => c.query("SELECT receive_stock_transfer($1,$2,$3,$4)", [o.org, t.id, o.user, JSON.stringify({ [p]: 8 })]));
  assert.equal(Number((await asOrg(o.org, o.user, (c) => balance(c, o, p, b2))).on_hand), 8);
  assert.equal(Number((await asOrg(o.org, o.user, (c) => balance(c, o, p))).on_hand), 10);
  assert.equal((await asOrg(o.org, o.user, (c) => c.query("SELECT * FROM v_balance_drift"))).rowCount, 0);
});

// ---- publication & search ----
async function publish(o, product, { showPrice = true, branch = o.branch } = {}) {
  await q(`INSERT INTO merchant_listing (org_id, branch_id, product_id, is_published, show_price, published_at)
           VALUES ($1,$2,$3,true,$4,now()) ON CONFLICT (branch_id, product_id) DO UPDATE SET is_published = true, show_price = $4`, [o.org, branch, product, showPrice]);
  await asOrg(o.org, o.user, (c) => c.query("SELECT refresh_public_listing($1,$2)", [branch, product]));
}
const search = (text, at, lat = 12.972, lng = 77.595, radius = 5000) =>
  app.query("SELECT * FROM search_listings($1,$2,$3,$4,30,0,$5)", [text, lat, lng, radius, at ?? new Date()]).then((r) => r.rows);

test("public listing never exposes quantity or cost (D-05)", async () => {
  const cols = (await q("SELECT column_name FROM information_schema.columns WHERE table_name = 'public_listing'")).map((r) => r.column_name);
  for (const bad of ["on_hand", "reserved", "unsellable", "sellable", "cost_paise", "qty"]) assert.ok(!cols.includes(bad), bad);
  const fn = (await q("SELECT pg_get_function_result('search_listings(text,double precision,double precision,integer,integer,integer,timestamptz)'::regprocedure) AS r"))[0].r;
  assert.ok(!/on_hand|quantity|cost/.test(fn));
});

test("publish -> search finds it with a label; unpublished and restricted items never appear (BR-08)", async () => {
  const o = await makeOrg("Sharma Hardware"), p = await makeProduct(o, "Unique-Hammer-9X", { thr: 3 });
  const hidden = await makeProduct(o, "Unique-Hammer-9X hidden");
  const pharm = await makeProduct(o, "Unique-Hammer-9X tablets", { category: "pharmacy" });
  await asOrg(o.org, o.user, async (c) => { await move(c, o, p, 10); await move(c, o, pharm, 10); await move(c, o, hidden, 10); });
  await publish(o, p); await publish(o, pharm);   // `hidden` is never published
  const r = await search("unique-hammer-9x");
  assert.deepEqual(r.map((x) => x.product_id), [p]);
  assert.equal(r[0].label, "available");
  assert.ok(r[0].distance_m < 1000);
});

test("labels: limited stock, out of stock, discrepancy, stale (BR-01, BR-02)", async () => {
  const o = await makeOrg(), p = await makeProduct(o, "Label-Probe-A", { thr: 5 });
  await publish(o, p);
  const refresh = () => asOrg(o.org, o.user, (c) => c.query("SELECT refresh_public_listing($1,$2)", [o.branch, p]));
  await asOrg(o.org, o.user, (c) => move(c, o, p, 4)); await refresh();
  assert.equal((await search("label-probe-a"))[0].label, "limited_stock");
  await asOrg(o.org, o.user, (c) => move(c, o, p, -4, "sale")); await refresh();
  assert.equal((await search("label-probe-a"))[0].label, "out_of_stock");
  await asOrg(o.org, o.user, (c) => move(c, o, p, -1, "sale")); await refresh();   // negative -> discrepancy
  assert.equal((await search("label-probe-a"))[0].label, "check_with_shop");
  await asOrg(o.org, o.user, (c) => move(c, o, p, 20)); await refresh();
  assert.equal((await search("label-probe-a"))[0].label, "available");
  assert.equal((await search("label-probe-a", new Date(Date.now() + 2 * DAY)))[0].label, "check_with_shop", "native TTL is 24h");
});

test("price is shown only when allowed and fresher than 14 days (D-10)", async () => {
  const o = await makeOrg(), shown = await makeProduct(o, "Price-Probe-Shown", { price: 12900 }), hidden = await makeProduct(o, "Price-Probe-Hidden", { price: 5000 });
  await asOrg(o.org, o.user, async (c) => { await move(c, o, shown, 5); await move(c, o, hidden, 5); });
  await publish(o, shown, { showPrice: true }); await publish(o, hidden, { showPrice: false });
  assert.equal(Number((await search("price-probe-shown"))[0].price_paise), 12900);
  assert.equal((await search("price-probe-hidden"))[0].price_paise, null);
  assert.equal((await search("price-probe-shown", new Date(Date.now() + 15 * DAY)))[0].price_paise, null);
});

test("status-only products: manual in/out of stock drives the label (FR-INV-06)", async () => {
  const o = await makeOrg(), p = await makeProduct(o, "Status-Only-Probe", { mode: "status_only" });
  await publish(o, p);
  await asOrg(o.org, o.user, (c) => c.query("SELECT set_stock_status($1,$2,$3,'in_stock',$4)", [o.org, o.branch, p, o.user]));
  await asOrg(o.org, o.user, (c) => c.query("SELECT refresh_public_listing($1,$2)", [o.branch, p]));
  assert.equal((await search("status-only-probe"))[0].label, "available");
  assert.equal((await search("status-only-probe", new Date(Date.now() + 3 * DAY)))[0].label, "available", "manual status TTL is 7 days");
  assert.equal((await search("status-only-probe", new Date(Date.now() + 8 * DAY)))[0].label, "check_with_shop");
});

test("offline rule: branch not synced for >24h shows 'check with shop' (FR-OFF-06)", async () => {
  const o = await makeOrg(), p = await makeProduct(o, "Offline-Probe");
  await asOrg(o.org, o.user, (c) => move(c, o, p, 9));
  await q("UPDATE branch SET last_synced_at = now() WHERE id = $1", [o.branch]);
  await publish(o, p);
  assert.equal((await search("offline-probe"))[0].label, "available");
  await q("UPDATE branch SET last_synced_at = now() - interval '30 hours' WHERE id = $1", [o.branch]);
  await asOrg(o.org, o.user, (c) => c.query("SELECT refresh_public_branch($1)", [o.branch]));
  assert.equal((await search("offline-probe"))[0].label, "check_with_shop");
});

test("kill switch: public_degraded forces every label to 'check with shop' (RB-1)", async () => {
  const o = await makeOrg(), p = await makeProduct(o, "Degraded-Probe");
  await asOrg(o.org, o.user, (c) => move(c, o, p, 9)); await publish(o, p);
  await q("UPDATE feature_flag SET enabled = true WHERE key = 'public_degraded'");
  try { assert.equal((await search("degraded-probe"))[0].label, "check_with_shop"); }
  finally { await q("UPDATE feature_flag SET enabled = false WHERE key = 'public_degraded'"); }
});

test("search: Hindi, Hinglish and English find the same product; radius is respected (FR-SRCH-02/04)", async () => {
  const o = await makeOrg("Fan House"), p = await makeProduct(o, "Ceiling Fan 1200mm", { hi: "सीलिंग पंखा" });
  await asOrg(o.org, o.user, (c) => move(c, o, p, 7)); await publish(o, p);
  for (const term of ["fan", "pankha", "पंखा", "ceiling fan", "ceilin"]) {
    assert.ok((await search(term)).some((x) => x.product_id === p), `"${term}" should find the fan`);
  }
  assert.equal((await search("fan", undefined, 13.1, 77.6, 1000)).filter((x) => x.product_id === p).length, 0, "too far for a 1 km radius");
});

test("branch open state: unknown without verified hours, closed override wins (FR-SHOP-01)", async () => {
  const noon = new Date("2026-03-04T06:30:00Z");   // 12:00 IST, a Wednesday
  const hours = { wed: [["09:00", "21:00"]] };
  const st = (...a) => app.query("SELECT branch_open_state($1,$2,$3,$4,'Asia/Kolkata',$5) AS s", [hours, a[0], a[1] ?? null, null, noon]).then((r) => r.rows[0].s);
  assert.equal(await st(false), "unknown");
  assert.equal(await st(true), "open");
  assert.equal(await st(true, "closed_today"), "closed");
});

test("inaccuracy reports: consumer can file; merchant sees them; others cannot (FR-RPT)", async () => {
  const o = await makeOrg(), other = await makeOrg();
  const consumer = await one("INSERT INTO app_user (kind, phone_e164, age_confirmed_at) VALUES ('consumer', $1, now()) RETURNING id", ["+9188" + String(Date.now() + ++seq).slice(-8)]);
  await asOrg(null, consumer.id, (c) => c.query("INSERT INTO inaccuracy_report (org_id, branch_id, consumer_id, type) VALUES ($1,$2,$3,'shop_closed')", [o.org, o.branch, consumer.id]));
  assert.equal((await asOrg(o.org, o.user, (c) => c.query("SELECT 1 FROM inaccuracy_report"))).rowCount, 1);
  assert.equal((await asOrg(other.org, other.user, (c) => c.query("SELECT 1 FROM inaccuracy_report"))).rowCount, 0);
  await assert.rejects(asOrg(null, other.user, (c) => c.query("INSERT INTO inaccuracy_report (org_id, branch_id, consumer_id, type) VALUES ($1,$2,$3,'wrong_price')", [o.org, o.branch, consumer.id])), /row-level security/);
});

test("barcode/SKU unique per org only; same barcode allowed in another org (C1)", async () => {
  const a = await makeOrg(), b = await makeOrg(), pa = await makeProduct(a, "P1"), pa2 = await makeProduct(a, "P2"), pb = await makeProduct(b, "P3");
  await q("INSERT INTO product_identifier (org_id, product_id, kind, value) VALUES ($1,$2,'barcode','8901234567890')", [a.org, pa]);
  await q("INSERT INTO product_identifier (org_id, product_id, kind, value) VALUES ($1,$2,'barcode','8901234567890')", [b.org, pb]);
  await assert.rejects(q("INSERT INTO product_identifier (org_id, product_id, kind, value) VALUES ($1,$2,'barcode','8901234567890')", [a.org, pa2]), /duplicate key/);
});

test("composite FKs block cross-tenant references", async () => {
  const a = await makeOrg(), b = await makeOrg(), pb = await makeProduct(b, "B product");
  await assert.rejects(q(`SELECT apply_stock_movement($1,$2,$3,1,'on_hand','receipt','native','x-tenant',now())`, [a.org, a.branch, pb]), /product not found|foreign key/);
});

test("subscription: entitlements and invoice numbers (FR-BIL)", async () => {
  const o = await makeOrg();
  await q("UPDATE plan SET features = '{\"transfers\": true}' WHERE id = 'premium'");
  await q("INSERT INTO subscription (org_id, plan_id) VALUES ($1,'free')", [o.org]);
  assert.equal((await one("SELECT org_has_feature($1,'transfers') AS f", [o.org])).f, false);
  await q("UPDATE subscription SET plan_id = 'premium' WHERE org_id = $1", [o.org]);
  assert.equal((await one("SELECT org_has_feature($1,'transfers') AS f", [o.org])).f, true);
  await q("UPDATE subscription SET status = 'read_only' WHERE org_id = $1", [o.org]);
  assert.equal((await one("SELECT org_has_feature($1,'transfers') AS f", [o.org])).f, false);
  await q("UPDATE plan SET features = '{}' WHERE id = 'premium'");
  const n1 = (await one("SELECT next_invoice_number('2026-04-01T00:00:00+05:30') AS n")).n, n2 = (await one("SELECT next_invoice_number('2026-04-02T00:00:00+05:30') AS n")).n;
  assert.match(n1, /^INV\/2026-27\/\d{6}$/);
  assert.equal(Number(n2.slice(-6)), Number(n1.slice(-6)) + 1);
  assert.match((await one("SELECT next_invoice_number('2027-03-31T10:00:00+05:30') AS n")).n, /^INV\/2026-27\//);
  assert.match((await one("SELECT next_invoice_number('2027-04-01T10:00:00+05:30') AS n")).n, /^INV\/2027-28\//);
});

test("audit log is append-only and tenant-scoped", async () => {
  const o = await makeOrg(), other = await makeOrg();
  await asOrg(o.org, o.user, (c) => c.query("INSERT INTO audit_event (org_id, actor_user_id, action) VALUES ($1,$2,'role.changed')", [o.org, o.user]));
  assert.equal((await asOrg(other.org, other.user, (c) => c.query("SELECT 1 FROM audit_event"))).rowCount, 0);
  // The app role has no UPDATE/DELETE policy, so RLS makes these touch zero rows; even the owner is blocked by the trigger.
  const upd = await asOrg(o.org, o.user, (c) => c.query("UPDATE audit_event SET action = 'x'"));
  const del = await asOrg(o.org, o.user, (c) => c.query("DELETE FROM audit_event"));
  assert.equal(upd.rowCount + del.rowCount, 0);
  await assert.rejects(q("UPDATE audit_event SET action = 'x' WHERE org_id = $1", [o.org]), /append-only/);
  assert.equal((await q("SELECT action FROM audit_event WHERE org_id = $1", [o.org]))[0].action, "role.changed");
});
