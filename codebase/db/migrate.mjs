// Minimal SQL migration runner: applies db/migrations/*.sql in order, each in its own transaction.
//   node migrate.mjs            apply pending migrations
//   node migrate.mjs --reset    DROP and recreate the public schema first (local dev / tests only)
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const adminUrl = process.env.DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/idea01";

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  if (process.argv.includes("--reset")) {
    if (/prod/i.test(adminUrl)) throw new Error("refusing to reset a production-looking database");
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres;");
    console.log("schema reset");
  }
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    process.stdout.write(`applying ${file} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log("ok");
    } catch (e) {
      await client.query("ROLLBACK");
      console.log("FAILED");
      throw e;
    }
  }
  console.log("migrations up to date");
} finally {
  await client.end();
}
