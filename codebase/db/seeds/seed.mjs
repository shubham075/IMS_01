// Mock-data seed: 8 fictional Indian local shops (12 branches), ~2,100 products in English + Hindi, a realistic ledger,
// and deliberate edge-case scenarios (stale, negative stock, offline branch, restricted category, unpublished, read-only org ...).
//   node db/seeds/seed.mjs        (wipes ALL tenant data, keeps reference data; local/dev only)
// Deterministic: fixed PRNG seed, so every run produces the same shops/products. Writes db/seeds/MOCK_DATA.md.

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildPool, rng, SYNONYMS } from "./catalogue.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = process.env.DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/idea01";
if (/prod/i.test(ADMIN)) throw new Error("refusing to seed a production-looking database");
const c = new pg.Client({ connectionString: ADMIN });
await c.connect();
const q = (text, values) => c.query(text, values);
const one = async (t, v) => (await q(t, v)).rows[0];
const H = 3600e3,
  T0 = Date.now(),
  ago = (hours) => new Date(T0 - hours * H);
const t0 = Date.now();

async function bulk(table, cols, rows, returning) {
  const out = [],
    size = Math.min(500, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const ph = chunk
      .map((_, r) => "(" + cols.map((_, k) => "$" + (r * cols.length + k + 1)).join(",") + ")")
      .join(",");
    const res = await q(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES ${ph}${returning ? " RETURNING " + returning : ""}`,
      chunk.flat(),
    );
    if (returning) out.push(...res.rows);
  }
  return out;
}
const ean13 = (R) => {
  const d = [8, 9, 0, ...Array.from({ length: 9 }, () => R.int(0, 9))];
  const s = d.reduce((a, x, i) => a + x * (i % 2 ? 3 : 1), 0);
  return d.join("") + ((10 - (s % 10)) % 10);
};
const HOURS = {
  std: {
    mon: [["09:00", "21:00"]],
    tue: [["09:00", "21:00"]],
    wed: [["09:00", "21:00"]],
    thu: [["09:00", "21:00"]],
    fri: [["09:00", "21:00"]],
    sat: [["09:00", "21:00"]],
    sun: [["10:00", "14:00"]],
  },
  daily: Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [["10:00", "21:30"]]]),
  ),
  office: Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [
      d,
      [
        ["09:30", "13:30"],
        ["16:00", "20:30"],
      ],
    ]),
  ),
};

// ---------------------------------------------------------------- shop definitions (ALL FICTIONAL)
const ORGS = [
  {
    key: "sharma",
    name: "Sharma Hardware & Paints",
    gstin: "29AAAAA0001A1Z5",
    owner: ["Rajesh Sharma", "+919000000001"],
    cats: [["hardware", 300]],
    plan: "premium",
    sub: "active",
    cycle: "monthly",
    branches: [
      {
        name: "Jayanagar 4th Block",
        area: "Jayanagar",
        pin: "560011",
        lat: 12.925,
        lng: 77.583,
        hours: "std",
        synced: 2,
        wa: true,
      },
      { name: "JP Nagar 2nd Phase", area: "JP Nagar", pin: "560078", lat: 12.91, lng: 77.585, hours: "std" },
    ],
    staff: [
      ["Anita Sharma", "+919000100001", "branch_manager", [0]],
      ["Mohan Kumar", "+919000100002", "inventory_operator", [0]],
      ["Vikas Yadav", "+919000100003", "sales_operator", [1]],
      ["Ravi Singh (left shop)", "+919000100004", "inventory_operator", [0], "removed"],
    ],
  },
  {
    key: "gupta",
    name: "Gupta Electricals",
    gstin: "29AAAAA0002A1Z5",
    owner: ["Sunil Gupta", "+919000000002"],
    cats: [["electrical", 280]],
    plan: "free",
    sub: "active",
    branches: [
      {
        name: "Basavanagudi",
        area: "Basavanagudi",
        pin: "560004",
        lat: 12.942,
        lng: 77.575,
        hours: "std",
        wa: true,
      },
    ],
    staff: [["Deepak Rao", "+919000100005", "inventory_operator", []]],
  },
  {
    key: "patel",
    name: "Patel Stationers",
    gstin: "29AAAAA0003A1Z5",
    owner: ["Hitesh Patel", "+919000000003"],
    cats: [["stationery", 260]],
    plan: "premium",
    sub: "trialing",
    statusOnlyShare: 0.08,
    branches: [
      {
        name: "Jayanagar 9th Block",
        area: "Jayanagar",
        pin: "560069",
        lat: 12.918,
        lng: 77.592,
        hours: "daily",
        wa: true,
      },
      {
        name: "Banashankari (new, not yet published)",
        area: "Banashankari",
        pin: "560070",
        lat: 12.9255,
        lng: 77.5468,
        hours: "daily",
        published: false,
      },
    ],
    staff: [
      ["Kavita Patel", "+919000100006", "branch_manager", [0]],
      ["CA Mehta (auditor)", "+919000100007", "auditor", []],
    ],
  },
  {
    key: "mobilezone",
    name: "Mobile Zone Accessories",
    gstin: "29AAAAA0004A1Z5",
    owner: ["Imran Pasha", "+919000000004"],
    cats: [["electronics-accessories", 230]],
    plan: "free",
    sub: "active",
    branches: [
      {
        name: "Jayanagar Shopping Complex",
        area: "Jayanagar",
        pin: "560011",
        lat: 12.93,
        lng: 77.583,
        hours: "daily",
        wa: true,
      },
      {
        name: "BTM Layout",
        area: "BTM Layout",
        pin: "560076",
        lat: 12.9166,
        lng: 77.6101,
        hours: "daily",
        synced: 5,
      },
    ],
    staff: [],
  },
  {
    key: "raj",
    name: "Raj Traders (subscription lapsed)",
    gstin: "29AAAAA0005A1Z5",
    owner: ["Raj Malhotra", "+919000000005"],
    cats: [
      ["hardware", 150],
      ["electrical", 120],
      ["pharmacy", 12],
    ],
    plan: "premium",
    sub: "read_only",
    orgStatus: "read_only",
    branches: [
      {
        name: "Wilson Garden",
        area: "Wilson Garden",
        pin: "560027",
        lat: 12.95,
        lng: 77.599,
        hours: "unverified",
      },
    ],
    staff: [],
  },
  {
    key: "lakshmi",
    name: "Lakshmi Book & Stationery",
    gstin: "29AAAAA0006A1Z5",
    owner: ["Lakshmi Iyer", "+919000000006"],
    cats: [["stationery", 220]],
    plan: "free",
    sub: "active",
    statusOnlyShare: 0.1,
    branches: [
      {
        name: "Bull Temple Road",
        area: "Basavanagudi",
        pin: "560004",
        lat: 12.944,
        lng: 77.569,
        hours: "office",
      },
    ],
    staff: [],
  },
  {
    key: "khan",
    name: "Khan Electronics & Electricals",
    gstin: "29AAAAA0007A1Z5",
    owner: ["Salman Khan", "+919000000007"],
    cats: [
      ["electronics-accessories", 130],
      ["electrical", 100],
    ],
    plan: "premium",
    sub: "active",
    cycle: "annual",
    branches: [
      {
        name: "Lalbagh Road",
        area: "Lalbagh",
        pin: "560027",
        lat: 12.95,
        lng: 77.585,
        hours: "daily",
        wa: true,
      },
      {
        name: "Shanti Nagar",
        area: "Shanti Nagar",
        pin: "560027",
        lat: 12.957,
        lng: 77.599,
        hours: "daily",
        override: "closed_today",
      },
    ],
    staff: [["Farhan Ali", "+919000100008", "inventory_operator", [0]]],
  },
  {
    key: "cityhw",
    name: "City Hardware Mart (offline for a day)",
    gstin: "29AAAAA0008A1Z5",
    owner: ["Prakash Naik", "+919000000008"],
    cats: [["hardware", 280]],
    plan: "premium",
    sub: "grace",
    cycle: "monthly",
    branches: [
      {
        name: "Chamarajpet",
        area: "Chamarajpet",
        pin: "560018",
        lat: 12.956,
        lng: 77.565,
        hours: "std",
        synced: 30,
      },
    ],
    staff: [],
  },
];
const CONSUMERS = [
  ["Asha K", "+919000200001", "hi"],
  ["Rohit M", "+919000200002", "en"],
  ["Neha S", "+919000200003", "hi"],
  ["Arjun V", "+919000200004", "en"],
  ["Fatima B", "+919000200005", "hi"],
];

// ---------------------------------------------------------------- 0. wipe tenant data, add synonyms
await q("BEGIN");
try {
  await q(`TRUNCATE app_user, organization, canonical_product, stock_event_key, reversed_movement, public_listing, outbox, audit_event,
           idempotency_key, payment_event, invoice_counter, search_synonym RESTART IDENTITY CASCADE`);
  const base = [
    [1, "fan", "pankha", "पंखा"],
    [2, "bulb", "बल्ब", "led"],
    [3, "notebook", "copy", "कॉपी", "नोटबुक"],
    [4, "pen", "कलम", "पेन", "kalam"],
    [5, "hammer", "hathoda", "हथौड़ा"],
    [6, "charger", "चार्जर"],
    [7, "wire", "तार", "tar", "cable"],
  ];
  const groups = [...base, ...SYNONYMS.map((g, i) => [100 + i, ...g])];
  for (const [gid, ...terms] of groups)
    for (const t of terms)
      await q("INSERT INTO search_synonym VALUES ($1, lower(f_unaccent($2))) ON CONFLICT DO NOTHING", [
        gid,
        t,
      ]);

  // ------------------------------------------------------------ 1. users, orgs, branches, memberships
  const catId = Object.fromEntries(
    (await q("SELECT slug, id FROM category")).rows.map((r) => [r.slug, r.id]),
  );
  const user = async (kind, name, phone, locale = "en") =>
    (
      await one(
        "INSERT INTO app_user (kind, phone_e164, display_name, locale, age_confirmed_at, last_active_at) VALUES ($1,$2,$3,$4,now(),$5) RETURNING id",
        [kind, phone, name, locale, ago(Math.random() * 48)],
      )
    ).id;
  const consumers = [];
  for (const [n, p, l] of CONSUMERS) consumers.push(await user("consumer", n, p, l));
  const deviceOf = {};
  const E = {}; // per-org state
  for (const [oi, o] of ORGS.entries()) {
    const ownerId = await user("merchant", o.owner[0], o.owner[1], oi % 3 === 0 ? "hi" : "en");
    const org = (
      await one(
        "INSERT INTO organization (name, legal_name, category, gstin, contact_phone, status, created_by, created_at) VALUES ($1,$1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [
          o.name,
          o.cats[0][0],
          o.gstin,
          o.owner[1],
          o.orgStatus ?? "active",
          ownerId,
          ago(24 * (20 + oi * 9)),
        ],
      )
    ).id;
    const st = { org, owner: ownerId, staff: [], branches: [], key: o.key, cfg: o };
    E[o.key] = st;
    const mOwner = (
      await one("INSERT INTO membership (org_id, user_id, role_code) VALUES ($1,$2,'owner') RETURNING id", [
        org,
        ownerId,
      ])
    ).id;
    for (const [bi, b] of o.branches.entries()) {
      const hv = b.hours !== "unverified";
      const r = await one(
        `INSERT INTO branch (org_id, name, address_line, area, city, state, pincode, geo, hours, hours_verified, phone_public, whatsapp_public,
              contact_options, is_published, closed_override, closed_until, last_synced_at)
        VALUES ($1,$2,$3,$4,'Bengaluru','Karnataka',$5, ST_SetSRID(ST_MakePoint($7,$6),4326)::geography, $8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [
          org,
          b.name,
          `${10 + oi * 3 + bi}, ${b.area} Main Road`,
          b.area,
          b.pin,
          b.lat,
          b.lng,
          JSON.stringify(HOURS[b.hours === "unverified" ? "std" : b.hours]),
          hv,
          `+91804100${String(oi * 10 + bi + 1).padStart(4, "0")}`,
          b.wa ? o.owner[1] : null,
          b.wa ? ["call", "whatsapp"] : ["call"],
          b.published !== false,
          b.override ?? null,
          b.override ? new Date(T0 + 8 * H) : null,
          b.synced != null ? ago(b.synced) : null,
        ],
      );
      st.branches.push({ id: r.id, ...b, idx: bi });
    }
    for (const [name, phone, role, scope, status] of o.staff) {
      const uid = await user("merchant", name, phone);
      const m = (
        await one(
          "INSERT INTO membership (org_id, user_id, role_code, status) VALUES ($1,$2,$3,$4) RETURNING id",
          [org, uid, role, status ?? "active"],
        )
      ).id;
      for (const bi of scope)
        await q("INSERT INTO membership_branch VALUES ($1,$2,$3)", [org, m, st.branches[bi].id]);
      st.staff.push({ id: uid, role, removed: status === "removed", name });
    }
    for (const u of [{ id: ownerId, role: "owner" }, ...st.staff.filter((s) => !s.removed)]) {
      const d = await one(
        "INSERT INTO device (user_id, platform, app_version, label, push_token) VALUES ($1,'android','1.0.0',$2,$3) RETURNING id",
        [u.id, "Shop phone", `mock-push-${u.id.slice(0, 8)}`],
      );
      deviceOf[o.key] = deviceOf[o.key] ?? {};
      deviceOf[o.key][u.id] = d.id;
    }
    await q("INSERT INTO device (user_id, platform, label) VALUES ($1,'web','Shop PC (Chrome)')", [ownerId]);
    await bulk(
      "adjustment_reason",
      ["org_id", "label", "reason"],
      [
        [org, "Damaged in shop", "damage"],
        [org, "Expired", "expiry"],
        [org, "Counting mistake", "adjustment"],
        [org, "Lost / theft", "loss"],
        [org, "Found extra", "found"],
      ],
    );
    void mOwner;
  }
  for (const u of consumers.slice(0, 3))
    await q("INSERT INTO device (user_id, platform, app_version) VALUES ($1,'android','1.0.0')", [u]);

  // ------------------------------------------------------------ 2. products + identifiers
  const pools = {};
  for (const cat of ["hardware", "electrical", "stationery", "electronics-accessories", "pharmacy"])
    pools[cat] = buildPool(cat);
  let productTotal = 0;
  for (const [oi, o] of ORGS.entries()) {
    const st = E[o.key],
      R = rng(7000 + oi * 13);
    const tpls = o.cats.flatMap(([cat, n], ci) =>
      rng(500 + oi * 7 + ci).sample(pools[cat], Math.min(n, pools[cat].length)),
    );
    const rows = tpls.map((t) => {
      const price = Math.round(t.price * (0.92 + R.float(0, 0.16)));
      const priceAt = R.chance(0.03)
        ? null
        : R.chance(0.07)
          ? ago(24 * R.float(20, 45))
          : ago(24 * R.float(0.1, 10));
      const noPrice = priceAt === null;
      const statusOnly = o.statusOnlyShare && R.chance(o.statusOnlyShare) && t.category !== "pharmacy";
      return [
        st.org,
        catId[t.category],
        t.name,
        t.name_hi,
        t.brand,
        t.unit,
        t.frac,
        statusOnly ? "status_only" : "quantity",
        t.thr,
        noPrice ? null : price * 100,
        priceAt,
        Math.round(price * 100 * 0.72),
        JSON.stringify({ family: t.family }),
      ];
    });
    const ids = await bulk(
      "product",
      [
        "org_id",
        "category_id",
        "name",
        "name_hi",
        "brand",
        "unit",
        "allow_fraction",
        "tracking_mode",
        "low_stock_threshold",
        "price_paise",
        "price_updated_at",
        "cost_paise",
        "attrs",
      ],
      rows,
      "id",
    );
    st.products = ids.map((r, i) => ({
      id: r.id,
      tpl: tpls[i],
      status_only: rows[i][7] === "status_only",
      thr: tpls[i].thr,
      hasPrice: rows[i][9] !== null,
    }));
    productTotal += ids.length;
    // identifiers: 65% barcode, 25% SKU, aliases (Hinglish), short code when no barcode
    const idents = [],
      used = new Set();
    st.products.forEach((p, i) => {
      let bc = null;
      if (R.chance(0.65)) {
        do {
          bc = ean13(R);
        } while (used.has(bc));
        used.add(bc);
        idents.push([st.org, p.id, "barcode", bc]);
      }
      if (R.chance(0.25))
        idents.push([
          st.org,
          p.id,
          "sku",
          `${o.key.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(4, "0")}`,
        ]);
      if (!bc)
        idents.push([st.org, p.id, "short_code", "SC" + (100000 + i * 7 + oi).toString(36).toUpperCase()]);
      for (const a of p.tpl.alias.slice(0, 2)) idents.push([st.org, p.id, "alias", a]);
    });
    await bulk("product_identifier", ["org_id", "product_id", "kind", "value"], idents);
  }
  // the same barcode used by two different products in two different shops (docs/01 C1)
  for (const k of ["sharma", "cityhw"]) {
    const p = E[k].products.find((x) => x.tpl.category === "hardware");
    await q(
      "INSERT INTO product_identifier (org_id, product_id, kind, value) VALUES ($1,$2,'barcode','8901234500001') ON CONFLICT DO NOTHING",
      [E[k].org, p.id],
    );
  }
  // near-duplicate products with no stock: merge candidates (FR-CAT-09)
  {
    const st = E.sharma,
      src = st.products.filter((p) => /\d(mm|g|kg|L)\b/.test(p.tpl.name)).slice(0, 6);
    await bulk(
      "product",
      ["org_id", "category_id", "name", "name_hi", "brand", "unit", "price_paise", "price_updated_at"],
      src.map((p) => [
        st.org,
        catId[p.tpl.category],
        p.tpl.name.replace(/(\d+)(mm|g|kg|L)\b/, "$1 $2") + " (dup)",
        p.tpl.name_hi,
        p.tpl.brand,
        p.tpl.unit,
        p.tpl.price * 100,
        ago(48),
      ]),
    );
    productTotal += src.length;
  }

  // ------------------------------------------------------------ 3. ledger with scenarios
  const SC = {
    normal: 0,
    out: 0,
    limited: 0,
    negative: 0,
    stale_native: 0,
    csv_fresh: 0,
    csv_stale: 0,
    unstocked: 0,
    status_only_in: 0,
    status_only_out: 0,
    status_only_stale: 0,
  };
  let movements = 0;
  const MV = { name: "mv", text: "SELECT apply_stock_movement($1,$2,$3,$4,'on_hand',$5,$6,$7,$8,$9)" };
  for (const [oi, o] of ORGS.entries()) {
    const st = E[o.key],
      actors = [st.owner, ...st.staff.filter((s) => !s.removed).map((s) => s.id)];
    for (const b of st.branches) {
      const R = rng(9000 + oi * 10 + b.idx);
      for (const [pi, p] of st.products.entries()) {
        if (b.idx > 0 && R.chance(0.2)) continue; // second branch stocks ~80% of the range
        if (p.status_only) {
          const out = R.chance(0.15),
            stale = R.chance(0.06);
          await q("SELECT set_stock_status($1,$2,$3,$4,$5)", [
            st.org,
            b.id,
            p.id,
            out ? "out_of_stock" : "in_stock",
            st.owner,
          ]);
          await q(
            "UPDATE inventory_balance SET last_verified_at = $3 WHERE branch_id = $1 AND product_id = $2",
            [b.id, p.id, ago(stale ? R.float(200, 300) : R.float(1, 120))],
          );
          SC[stale ? "status_only_stale" : out ? "status_only_out" : "status_only_in"]++;
          continue;
        }
        const roll = R.next();
        const kind =
          roll < 0.04
            ? "unstocked"
            : roll < 0.1
              ? "out"
              : roll < 0.18
                ? "limited"
                : roll < 0.205
                  ? "negative"
                  : roll < 0.285
                    ? "stale_native"
                    : roll < 0.325
                      ? "csv_fresh"
                      : roll < 0.355
                        ? "csv_stale"
                        : "normal";
        SC[kind]++;
        if (kind === "unstocked") continue;
        const target =
          kind === "out"
            ? 0
            : kind === "limited"
              ? R.int(1, Math.max(1, p.thr))
              : kind === "negative"
                ? -R.int(1, 6)
                : R.int(p.thr + 2, p.thr + 90);
        const src = kind.startsWith("csv") ? "csv" : "native";
        const last =
          kind === "stale_native"
            ? R.float(30, 140)
            : kind === "csv_fresh"
              ? R.float(5, 60)
              : kind === "csv_stale"
                ? R.float(80, 200)
                : R.float(0.4, 20);
        const evs = [];
        const n = R.int(2, 4);
        for (let i = 0; i < n; i++)
          evs.push({
            age: i === 0 ? last : last + R.float(2, 200),
            qty: R.chance(0.7) ? -R.int(1, 6) : R.int(5, 40),
          });
        const sum = evs.reduce((a, e) => a + e.qty, 0),
          opening = Math.max(0, target - sum),
          rem = target - (opening + sum);
        if (rem !== 0) evs.push({ age: last, qty: rem });
        const oldest = Math.max(...evs.map((e) => e.age)),
          actor = R.pick(actors),
          tag = `s${oi}.${b.idx}.${pi}`;
        if (opening > 0) {
          await q(MV, [
            st.org,
            b.id,
            p.id,
            opening,
            "opening",
            src,
            `${tag}.o`,
            ago(oldest + R.float(2, 30)),
            actor,
          ]);
          movements++;
        }
        for (const [k, e] of evs.entries()) {
          await q(MV, [
            st.org,
            b.id,
            p.id,
            e.qty,
            e.qty < 0 ? "sale" : "receipt",
            src,
            `${tag}.${k}`,
            ago(e.age),
            actor,
          ]);
          movements++;
        }
      }
    }
  }

  // ------------------------------------------------------------ 4. publication (merchant_listing)
  let listings = 0;
  for (const [oi, o] of ORGS.entries()) {
    const st = E[o.key],
      R = rng(11000 + oi);
    const rows = [];
    for (const b of st.branches)
      for (const p of st.products) {
        const restricted = p.tpl.category === "pharmacy",
          published = restricted || R.chance(0.9);
        rows.push([
          st.org,
          b.id,
          p.id,
          published,
          p.hasPrice && R.chance(0.78),
          published ? ago(24 * R.float(1, 15)) : null,
          R.chance(0.005),
          st.owner,
        ]);
      }
    await bulk(
      "merchant_listing",
      [
        "org_id",
        "branch_id",
        "product_id",
        "is_published",
        "show_price",
        "published_at",
        "temporarily_unavailable",
        "published_by",
      ],
      rows,
    );
    listings += rows.length;
  }

  // ------------------------------------------------------------ 5. ancillary scenarios (counts, transfers, reversals, imports, sync, reviews ...)
  const S = E.sharma,
    sb0 = S.branches[0].id,
    sb1 = S.branches[1].id,
    sOp = S.staff[1].id;
  const stocked = (
    await q(
      "SELECT product_id FROM inventory_balance WHERE branch_id = $1 AND on_hand > 25 AND NOT discrepancy ORDER BY product_id LIMIT 40",
      [sb0],
    )
  ).rows.map((r) => r.product_id);
  {
    // finalized count (counts don't freeze sales: counted_at is in the past) and an open draft count
    const cnt = (
      await one(
        "INSERT INTO stock_count (org_id, branch_id, kind, started_by, started_at) VALUES ($1,$2,'cycle',$3,$4) RETURNING id",
        [S.org, sb0, sOp, ago(72)],
      )
    ).id;
    await bulk(
      "stock_count_line",
      ["org_id", "count_id", "product_id", "counted_qty", "counted_at", "counted_by"],
      stocked.slice(0, 6).map((pid, i) => [S.org, cnt, pid, 20 + i, ago(70), sOp]),
    );
    await q("SELECT finalize_stock_count($1,$2,$3)", [S.org, cnt, sOp]);
    const d = (
      await one(
        "INSERT INTO stock_count (org_id, branch_id, kind, started_by) VALUES ($1,$2,'cycle',$3) RETURNING id",
        [S.org, sb0, sOp],
      )
    ).id;
    await bulk(
      "stock_count_line",
      ["org_id", "count_id", "product_id", "counted_qty", "counted_by"],
      stocked.slice(6, 11).map((pid, i) => [S.org, d, pid, 30 + i, sOp]),
    );
  }
  for (const [ix, recv] of [
    [12, null],
    [16, 1],
  ]) {
    const t = (
      await one(
        "INSERT INTO stock_transfer (org_id, from_branch, to_branch, created_by) VALUES ($1,$2,$3,$4) RETURNING id",
        [S.org, sb0, sb1, S.owner],
      )
    ).id;
    await bulk(
      "stock_transfer_line",
      ["org_id", "transfer_id", "product_id", "qty_sent"],
      stocked.slice(ix, ix + 4).map((pid) => [S.org, t, pid, 5]),
    );
    await q("SELECT dispatch_stock_transfer($1,$2,$3)", [S.org, t, S.owner]);
    if (recv)
      await q("SELECT receive_stock_transfer($1,$2,$3,$4)", [
        S.org,
        t,
        S.owner,
        JSON.stringify({ [stocked[ix]]: 4 }),
      ]);
  }
  for (const m of (
    await q(
      "SELECT id FROM stock_movement WHERE org_id = $1 AND reason = 'sale' ORDER BY occurred_at DESC LIMIT 3",
      [S.org],
    )
  ).rows)
    await q("SELECT reverse_stock_movement($1,$2,$3,$4,'mistaken sale entry')", [
      S.org,
      m.id,
      S.owner,
      `seed-rev-${m.id}`,
    ]);

  {
    // imports: one applied, one needing review (unknown barcodes, bad units)
    const G = E.gupta,
      R = E.raj;
    const j1 = (
      await one(
        "INSERT INTO import_job (org_id, branch_id, kind, status, file_key, file_name, total_rows, applied_rows, created_by, created_at, applied_at) VALUES ($1,$2,'products','applied','mock/gupta_products.csv','products_oct.csv',120,120,$3,$4,$4) RETURNING id",
        [G.org, G.branches[0].id, G.owner, ago(200)],
      )
    ).id;
    await bulk(
      "import_row",
      ["org_id", "job_id", "row_no", "raw", "status", "product_id"],
      G.products
        .slice(0, 120)
        .map((p, i) => [G.org, j1, i + 1, JSON.stringify({ name: p.tpl.name }), "applied", p.id]),
    );
    const j2 = (
      await one(
        "INSERT INTO import_job (org_id, branch_id, kind, status, file_key, file_name, snapshot_ts, total_rows, applied_rows, error_rows, created_by, created_at) VALUES ($1,$2,'snapshot','needs_review','mock/raj_snapshot.xlsx','stock_snapshot.xlsx',$3,25,15,5,$4,$3) RETURNING id",
        [R.org, R.branches[0].id, ago(30), R.owner],
      )
    ).id;
    const rows = Array.from({ length: 25 }, (_, i) => [
      R.org,
      j2,
      i + 1,
      JSON.stringify({ code: `RT-${1000 + i}`, qty: 10 + i }),
      i < 15 ? "ok" : i < 20 ? "error" : "needs_review",
      i >= 15 && i < 20 ? "UNIT_NOT_CONVERTIBLE" : null,
      i >= 15 && i < 20 ? "Unit 'dozen' is not defined for this product" : null,
    ]);
    await bulk("import_row", ["org_id", "job_id", "row_no", "raw", "status", "error_code", "message"], rows);
    await bulk(
      "review_queue_item",
      ["org_id", "kind", "ref_type", "ref_id", "payload"],
      Array.from({ length: 5 }, (_, i) => [
        R.org,
        "product_mapping",
        "import_row",
        `${j2}:${21 + i}`,
        JSON.stringify({ code: `RT-${1020 + i}`, suggestion: R.products[i].tpl.name }),
      ]),
    );
  }
  {
    // offline sync log (Sharma's inventory operator) + ops from a removed staff member waiting for review (D-02)
    const dev = deviceOf.sharma[sOp],
      res = ["applied", "duplicate", "rejected", "needs_review", "blocked"],
      errs = ["QTY_NOT_INTEGRAL", "DATE_OUT_OF_RANGE", "PRODUCT_INACTIVE"];
    const ops = Array.from({ length: 40 }, (_, i) => {
      const r = i < 28 ? 0 : i < 32 ? 1 : i < 35 ? 2 : i < 38 ? 3 : 4;
      return [
        S.org,
        randomUUID(),
        dev,
        i + 1,
        ["sale", "receipt", "adjustment"][i % 3],
        JSON.stringify({ product_id: stocked[i % stocked.length], qty: 1 + (i % 5) }),
        ago(30 - i * 0.3),
        res[r],
        r === 2 ? errs[i % 3] : null,
      ];
    });
    await bulk(
      "sync_op_log",
      [
        "org_id",
        "client_op_uuid",
        "device_id",
        "client_seq",
        "op_type",
        "payload",
        "client_ts",
        "result",
        "error_code",
      ],
      ops,
    );
    await bulk(
      "review_queue_item",
      ["org_id", "kind", "ref_type", "ref_id", "payload"],
      [1, 2, 3].map((i) => [
        S.org,
        "offline_op",
        "user",
        S.staff[3].id,
        JSON.stringify({
          reason: "user was removed while offline",
          op: "sale",
          product_id: stocked[i],
          qty: i,
        }),
      ]),
    );
  }
  {
    // discrepancy review items for negative stock
    const rows = (
      await q(
        "SELECT b.org_id, b.branch_id, b.product_id, b.on_hand FROM inventory_balance b WHERE b.discrepancy ORDER BY b.org_id, b.product_id LIMIT 30",
      )
    ).rows;
    await bulk(
      "review_queue_item",
      ["org_id", "kind", "ref_type", "ref_id", "payload"],
      rows.map((r) => [
        r.org_id,
        "discrepancy",
        "product",
        r.product_id,
        JSON.stringify({ branch_id: r.branch_id, on_hand: Number(r.on_hand) }),
      ]),
    );
  }

  // ------------------------------------------------------------ 6. billing, audit, notifications, reports
  for (const o of ORGS) {
    const st = E[o.key];
    await q(
      "INSERT INTO subscription (org_id, plan_id, status, billing_cycle, current_period_start, current_period_end, trial_ends_at, grace_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        st.org,
        o.plan,
        o.sub,
        o.plan === "premium" ? (o.cycle ?? "monthly") : null,
        ago(24 * 12),
        new Date(T0 + 24 * H * 18),
        o.sub === "trialing" ? new Date(T0 + 24 * H * 9) : null,
        o.sub === "grace" ? new Date(T0 + 24 * H * 4) : null,
      ],
    );
  }
  for (const [k, n, paid] of [
    ["sharma", 3, true],
    ["khan", 1, true],
    ["cityhw", 1, false],
  ])
    for (let i = 0; i < n; i++) {
      // MOCK amounts: real prices are undecided (D-22)
      const when = ago(24 * (30 * (n - i) - 5)),
        no = (await one("SELECT next_invoice_number($1) AS n", [when])).n;
      const inv = (
        await one(
          "INSERT INTO invoice (org_id, number, status, subtotal_paise, gst_rate_bp, gst_paise, total_paise, customer_gstin, place_of_supply, sac, issued_at) VALUES ($1,$2,$3,49900,1800,8982,58882,$4,'29-Karnataka','998314',$5) RETURNING id",
          [E[k].org, no, paid ? "paid" : "issued", E[k].cfg.gstin, when],
        )
      ).id;
      await q(
        "INSERT INTO payment (org_id, invoice_id, gateway, gateway_order_id, gateway_payment_id, amount_paise, status, method, created_at, captured_at) VALUES ($1,$2,'razorpay_mock',$3,$4,58882,$5,'upi',$6,$7)",
        [
          E[k].org,
          inv,
          `order_mock_${k}_${i}`,
          paid ? `pay_mock_${k}_${i}` : null,
          paid ? "captured" : "failed",
          when,
          paid ? when : null,
        ],
      );
    }
  await q(
    "INSERT INTO invitation (org_id, phone_e164, role_code, branch_ids, token_hash, invited_by) VALUES ($1,'+919000199999','inventory_operator',$2,'mock-token-hash',$3)",
    [S.org, [sb1], S.owner],
  );
  await q(
    "INSERT INTO api_key (org_id, name, prefix, secret_hash, scopes, created_by) VALUES ($1,'POS sync (mock)','idea_mock_0001','mock-secret-hash','{stock:write}',$2)",
    [S.org, S.owner],
  );
  const acts = [
    "login.new_device",
    "role.changed",
    "publication.changed",
    "import.applied",
    "movement.reversed",
    "export.requested",
    "staff.removed",
    "branch.updated",
  ];
  await bulk(
    "audit_event",
    ["org_id", "actor_user_id", "action", "meta", "at"],
    Object.values(E).flatMap((st, i) =>
      Array.from({ length: 5 }, (_, k) => [
        st.org,
        st.owner,
        acts[(i + k * 3) % acts.length],
        JSON.stringify({ mock: true }),
        ago(k * 40 + i),
      ]),
    ),
  );
  await bulk(
    "notification",
    ["org_id", "user_id", "type", "title", "body", "read_at"],
    Object.values(E).flatMap((st) => [
      [
        st.org,
        st.owner,
        "low_stock",
        "Low stock on 12 items",
        "Review items at or below their threshold.",
        null,
      ],
      [
        st.org,
        st.owner,
        "discrepancy",
        "Negative stock needs attention",
        "Some items show negative stock after sales.",
        null,
      ],
      [
        st.org,
        st.owner,
        "report_received",
        "A shopper reported an inaccurate listing",
        "Open the report to fix or dispute it.",
        ago(20),
      ],
    ]),
  );

  // ------------------------------------------------------------ 7. project to public listings, then consumer-side data
  await q("SELECT refresh_public_listing(branch_id, product_id) FROM merchant_listing");
  const pubs = (
    await q("SELECT branch_id, product_id, org_id FROM public_listing ORDER BY org_id, product_id")
  ).rows;
  const byOrg = (k) => pubs.filter((x) => x.org_id === E[k].org);
  const rep = ["sharma", "gupta", "patel", "mobilezone", "khan"].flatMap((k, i) =>
    byOrg(k)
      .slice(i * 3, i * 3 + 3)
      .map((x, j) => [k, x, ["not_available", "wrong_price", "shop_closed", "wrong_info"][(i + j) % 4]]),
  );
  await bulk(
    "inaccuracy_report",
    ["org_id", "branch_id", "product_id", "consumer_id", "type", "status", "merchant_note", "created_at"],
    rep.map(([k, x, type], i) => [
      E[k].org,
      x.branch_id,
      x.product_id,
      consumers[i % 5],
      type,
      ["open", "open", "fixed", "disputed", "open"][i % 5],
      i % 5 === 3 ? "Item was in stock when checked" : null,
      ago(i * 9 + 2),
    ]),
  );
  await q(`INSERT INTO listing_event_daily (day, org_id, branch_id, product_id, views, calls, directions, whatsapp)
           SELECT d::date, p.org_id, p.branch_id, p.product_id, 1 + h % 40, h % 5, h % 4, h % 3
           FROM public_listing p, generate_series(current_date - 13, current_date, interval '1 day') d,
                LATERAL (SELECT abs(hashtext(p.branch_id::text || p.product_id::text || d::text)) AS h) x
           WHERE x.h % 11 = 0`);
  await bulk(
    "favourite",
    ["consumer_id", "branch_id", "product_id"],
    consumers.flatMap((u, i) => pubs.slice(i * 40, i * 40 + 4).map((x) => [u, x.branch_id, x.product_id])),
  );

  await q("COMMIT");
  console.log(
    `seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${ORGS.length} shops, ${Object.values(E).reduce((a, s) => a + s.branches.length, 0)} branches, ${productTotal} products, ${movements} ledger movements`,
  );
  Object.assign(globalThis, { __seed: { E, SC, productTotal, movements, listings, consumers } });
} catch (e) {
  await q("ROLLBACK");
  throw e;
}

// ---------------------------------------------------------------- verification + MOCK_DATA.md
const { E, SC, productTotal, movements } = globalThis.__seed;
const drift = Number((await one("SELECT count(*) AS n FROM v_balance_drift")).n);
const labels = (
  await q(
    "SELECT availability_label(base_status, last_verified_at, ttl_seconds, discrepancy, branch_synced_at) AS lbl, count(*)::int AS n FROM public_listing GROUP BY 1 ORDER BY 2 DESC",
  )
).rows;
const cnt = async (sql) => Number((await one(sql)).n);
const stats = {
  public: await cnt("SELECT count(*) AS n FROM public_listing"),
  balances: await cnt("SELECT count(*) AS n FROM inventory_balance"),
  neg: await cnt("SELECT count(*) AS n FROM inventory_balance WHERE discrepancy"),
  restricted: await cnt(
    "SELECT count(*) AS n FROM product p JOIN category c ON c.id = p.category_id WHERE c.restricted",
  ),
  restrictedPublic: await cnt(
    "SELECT count(*) AS n FROM public_listing pl JOIN category c ON c.id = pl.category_id WHERE c.restricted",
  ),
  hi: await cnt("SELECT count(*) AS n FROM product WHERE name_hi IS NOT NULL"),
  barcodes: await cnt("SELECT count(*) AS n FROM product_identifier WHERE kind = 'barcode'"),
};
const perOrg = (
  await q(`SELECT o.name, (SELECT count(*) FROM branch b WHERE b.org_id = o.id)::int AS branches, (SELECT count(*) FROM product p WHERE p.org_id = o.id)::int AS products,
  (SELECT count(*) FROM public_listing l WHERE l.org_id = o.id)::int AS public_listings, o.status, s.plan_id, s.status AS sub_status
  FROM organization o JOIN subscription s ON s.org_id = o.id ORDER BY o.created_at`)
).rows;
const ex = async (where, n = 3) =>
  (
    await q(
      `SELECT shop_name || ' — ' || branch_name AS shop, product_name FROM public_listing WHERE ${where} ORDER BY product_id LIMIT ${n}`,
    )
  ).rows
    .map((r) => `${r.product_name} @ ${r.shop}`)
    .join("; ");
const exCsv = async () =>
  (
    await q(
      `SELECT pl.shop_name || ' — ' || pl.branch_name AS shop, pl.product_name FROM public_listing pl JOIN inventory_balance ib USING (branch_id, product_id) WHERE ib.last_source = 'csv' ORDER BY pl.product_id LIMIT 3`,
    )
  ).rows
    .map((r) => `${r.product_name} @ ${r.shop}`)
    .join("; ");
const ex2 = async (lbl, n = 2) =>
  (
    await q(
      `SELECT shop_name || ' — ' || branch_name AS shop, product_name FROM public_listing WHERE availability_label(base_status, last_verified_at, ttl_seconds, discrepancy, branch_synced_at) = '${lbl}' AND NOT discrepancy AND branch_synced_at IS NULL ORDER BY product_id LIMIT ${n}`,
    )
  ).rows
    .map((r) => `${r.product_name} @ ${r.shop}`)
    .join("; ");

const md = `# Mock data (generated by \`db/seeds/seed.mjs\`)

> **All shops, people, phone numbers, GSTINs, barcodes, prices and invoices are fictional.** Pilot city is undecided (D-23); a Bengaluru cluster is used only so distance search has realistic coordinates. Invoice amounts are placeholders because plan prices are undecided (D-22).
> Regenerate: \`pnpm db:seed\` (wipes all tenant data; keeps reference data). Deterministic: same input gives the same shops and products.

## Totals
| Item | Count |
|---|---|
| Shops (organisations) | ${ORGS.length} |
| Branches | ${perOrg.reduce((a, r) => a + r.branches, 0)} |
| Products (English + Hindi names) | ${productTotal} (${stats.hi} with Hindi names, ${stats.barcodes} barcodes) |
| Inventory balances | ${stats.balances} (negative-stock flagged: ${stats.neg}) |
| Ledger movements | ${movements} (+ counts, transfers, reversals) |
| Public listings | ${stats.public} |
| Restricted (pharmacy) products | ${stats.restricted} stocked, **${stats.restrictedPublic} public** |
| Balance vs ledger drift | ${drift} (must be 0) |

## Shops
| Shop | Branches | Products | Public listings | Org status | Plan | Subscription |
|---|---|---|---|---|---|---|
${perOrg.map((r) => `| ${r.name} | ${r.branches} | ${r.products} | ${r.public_listings} | ${r.status} | ${r.plan_id} | ${r.sub_status} |`).join("\n")}

## Logins (OTP-only; in dev the mock OTP provider prints the code in the API log)
| Role | Phone |
|---|---|
${ORGS.map((o) => `| Owner — ${o.name} | ${o.owner[1]} |`).join("\n")}
${ORGS.flatMap((o) => o.staff.map((s) => `| ${s[2]} — ${o.name}${s[4] ? " (removed)" : ""} | ${s[1]} |`)).join("\n")}
${CONSUMERS.map(([n, p, l]) => `| Consumer ${n} (${l}) | ${p} |`).join("\n")}

## Public label distribution (right now)
| Label | Listings |
|---|---|
${labels.map((l) => `| ${l.lbl} | ${l.n} |`).join("\n")}

## Scenarios to test (where to find them)
| Scenario | What it shows | Example |
|---|---|---|
| Fresh, available | green label, "updated Xh ago" | ${await ex2("available")} |
| Limited stock | at or below the low-stock threshold | ${await ex2("limited_stock")} |
| Out of stock | trusted zero | ${await ex2("out_of_stock")} |
| Negative stock (D-01) | sale recorded at zero stock → flagged, public "check with shop", discrepancy review item | ${await ex("discrepancy")} |
| Stale native update (>24h) | label degrades to "check with shop" | ${await ex2("check_with_shop")} |
| CSV-sourced stock (72h TTL) | fresh vs stale CSV imports | ${await exCsv()} |
| Status-only products | "mark in/out of stock" tracking (Patel Stationers, Lakshmi Book & Stationery) | ${SC.status_only_in + SC.status_only_out + SC.status_only_stale} status-only balances |
| Offline branch (FR-OFF-06) | City Hardware Mart not synced for 30h → everything "check with shop" | ${await ex("shop_name LIKE 'City Hardware%' AND branch_synced_at < now() - interval '24 hours'", 2)} |
| Branch closed today | Khan — Shanti Nagar | branch_open_state = closed |
| Hours not verified | Raj Traders (and its org is read-only, so nothing is public) | open state "unknown" |
| Unpublished branch | Patel Stationers — Banashankari (new) has listings but is hidden | not in search |
| Read-only org (lapsed subscription) | Raj Traders: data kept, no public listings, no paid features | status read_only |
| Subscription grace | City Hardware Mart: unpaid invoice, failed payment | status grace |
| Trial | Patel Stationers premium trial | status trialing |
| Restricted category | pharmacy products stocked, never public (D-04) | ${stats.restricted} products, 0 public |
| Price rules (D-10) | some prices hidden, some older than 14 days (hidden at read time) | search with price shown / hidden |
| Merge candidates | 6 near-duplicate products in Sharma Hardware with " (dup)" in the name | FR-CAT-09 |
| Same barcode, two shops | barcode 8901234500001 in Sharma and City Hardware (different products) | docs/01 C1 |
| Inventory count | one finalized (counted in the past, sales not frozen), one open draft | Sharma, Jayanagar 4th Block |
| Transfers | one in transit, one received with a shortage | Sharma, Jayanagar → JP Nagar |
| Reversals | 3 reversed sale movements | Sharma |
| Imports | one applied (Gupta, 120 rows), one needing review with errors and unknown codes (Raj) | FR-IMP |
| Offline sync log | applied / duplicate / rejected / needs review / blocked ops; 3 ops from a removed staff member in the review queue (D-02) | Sharma |
| Inaccuracy reports | open, fixed, disputed | five shops |
| Notifications, audit events, interest counters (14 days), favourites | for dashboards and lists | all shops |

## Try the search (demo point: 12.9352, 77.5806, radius 6 km)
\`\`\`sql
SELECT shop_name, branch_name, product_name, distance_m, label, price_paise, open_state
FROM search_listings('pankha', 12.9352, 77.5806, 6000);          -- Hinglish
SELECT product_name, label FROM search_listings('पंखा', 12.9352, 77.5806, 6000);   -- Hindi
SELECT product_name, label FROM search_listings('led bulb 9w', 12.9352, 77.5806, 6000);
\`\`\`
Run with \`pnpm db:psql\`.
`;
await writeFile(path.join(here, "MOCK_DATA.md"), md, "utf8");
console.log(
  `verification: drift rows = ${drift}; public listings = ${stats.public}; restricted public = ${stats.restrictedPublic}`,
);
console.log(labels.map((l) => `${l.lbl}=${l.n}`).join("  "));
await c.end();
