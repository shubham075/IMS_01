# 04 — Operations, SLOs & Runbooks

## 1. Targets (pilot)
| Item | Target |
|---|---|
| API availability | 99.5% monthly (pilot), 99.9% later |
| Public search p95 | < 400 ms (server time) |
| Merchant mutation p95 | < 300 ms |
| Outbox → public listing lag p95 | < 30 s; alert > 2 min |
| Reservation merchant-response median | < 10 min (business metric) |
| RPO / RTO (D-07) | ≤ 5 min / ≤ 1 h |
| Backups | Managed PITR 7–14 days + daily snapshot kept 30 days + monthly kept 12 months (encrypted) |
| Restore drill | Monthly, into a scratch instance; record the time taken |

## 2. Monitoring & alerts
| Signal | Alert when |
|---|---|
| 5xx rate | > 1% for 5 min |
| Outbox lag | Oldest event > 2 min |
| Dead-letter count | > 0 new in 15 min (payments: any) |
| Pending-payment reconciler | Any reservation PENDING_PAYMENT > 30 min |
| Refund failures | Any refund failed after retries |
| Reconciliation mismatch | Any (see `01` §0.6) |
| OTP success rate | < 85% for 10 min (provider issue) |
| Sync health per merchant | No successful sync > 24h for an active integration → notify the merchant |
| Cross-tenant 404 spikes | > threshold from one user/IP → security alert |
| DB | CPU > 80%, connections > 80%, replica lag > 30s, disk > 75% |

Tooling: structured JSON logs (with trace_id, org_id; no PII), OpenTelemetry traces, Sentry for app errors, uptime checks on `/healthz` (liveness) and `/readyz` (DB + Redis reachable).

## 3. Incident severity
| Sev | Example | Response |
|---|---|---|
| SEV1 | Data leak across tenants, money mis-routed, full outage | Immediately; founder/on-call; public status note; post-mortem in 48h |
| SEV2 | Reservations/payments down, wrong public availability at scale | < 30 min |
| SEV3 | One merchant's sync broken, slow search | Same business day |

## 4. Runbooks (one-paragraph each)
RB-2, RB-3 and RB-9 apply to subscription billing in Release 1; their reservation parts apply only after the deferred feature ships.

**RB-1 Wrong public availability (many listings).** Turn on the `public_degraded` flag → every label shows "Check with shop". Find the source (bad import, connector, worker bug). Undo the import (M7) or fix the mapping. Re-project listings, then clear the flag.

**RB-2 Payment webhooks failing.** Check the Razorpay dashboard webhook delivery logs and the signature-failure metric. The reconciler (P1) keeps resolving payments in the meantime. Fix the secret or endpoint, then replay the events from the Razorpay dashboard (dedup makes replay safe).

**RB-3 Refund stuck.** Look up the `refund` row and the provider status. Retry manually via the admin tool (idempotent). If the provider failed it, start a manual refund and record it in `money_ledger` with the ops actor.

**RB-4 Worker backlog.** Scale up workers. Check the dead-letter table for poison events. Payments and reservations queues get priority over indexing and notifications.

**RB-5 OTP provider down.** Confirm the circuit breaker switched to the secondary provider / WhatsApp. If all providers are down, existing sessions keep working and new logins show a banner.

**RB-6 Database failover / restore.** Managed failover at stage 2. For a restore: PITR into a new instance → verify → switch the connection string → run reconciliation jobs (balances, reserved, payments).

**RB-7 Suspected data leak.** SEV1. Revoke the affected keys and sessions, preserve logs, scope the impact through the audit events, and notify affected parties as required by the DPDP Act timelines (legal counsel).

**RB-8 Merchant reports wrong stock after import.** Open the import's job report → "Undo import" (compensating movements) → re-import with the corrected mapping.

**RB-9 Chargeback received.** Evidence is auto-attached (pickup/delivery OTP log). Ops review it within the provider deadline. If lost → reverse the transfer or offset future payouts.

## 5. Environments & release
- `dev` (local Docker: Postgres+PostGIS, Redis, MinIO, a Razorpay test-mode account), `staging` (production-like, test-mode payments), `prod`.
- CI: lint, unit tests, migration test on a fresh DB, cross-tenant authz suite, OpenAPI contract tests.
- Mobile releases: the server supports the current and previous 2 app versions; `/v1/meta/min-versions` forces upgrades beyond that.
- Feature flags: reservations, delivery, each category, `public_degraded`, per-merchant kill switches.
