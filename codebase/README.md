# Idea01 codebase

Monorepo for Release 1. Product docs are in `../docs/`; design in `../Backend_System_Design.md`; stack choices in `STACK.md`.

```
apps/api            NestJS API + worker
apps/web-merchant   Merchant web (first web app)
apps/web-consumer   Consumer web
apps/mobile         Expo app(s)
packages/schemas    Shared Zod schemas
packages/api-client Typed client generated from OpenAPI
packages/ui         Shared UI + clay design tokens
db/migrations       Plain SQL migrations
db/seeds            Mock-data seed (Indian local shops)
```

## First run
```bash
pnpm install
cp .env.example .env
pnpm infra:up      # Postgres+PostGIS, Redis, MinIO (Docker Desktop must be running)
pnpm db:reset      # apply migrations from scratch (dev only)
pnpm db:seed       # load mock data (8 shops, ~2,100 products, edge cases); see db/seeds/MOCK_DATA.md
pnpm db:test       # 25 schema tests on a throwaway database
pnpm db:psql       # SQL shell (psql runs inside the container)
```
