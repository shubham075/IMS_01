// Runs the schema tests against a throwaway database (idea01_test), created fresh from the migrations every time,
// so tests never touch the seeded dev database.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = process.env.PG_SERVER_URL ?? "postgres://postgres:postgres@localhost:5432";
const name = "idea01_test";
const admin = new pg.Client({ connectionString: `${server}/postgres` });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${name}`);
await admin.end();

const env = {
  ...process.env,
  DATABASE_ADMIN_URL: `${server}/${name}`,
  DATABASE_URL: `postgres://idea01_app:idea01_app_dev@localhost:5432/${name}`,
};
const run = (args) => spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" }).status ?? 1;
if (run(["migrate.mjs"]) !== 0) process.exit(1);
process.exit(run(["--test", "--test-concurrency=1", "tests/schema.test.mjs"]));
