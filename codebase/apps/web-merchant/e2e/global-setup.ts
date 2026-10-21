import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

/** A fresh `idea01_e2e` database, built from the real SQL migrations, before every end-to-end run. */
export default async function globalSetup() {
  const server = process.env.PG_SERVER_URL ?? "postgres://postgres:postgres@localhost:5432";
  const admin = new pg.Client({ connectionString: `${server}/postgres` });
  await admin.connect();
  await admin.query("DROP DATABASE IF EXISTS idea01_e2e WITH (FORCE)");
  await admin.query("CREATE DATABASE idea01_e2e");
  await admin.end();

  const dbDir = path.resolve(__dirname, "../../../db");
  const res = spawnSync(process.execPath, ["migrate.mjs"], {
    cwd: dbDir,
    env: { ...process.env, DATABASE_ADMIN_URL: `${server}/idea01_e2e` },
    stdio: "inherit",
  });
  if (res.status !== 0) throw new Error("migrations failed for the e2e database");

  // A few shared-catalogue products so the "add from catalogue" journey has something to find.
  const db = new pg.Client({ connectionString: `${server}/idea01_e2e` });
  await db.connect();
  await db.query(`INSERT INTO canonical_product (name, brand, barcode, category_id)
    SELECT v.name, v.brand, v.barcode, (SELECT id FROM category WHERE slug = 'hardware')
    FROM (VALUES ('Claw hammer 500g', 'Taparia', '8900000000101'), ('Screwdriver set 6pc', 'Taparia', '8900000000102'),
                 ('Measuring tape 5m', 'Stanley', '8900000000103')) AS v(name, brand, barcode)`);
  await db.end();
}
