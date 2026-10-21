import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

/** Builds a fresh `idea01_test` database from the SQL migrations before the suite runs, so tests also prove the migrations apply. */
export default async function setup() {
  const server = process.env.PG_SERVER_URL ?? "postgres://postgres:postgres@localhost:5432";
  const admin = new pg.Client({ connectionString: `${server}/postgres` });
  await admin.connect();
  await admin.query("DROP DATABASE IF EXISTS idea01_test WITH (FORCE)");
  await admin.query("CREATE DATABASE idea01_test");
  await admin.end();

  const dbDir = path.resolve(__dirname, "../../../db");
  const res = spawnSync(process.execPath, ["migrate.mjs"], {
    cwd: dbDir,
    env: { ...process.env, DATABASE_ADMIN_URL: `${server}/idea01_test` },
    stdio: "inherit",
  });
  if (res.status !== 0) throw new Error("migrations failed for the test database");
}
