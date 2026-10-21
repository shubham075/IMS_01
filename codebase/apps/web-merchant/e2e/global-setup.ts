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
}
