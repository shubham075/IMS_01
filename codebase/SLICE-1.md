# Slice 1 — Login + shop setup (merchant web)

**Done:** phone OTP sign-in (mock provider), create shop, add branch (map pin, hours), roles and invitations, invitee join/decline, EN/HI UI, silent token refresh, RLS-backed multi-tenancy, OpenAPI + typed client.

## Run
- `pnpm infra:up && pnpm db:reset` then `pnpm dev` (API :3001, web :3000). Mock OTP code: `123456`.
- Tests: `pnpm db:test`, API/web/schemas via `pnpm test`, browser journeys via `pnpm --filter web-merchant e2e` (own DB `idea01_e2e`, ports 3100/3101; first time `e2e:install`).
- `pnpm openapi` regenerates the spec and typed client.

## Known limitations
- D-08 (re-verify after 90 days idle / new device second factor) not implemented.
- Proxy refresh de-duplication is per process; API throttle is in-memory (single instance) — move to Redis before scaling out.
- Validation text maps English schema messages to translation keys (`lib/validation-text.ts`).
- Map is mouse-first; keyboard users rely on "use my location".
- OSM tiles are for development only. No Dockerfiles or CI yet.
- TanStack Query, react-hook-form and the Expo apps are not used yet.
