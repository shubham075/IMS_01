# Idea01 — local commerce + cloud inventory (India)

A B2B cloud-inventory SaaS for small shops, plus a B2C "find it nearby" marketplace. One backend (NestJS + PostgreSQL) serves the web apps today and the mobile apps later.

**What is built and runnable now (merchant web + API):**

| Area | What it does |
|---|---|
| Sign-in | Phone number + OTP (mock OTP in development), sessions with silent refresh, English and Hindi UI |
| Shop setup | Create a shop, branches with a map pin and opening hours, team members with roles and branch limits |
| Catalogue | Pick from a shared catalogue or add your own products, barcodes and codes, prices, units, switch on/off |
| Stock | Stock in/out/adjust through an append-only ledger, low-stock warnings, negative stock allowed and flagged, history, undo |
| Go live | Show products to shoppers per branch, then take the branch live (needs pin, hours, one product) |
| Transfers | Move stock between branches: draft, send, receive, shortages written off |
| Import | CSV import of products with opening stock (preview, apply, undo) |
| Scan & count | Barcode lookup (camera or typed or USB scanner), quick sold/received, stock counts |

Not built yet: the consumer web app, mobile apps, offline sync, reservations/payments/delivery (deferred).

---

## 1. What you need installed

| Tool | Version | Check with | Get it |
|---|---|---|---|
| Node.js | 22 or newer (24 works) | `node -v` | https://nodejs.org |
| pnpm | 12.8.1 (the repo pins it) | `pnpm -v` | `corepack enable` then it installs the pinned version, or `npm i -g pnpm@12.8.1` |
| Docker Desktop | any recent | `docker -v` and `docker compose version` | https://www.docker.com/products/docker-desktop (must be **running**) |
| Git | any | `git --version` | https://git-scm.com |

Windows, macOS and Linux all work. On Windows use PowerShell or Git Bash; every command below is the same in both.

Free ports needed: **3000** (web), **3001** (API), **5432** (Postgres), **6379** (Redis), **9000/9001** (MinIO). For browser tests also **3100** and **3101**.

---

## 2. First-time setup (copy and run, in this order)

All commands run from the `codebase` folder.

```bash
git clone https://github.com/shubham075/IMS_01.git
cd IMS_01/codebase
```

**Step 1. Install dependencies**
```bash
corepack enable        # once per machine; skip if pnpm 12.8.1 is already installed
pnpm install
```

**Step 2. Create your environment file**
```bash
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```
The defaults work as they are for local development. Nothing in `.env.example` is a real secret.

**Step 3. Start the database and other services (Docker)**
```bash
pnpm infra:up
```
This starts PostgreSQL 17 with PostGIS (port 5432), Redis (6379) and MinIO (9000, console 9001) and waits until they are healthy.

**Step 4. Create the database tables**
```bash
pnpm db:reset
```
This (re)builds the `idea01` database from the SQL files in `db/migrations/` (0001 to 0007). It is safe on a new machine. **It wipes all data**, so use `pnpm db:migrate` instead if you only want to apply new migrations.

**Step 5. (Optional but recommended) Load demo data**
```bash
pnpm db:seed
```
Loads 8 fictional Indian shops, 12 branches, about 2,100 bilingual products, stock history, and edge cases (negative stock, a lapsed subscription, an offline shop). The logins are listed in `db/seeds/MOCK_DATA.md`. It is deterministic: running it again gives the same data.

**Step 6. Build the shared packages and start the apps**
```bash
pnpm dev
```
`pnpm dev` first builds the two shared packages (`@idea01/schemas`, `@idea01/api-client`), then starts:

| App | URL |
|---|---|
| Merchant web | http://localhost:3000 |
| API | http://localhost:3001 (health: http://localhost:3001/healthz) |
| API documentation (OpenAPI) | http://localhost:3001/docs (if enabled) and `apps/api/openapi/openapi.json` |

**Step 7. Sign in**

Open http://localhost:3000 and enter a phone number.

- **Mock OTP:** the code is always **`123456`** in development (`OTP_MOCK_FIXED_CODE` in `.env`). The login screen also prints a hint.
- **With demo data (Step 5):** sign in as `9000000001` (owner of "Sharma Hardware & Paints"). Other demo logins: see `db/seeds/MOCK_DATA.md` (owners `9000000001`–`9000000008`, a branch manager `9000100001`, a stock keeper `9000100002`, a sales person `9000100003`, an auditor `9000100007`).
- **Without demo data:** use any valid 10-digit Indian mobile number starting with 6–9 (for example `9876543210`). You are taken through "create your shop" and "add your branch".

To stop everything: press `Ctrl+C` in the terminal running `pnpm dev`, then `pnpm infra:down` to stop the Docker services (data is kept in Docker volumes; `docker compose down -v` also deletes the data).

---

## 3. Everyday commands

Run from `codebase/`.

| What | Command |
|---|---|
| Start database services | `pnpm infra:up` |
| Stop database services | `pnpm infra:down` |
| Start API and web together | `pnpm dev` |
| Start only the API | `pnpm dev:api` |
| Start only the merchant web | `pnpm dev:web` (needs the API running) |
| Apply new migrations | `pnpm db:migrate` |
| Rebuild the database from scratch (wipes data) | `pnpm db:reset` |
| Reload demo data | `pnpm db:seed` |
| SQL shell into the dev database | `pnpm db:psql` (runs `psql` inside the container) |
| Lint and format check | `pnpm lint` (fix with `pnpm format`) |
| Type-check everything | `pnpm typecheck` |
| Production build | `pnpm build` |
| Regenerate the API spec and typed client after changing API routes | `pnpm openapi` |

Two terminals instead of `pnpm dev`:
```bash
pnpm dev:api     # terminal 1
pnpm dev:web     # terminal 2
```

---

## 4. Database setup in detail

**Engine:** PostgreSQL 17 + PostGIS 3.5 (image `postgis/postgis:17-3.5`), started by `docker-compose.yml`.

**Databases (all on `localhost:5432`):**

| Database | Used for | Created by |
|---|---|---|
| `idea01` | development (what `pnpm dev` uses) | Docker (`POSTGRES_DB`) + `pnpm db:reset` |
| `idea01_test` | API and database tests | dropped and rebuilt automatically at the start of every test run |
| `idea01_e2e` | browser (Playwright) tests | dropped and rebuilt automatically at the start of every e2e run |

**Two database users:**

| User | Password | Why |
|---|---|---|
| `postgres` (superuser) | `postgres` | Only for migrations, seeding and test setup (`DATABASE_ADMIN_URL`). |
| `idea01_app` (normal user) | `idea01_app_dev` | What the API connects as (`DATABASE_URL`). It is **not** a superuser and cannot bypass row-level security, so one shop can never read another shop's rows. Created by migration `0001`. |

**Migrations:** plain SQL files in `db/migrations/`, applied in file-name order, each in its own transaction, recorded in the `schema_migrations` table.

| File | Contents |
|---|---|
| `0001_core.sql` | extensions (PostGIS, trigram, unaccent), app role, helpers, row-level-security function |
| `0002_identity.sql` | users, sessions, OTP, organisations, branches, roles and permissions, invitations |
| `0003_catalogue_inventory.sql` | categories, products, identifiers, the stock ledger, balances, counts, transfers |
| `0004_publication_search.sql` | what shoppers see: listings, availability labels, search |
| `0005_sync_notify_billing.sql` | imports, review queue, offline sync log, notifications, billing |
| `0006_invitee_access.sql` | lets an invited person see and answer their own invitation |
| `0007_transfer_note.sql` | optional note on a branch transfer |

Commands: `pnpm db:migrate` (apply pending), `pnpm db:reset` (drop the `public` schema and re-apply everything; refuses a URL that looks like production).

**Row-level security:** every table that belongs to a shop is filtered by the shop the request is acting for (`app.org_id`, set per transaction by the API). The database tests (`pnpm db:test`) prove this.

**Looking inside:** `pnpm db:psql`, then for example `\dt` (tables), `select count(*) from product;`, `\q` to leave. A GUI such as DBeaver or pgAdmin also works: host `localhost`, port `5432`, database `idea01`, user `postgres`, password `postgres`.

**Starting over completely (deletes everything in Docker volumes):**
```bash
pnpm infra:down
docker compose down -v
pnpm infra:up
pnpm db:reset
pnpm db:seed
```

**Using your own PostgreSQL instead of Docker:** it needs PostGIS 3.x. Create a database `idea01`, then set `DATABASE_ADMIN_URL` (superuser) and `DATABASE_URL` (the `idea01_app` role, created by migration 0001) in `.env`, and set `PG_SERVER_URL` (superuser, no database name) for tests.

---

## 5. Tests

All commands run from `codebase/` and need the Docker services up (`pnpm infra:up`).

| What | Command | Notes |
|---|---|---|
| Database schema tests | `pnpm db:test` | 25 tests on a throwaway database |
| API tests | `pnpm --filter @idea01/api test` | about 220 tests against a real database, including attack scenarios (races, tampering, hostile input) |
| Shared schema tests | `pnpm --filter @idea01/schemas test` | |
| Web unit tests | `pnpm --filter @idea01/web-merchant test` | translations, helpers, colour palette |
| Everything except browser tests | `pnpm test` | runs through Turborepo |
| Browser tests (Playwright) | see below | real browser, real API, real database |

**Browser tests (first time):**
```bash
pnpm --filter @idea01/web-merchant e2e:install     # downloads Chromium once
pnpm --filter @idea01/web-merchant e2e             # about 7 minutes for the full suite
```
They build the web app for production into `.next-e2e`, start their own API on port **3101** and web on port **3100** against the database `idea01_e2e`, so you can keep `pnpm dev` running. Run one file: `pnpm --filter @idea01/web-merchant exec playwright test e2e/stock.spec.ts`. Failure screenshots and traces go to `apps/web-merchant/test-results/`.

---

## 6. Project layout

```
codebase/
  apps/api              NestJS API (Fastify, Kysely, Zod); src/<module>/ per feature; test/ integration tests
  apps/web-merchant     Next.js 16 merchant web app (App Router, server actions, next-intl EN/HI); e2e/ Playwright tests
  packages/schemas      Zod schemas shared by API and web (validation, types, error codes)
  packages/api-client   Typed API client generated from the OpenAPI spec
  packages/ui           Design tokens (4-colour "flat bold" style)
  db/migrations         SQL migrations
  db/seeds              Demo-data generator and MOCK_DATA.md
  db/tests              Database tests
docs/                   Requirements (FRD), decisions log, exception handling, ERD, slice design notes
design/                 Design system and clickable prototypes
review/                 Review hub (static HTML) for teammates
```

Start with `docs/README.md` for the documentation index, `codebase/STACK.md` for technology choices, `codebase/SLICE-1.md` and `docs/06_Slice2_Design.md` for what each slice delivers, its rules and its known gaps.

---

## 7. Environment variables

Copy `codebase/.env.example` to `codebase/.env`. The most useful ones:

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgres://idea01_app:idea01_app_dev@localhost:5432/idea01` | API connection (non-superuser) |
| `DATABASE_ADMIN_URL` | `postgres://postgres:postgres@localhost:5432/idea01` | migrations and seeding |
| `API_PORT` | `3001` | API port |
| `API_URL` | `http://localhost:3001` | where the web app reaches the API |
| `CORS_ORIGINS` | `http://localhost:3000` | allowed browser origins |
| `OTP_PROVIDER` | `mock` | `mock` only (refused in production) |
| `OTP_MOCK_FIXED_CODE` | `123456` | every OTP in development; empty = random codes printed in the API log |
| `NEXT_PUBLIC_SHOW_DEV_OTP_HINT` | `true` | shows the code on the login screen (development only) |
| `NEXT_PUBLIC_MAP_TILE_URL` | OpenStreetMap | map tiles for the location picker (use a commercial provider before launch) |
| `JWT_SECRET`, `OTP_HMAC_SECRET` | dev values | **must be changed** for anything other than local development |

`.env` is ignored by Git. `.env.test` (committed) holds test-only values.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot connect to the Docker daemon` / `infra:up` fails | Start Docker Desktop and wait until it says "running", then `pnpm infra:up` again |
| `port is already allocated` (5432, 6379, 9000) | Another program uses it. Stop it, or stop a local PostgreSQL service, then `pnpm infra:up` |
| `EADDRINUSE` on 3000 or 3001 | Another dev server is running. Close it, or on Windows find it with `netstat -ano \| findstr :3001` |
| `Cannot find module '@idea01/schemas'` | The shared packages are not built: `pnpm --filter @idea01/schemas build && pnpm --filter @idea01/api-client build` (or just run `pnpm dev`, which does it) |
| `password authentication failed for user "idea01_app"` | The database was not migrated: `pnpm db:reset` |
| Login says "No internet connection" | The API is not running or not reachable on port 3001: check the API terminal and http://localhost:3001/healthz |
| OTP rejected | In development the code is `123456`. A new code can be requested after 30 seconds; after 5 wrong tries ask for a new code |
| pnpm refuses to run install scripts | `pnpm-workspace.yaml` already allows the needed ones (swc, esbuild). If it asks, approve with `pnpm approve-builds` |
| Browser tests: `ERR_CONNECTION_REFUSED` or database errors | Make sure Docker is up and nothing else uses ports 3100/3101; delete `apps/web-merchant/.next-e2e` and run again |
| `psql` not found | Not needed: use `pnpm db:psql` (it runs inside the Docker container) |
| Map does not show tiles | You are offline or the tile server is blocked; set `NEXT_PUBLIC_MAP_TILE_URL` to another provider |

---

## 9. Safety notes

- Everything in the demo data (shops, people, phone numbers, GSTINs, barcodes) is fictional.
- Development passwords and secrets in `.env.example` are for local use only.
- Never run `pnpm db:reset` against a database you care about; it deletes all tables.
- The OTP provider is a mock. A real SMS/WhatsApp provider must be added before any public launch.
