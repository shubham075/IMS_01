# Idea01 codebase

The full setup guide (install, database, running, tests, troubleshooting) is in the repository's top-level [README](../README.md).

Quick start from this folder:

```bash
corepack enable && pnpm install
cp .env.example .env
pnpm infra:up      # Docker Desktop must be running
pnpm db:reset      # create the database tables
pnpm db:seed       # optional demo data (logins in db/seeds/MOCK_DATA.md)
pnpm dev           # API http://localhost:3001, web http://localhost:3000 (OTP: 123456)
```

Layout: `apps/api`, `apps/web-merchant`, `packages/schemas`, `packages/api-client`, `packages/ui`, `db/`. Stack choices: `STACK.md`.
