# 01 — Exception Handling Catalogue

For each flow: what can go wrong and how the backend handles it. The decisions referenced (D-xx) are in `03_Decisions_Log.md`. Payments, reservations and delivery details are in `02_Reservations_Payments_Delivery.md` §8 (P/R/D codes).

---

## 0. Cross-cutting conventions

### 0.1 Error response contract (all clients)
RFC 7807 `application/problem+json`: `type`, `title`, `status`, `code` (stable, machine-readable), `detail`, `trace_id`, optional `errors[]` (field-level) and `retry_after`.
Clients switch on `code`, never on message text. Messages are localisable on the client side.

### 0.2 Error code taxonomy (initial)
| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_FAILED`, `UNIT_NOT_CONVERTIBLE`, `QTY_NOT_INTEGRAL`, `DATE_OUT_OF_RANGE` |
| 401 | `AUTH_REQUIRED`, `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `OTP_INVALID`, `OTP_EXPIRED` |
| 403 | `PERMISSION_DENIED`, `BRANCH_OUT_OF_SCOPE`, `ENTITLEMENT_REQUIRED` (premium), `ACCOUNT_SUSPENDED`, `STEP_UP_REQUIRED` |
| 404 | `NOT_FOUND` (also returned for other tenants' resources — never reveal that they exist) |
| 409 | `IDEMPOTENCY_KEY_REUSED`, `VERSION_CONFLICT`, `RESERVATION_STATE_CONFLICT`, `INSUFFICIENT_STOCK`, `ALREADY_REVERSED`, `DUPLICATE_IDENTIFIER` |
| 422 | `BRANCH_NOT_ACCEPTING`, `OUT_OF_DELIVERY_AREA`, `PRICE_REQUIRED`, `KYC_INCOMPLETE`, `PRODUCT_INACTIVE`, `BRANCH_CLOSED` |
| 426 | `CLIENT_UPGRADE_REQUIRED` |
| 429 | `RATE_LIMITED`, `OTP_SEND_LIMIT` |
| 503 | `DEPENDENCY_UNAVAILABLE` (with `retry_after`), `READ_ONLY_MODE` |

### 0.3 Idempotency rules
| Where | Key | Retention |
|---|---|---|
| Client POST mutations | `Idempotency-Key` header, scoped by (actor, route) | 24h, stores response hash + body |
| Stock events from connectors/imports | `(org_id, source, source_event_id)` | Permanent (unique constraint) |
| Offline mobile ops | `client_op_uuid` | Permanent |
| Webhooks in (Razorpay) | provider event id | Permanent |
| Outbox consumers | `outbox.id` processed marker | 30 days |
Same key + different payload → `409 IDEMPOTENCY_KEY_REUSED`. A request still in progress under the same key → `409` with `retry_after`.

### 0.4 Retries, timeouts, circuit breakers
- Outbound calls (SMS, push, Razorpay, email): timeout of 3–5s, exponential backoff with jitter (1s→2→4→8→16, max 5), circuit breaker opens after 50% failures in 30s.
- Background jobs: max N attempts per job type, then a **dead-letter table** + alert. Jobs are always idempotent.
- DB: statement timeout 5s (API) / 60s (reports, on the replica). Deadlock or serialization failure → automatic retry up to 3×.
- Client guidance: retry only on 408/429/503 and network errors, always with the same Idempotency-Key.

### 0.5 Degradation matrix
| Dependency down | Consumer apps | Merchant apps | Data safety |
|---|---|---|---|
| Postgres primary | Search from replica/cache (stale label); reservations off | Web: read-only banner; mobile: offline queue keeps working | Nothing is lost; the queue syncs later |
| Redis | Search uncached (slower); rate limit falls back to in-process limits | Works | The outbox in PG keeps events |
| Worker | Listings get staler (labels degrade to "Check with shop") | Works; notifications delayed | Outbox accumulates; alert on lag |
| SMS/OTP provider | Login falls back to WhatsApp, then voice | Same | — |
| Razorpay | "Reserve" hidden; discovery works | Payout views stale | Reconciler catches up |
| Push (FCM) | Status visible via in-app polling | SMS fallback for reservation alerts | — |
| Object storage | Product images missing (placeholder) | Imports and image uploads disabled | — |

### 0.6 Reconciliation jobs (invariants)
| Job | Frequency | Invariant | On mismatch |
|---|---|---|---|
| Balance vs ledger | Nightly per org, incremental hourly | `on_hand`/`unsellable` = sum of movements | Alert + auto-rebuild balance from the ledger (the ledger wins) |
| Reserved vs holds | Every 15 min | `reserved` = sum of active reservation items | Alert + recompute |
| Public projection vs balance | Hourly | `public_listing.status` matches the computed status | Re-emit events |
| Payments vs provider | Daily | Captured = transfers + refunds + fee + tax | Alert ops; no auto-fix on money |
| Outbox lag | Every minute | Oldest unprocessed event < 2 min | Page on-call |

---

## 1. Identity & tenancy

| # | Case | Handling |
|---|---|---|
| I1 | SMS OTP slow / provider down | Two providers behind one interface. Fallback WhatsApp → voice call. OTP valid for 5 min. |
| I2 | OTP brute force / SMS bombing | 5 attempts per code, 3 sends per number per hour, plus IP/device limits. CAPTCHA on web only. Lockout with backoff. |
| I3 | **Telecom reassigns the phone number to a new owner** (D-08) | Bind accounts to the device. If the account was inactive > 90 days, a new device needs a second factor (email OTP or approval from an org owner/admin) before it can access merchant data. |
| I4 | Staff share one shop device | "Shop device" mode: one device session + a per-staff 4-digit PIN. Every action records the staff user. PINs lock after 5 failures. |
| I5 | Staff member removed | Membership revoked → all their sessions revoked → user id added to a Redis revoked list for the 15-min token lifetime. Their pending offline ops go to review (D-02). |
| I6 | Refresh token reuse (theft) | Rotation with reuse detection → revoke the whole token family and alert the user. |
| I7 | Owner loses phone / account | Recovery via a second owner/admin, or support identity verification (GST certificate + video call), audited. |
| I8 | User belongs to several orgs | Each token is scoped to one org. Switching org issues a new token. Indexes and RLS keep every query in the active org. |
| I9 | Ownership dispute / business sold | Ownership transfer requires the current owner + step-up auth, or the support process. Never self-serve without the owner. |
| I10 | Cross-tenant access attempt (IDOR) | Return 404, write an audit event, and alert after a threshold. Covered by the automated cross-tenant test suite. |
| I11 | Consumer deletes account (DPDP) | Anonymise the profile. Keep reservation/payment records only for the legal retention period, without contact details. |
| I12 | Privileged action (export, role change, API key) | Requires step-up auth (fresh OTP/MFA within 5 min) → otherwise `403 STEP_UP_REQUIRED`. |

## 2. Stock mutations (ledger)

| # | Case | Handling |
|---|---|---|
| S1 | Retry or duplicate submission | Idempotency (§0.3) returns the original result. |
| S2 | Concurrent updates to one item | Row lock on the `inventory_balance` row inside the transaction. Deadlocks are retried. |
| S3 | **Sale recorded when stock is 0** (D-01) | Accept it. Stock goes negative, a `discrepancy` flag is set, the item shows publicly as "Check with shop", and the merchant gets a task to fix it. |
| S4 | Unit mismatch | Per-product unit-conversion table. An unknown unit → `400 UNIT_NOT_CONVERTIBLE`. Whole-unit items reject fractions. |
| S5 | Backdated movement | Allowed up to 30 days back (org setting). Older → requires the admin role + a reason. Both `occurred_at` and `ingested_at` are stored. |
| S6 | Future-dated movement | Reject beyond +5 min clock tolerance → `400 DATE_OUT_OF_RANGE`. |
| S7 | Product inactive / branch closed | Reject (`422`), except counts, corrections and returns. |
| S8 | Reverse twice / reverse a reversal | Unique `reverses_movement_id` → `409 ALREADY_REVERSED`. |
| S9 | Wrong entry discovered later | History is never edited: post a compensating movement with a reason. |
| S10 | Huge quantity typo (e.g. 10000 instead of 10) | Soft limit per product (e.g. > 10× the typical receipt) → client confirmation prompt (`confirm_large=true`). Audited. |
| S11 | Movement on stock reserved by reservations | A sale is allowed only from `sellable`. If it would take reserved units → warning `409 INSUFFICIENT_STOCK` with an override for managers (then R11 in doc 02). |

## 3. Offline merchant mobile

| # | Case | Handling |
|---|---|---|
| O1 | Offline for days | Local queue has no size limit. The app shows "Last synced X ago". After 24h unsynced, that branch's public status degrades to "Check with shop". |
| O2 | Two devices sell the last unit offline | Both apply (real sales) → negative stock + discrepancy (S3). |
| O3 | **Permission revoked while offline** (D-02) | Ops are not dropped: they go to an admin review queue as "pending approval", visible on the merchant web dashboard. |
| O4 | Entity created offline, then referenced | Client-generated UUIDs are used as real IDs (no temp-ID mapping needed). The server accepts them if they're unused in that org. |
| O5 | Batch dependency order | The server applies ops in `client_seq` order per device. If one op fails, the dependent ops are marked `blocked` and returned. |
| O6 | Partial batch failure | Result per op: `applied` / `duplicate` / `rejected(code)` / `needs_review`. The client retries only failed and blocked ops. |
| O7 | Device clock is wrong | The server stores `ingested_at`. If the device clock is more than 10 min off → keep `client_ts` but flag `clock_unreliable`, and use the server time for freshness. |
| O8 | Reinstall or logout with a pending queue | Block logout until synced (with an override warning). On uninstall the data is lost: it shows up as a discrepancy at the next count. |
| O9 | Batch too big | Max 500 ops / 1 MB per request. The client splits batches. |
| O10 | Old app version, outdated op format | Server accepts the format for N versions. Beyond that → `426 CLIENT_UPGRADE_REQUIRED`. The queue is kept and synced after the upgrade. |
| O11 | Offline delivery OTP verification | See D4 in doc 02. |

## 4. Imports & snapshots

| # | Case | Handling |
|---|---|---|
| M1 | **Snapshot vs later sales** | Delta = snapshot qty − balance **as of `source_ts`** (rebuilt from the ledger). Movements after `source_ts` stay valid. |
| M2 | Older snapshot arrives after a newer one | Skip, log `stale_snapshot`, show in the sync report. |
| M3 | Encoding / format issues (UTF-16/ANSI Excel files, Hindi text, `₹`, commas) | Detect the encoding, normalise numbers, preview the first 50 rows before applying. Formulas are never evaluated. |
| M4 | Duplicate SKU in one file | Shown as a preview error; the merchant chooses which row to keep. |
| M5 | Unknown product / barcode | Review queue: create a new product or map it to an existing one. The mapping is remembered for next time. |
| M6 | Job crashes midway | Rows are idempotent (`job_id + row_no`). The job resumes from the last checkpoint. |
| M7 | Wrong file or wrong branch | "Undo import" posts compensating movements for every change the job made (only if no count was finalized since then; otherwise manual review). |
| M8 | Huge / malicious file | ≤ 20 MB and ≤ 100k rows, MIME + extension check, virus scan, private bucket, presigned URLs expire in 15 min. |
| M9 | Ambiguous branch mapping | Review queue. Unmapped rows are never applied. |
| M10 | Connector sends events for an unknown product | Event goes to quarantine (`needs_review`) and doesn't affect stock. Alert after N events. |
| M11 | Field-level conflict (POS vs platform) | A field-authority map per integration (e.g. POS owns sales, the platform owns reservations). Writes to a field the source doesn't own are ignored and logged. |

## 5. Reservations, payments, delivery — DEFERRED
Feature deferred (D-03). When it's re-opened, see `02_Reservations_Payments_Delivery.md` §8 (P1–P15, R1–R11, D1–D6). In Release 1 the only payment flow is the merchant's **subscription billing** (FR-BIL in `FRD.md`), which uses the same webhook dedup / reconciler patterns (P1–P3, P10, P14, P15).

## 6. Search & public listings

| # | Case | Handling |
|---|---|---|
| Q1 | Location denied / inaccurate GPS | Pincode or area picker. If GPS accuracy is worse than 500m, widen the radius and show the approximate area. |
| Q2 | No results | Widen the radius in steps (2→5→10 km). Then show shops in that category with "Check with shop". Log the gap for demand analytics. |
| Q3 | Unpublished listing still cached | CDN/Redis TTL ≤ 60s + active cache purge on unpublish. |
| Q4 | Projection lag / worker down | Labels are computed at read time from `last_verified_at`, so they degrade safely. Alert if lag > 2 min. |
| Q5 | Scraping by competitors | No exact quantities; rate limit per IP/device; bot detection; results capped per query; no bulk geo export. |
| Q6 | Malicious inaccuracy reports | OTP required to report; weighted by the reporter's history; the merchant sees and can dispute reports; no automatic delisting. |
| Q7 | Unknown or wrong opening hours | Show "Hours not verified" instead of "Open now". Merchant has a "closed today" toggle. |
| Q8 | Typos, Hindi/Hinglish queries | Trigram fuzzy matching + a synonym/transliteration dictionary. Zero-result queries are logged to improve it. |
| Q9 | Price stale | Price is hidden if older than N days (D-10). |
| Q10 | Merchant subscription lapsed | Listings hidden after the grace period (§9). |

## 7. Catalogue

| # | Case | Handling |
|---|---|---|
| C1 | Same barcode used for different products (common with local brands) | Barcodes are unique **per org only**. The platform-wide canonical link is a suggestion that needs confirmation. |
| C2 | Product without a barcode | Org SKU or a platform-generated short code (printable label later). |
| C3 | Merging duplicates that already have history | The losing ID becomes an alias; old references resolve through it. Ledger history is never rewritten. |
| C4 | Variants (size/colour) | Each variant is its own stock item; a parent product groups them for search. |
| C5 | Category attributes fail schema validation | `400 VALIDATION_FAILED` with field errors. Unknown categories fall back to the generic schema. |
| C6 | Restricted category (pharmacy) | Category flag `restricted=true` → can't be published until enabled by the platform (D-04). |

## 8. Transfers & counts

| # | Case | Handling |
|---|---|---|
| T1 | Sent but never received | Units are held in an `in_transit` state. Alert after N days. A manager can mark them lost (loss movement). |
| T2 | Received qty differs from sent | The difference is posted as a shortage/damage movement with a reason. |
| T3 | Transfer cancelled after dispatch | Only through "receive back at source". No delete. |
| T4 | **Sales during a count** (D-06) | No freeze. Each counted line stores `counted_at`. Correction = counted − balance as of `counted_at`. |
| T5 | The same item counted twice in one count | The last entry wins, with a warning; both entries are kept in the count lines for audit. |
| T6 | Count abandoned | Draft auto-expires after 7 days; no stock effect. |

## 9. Billing, plans & lifecycle

| # | Case | Handling |
|---|---|---|
| B1 | Subscription payment fails | Retry schedule (day 1, 3, 5) + notifications → 7-day grace → **read-only** account, public listings hidden, premium features off. Data is never deleted; export always works. |
| B2 | Downgrade from Premium with open reservations | Existing reservations complete; new ones are blocked. |
| B3 | Merchant closes account | Full export offered → 30-day cooling-off → deletion of personal data; financial records kept for the statutory period. |
| B4 | Trial ends | Same as B1 (no data loss). |

## 10. Platform / infrastructure

| # | Case | Handling |
|---|---|---|
| X1 | DB failover | Managed Postgres with multi-AZ standby (stage 2). API retries on connection reset. RPO ≤ 5 min / RTO ≤ 1h (D-07). |
| X2 | Accidental data corruption | Point-in-time recovery restored into a separate instance, then selective repair. Ledger lets balances be recomputed. |
| X3 | Duplicate / poison outbox events | Consumers are idempotent. After N failures → dead-letter + alert. |
| X4 | Bad deploy | Blue/green or rolling deploy with health checks; one-click rollback; feature flags for risky features. |
| X5 | Schema migration on large tables | Expand → backfill in batches → contract. Never lock tables during business hours. Partitions created 3 months ahead. |
| X6 | Secrets leaked | Rotate via the secrets manager; revoke API keys and sessions; audit what the leaked secret was used for. |
| X7 | Abuse / DDoS | WAF + rate limits; public endpoints served from cache; the merchant API is isolated by auth. |
| X8 | Clock drift between servers | NTP; DB `now()` is the authoritative time for deadlines. |
| X9 | Timezones | Store UTC; display in the branch's timezone (IST for the pilot, but kept generic). |
