# Stack decisions (Release 1)

Chosen for this product's needs (see `../docs/FRD.md`, `../Backend_System_Design.md`). Versions are pinned by the lockfile when each package is created; don't copy versions from here.

| Need | Choice | Why |
|---|---|---|
| Monorepo | **pnpm workspaces + Turborepo** | One repo for API, 2 web apps, mobile, shared packages; cached builds |
| Language | **TypeScript (strict)** everywhere | One language, shared types across backend, web, mobile |
| Backend | **NestJS (Fastify adapter)** | Modular monolith (BSD B1); DI and guards fit RBAC/tenancy |
| Validation + API contract | **Zod** (shared in `packages/schemas`) → **OpenAPI** | One schema validates requests and generates the spec and typed clients |
| DB access | **Kysely** (typed SQL) + **plain SQL migrations** | Row-Level Security, partitions, PostGIS, `FOR UPDATE` are awkward in ORMs; the ledger needs exact SQL |
| Database | **PostgreSQL 17 + PostGIS** (Docker locally) | Ledger, geo search, FTS, RLS (BSD B5/B6) |
| Fuzzy/Hindi search | `pg_trgm` + `unaccent` + synonym table | Typo and transliteration search without a search engine (D-18) |
| Queue / cache | **BullMQ + Redis** | Outbox consumers, imports, notifications, rate limits |
| Auth | **jose** (JWT) + **argon2** + OTP provider interface | No vendor lock-in; OTP provider swappable; mock OTP in dev |
| Logging / errors | **pino** + RFC 7807 filter | Structured logs without PII (NFR-09) |
| Files | S3 API; **MinIO** locally | Imports, images; same code in prod (AWS S3) |
| Web apps | **Next.js (App Router) + React** | Consumer SEO (SSR); merchant dashboard |
| Styling | **Tailwind CSS** with the "flat bold" design tokens (`packages/ui/src/tokens.css`) | Exactly 4 colours: #242424 #F2F2E8 #DFFF00 #9B9E95 (`design/DESIGN_SYSTEM.md`) |
| Data fetching | **TanStack Query** + **openapi-fetch** (typed from the spec) | Caching, offline-friendly, no hand-written clients |
| Forms | **react-hook-form + Zod** | Same schemas as the backend |
| i18n | **next-intl** (web), **i18next** (mobile) | EN + HI from day one (D-20) |
| Mobile | **Expo (React Native) + expo-router** | iOS+Android from one codebase; EAS cloud builds cover iOS from Windows |
| Mobile offline | **expo-sqlite** (queue + catalogue cache), **expo-camera** (barcode), **expo-secure-store** | Offline-first merchant app (FR-OFF) |
| Tests | **Vitest** (unit/integration), **Playwright** (web e2e) | One runner for TS; real Postgres in Docker for integration |
| Lint/format | **Biome** | One fast tool instead of ESLint + Prettier |
| Mock data | **@faker-js/faker** (`en_IN`) + hand-written Indian shop catalogue | Realistic seed incl. stale/negative-stock cases |
| CI | **GitHub Actions** | Lint, test, migration check |

## Deliberately not used (yet)
GraphQL, Prisma/TypeORM (RLS/partition friction), microservices, Kafka, Elasticsearch/Meilisearch (Postgres is enough until ~1M listings), Redux, Firebase Auth, Kubernetes.

## Tools on this machine
Docker Desktop, Node, pnpm, Git, Python (docs build), NestJS CLI and EAS CLI (global). **`psql` is not installed on Windows** (installer download blocked); use the one inside the Postgres container: `docker compose exec db psql -U postgres idea01` (via `pnpm db:psql`).
