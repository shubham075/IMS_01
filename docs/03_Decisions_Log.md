# 03 — Decisions Log

Status: **Accepted** = agreed with the founder; **Proposed** = my default, open to challenge.

| ID | Decision | Status |
|---|---|---|
| D-01 | A sale can drive stock negative; flag a discrepancy instead of rejecting it | Accepted |
| D-02 | Offline ops from a user whose access was revoked go to admin review, never dropped | Accepted |
| D-03 | Reservations are a **Premium**, merchant opt-in feature with 3 modes: token+pickup, full+pickup, full+delivery (merchant's own delivery). The merchant sets the token amount. **Deferred to a future release (2026-10-19)** | Accepted · Deferred |
| D-04 | Launch categories are low-compliance (hardware, stationery, electronics accessories); pharmacy behind a flag, off | Proposed |
| D-05 | Public API shows status + freshness, never exact quantity | Proposed |
| D-06 | Stock counts don't freeze the branch; corrections use per-line `counted_at` | Accepted |
| D-07 | Pilot targets: RPO ≤ 5 min, RTO ≤ 1h, 99.5% availability | Accepted |
| D-08 | After 90 days of inactivity, a new device needs a second factor (protects against reassigned phone numbers) | Accepted |
| D-09 | Payments via Razorpay + Route linked accounts, transfers on hold until fulfilment; the platform never holds funds itself | Proposed |
| D-10 | Price hidden publicly when older than N days (default 14) | Proposed |
| D-11 | One branch per reservation, all-or-nothing per item, no COD, no third-party delivery at launch | Proposed |
| D-12 | Reservations are allowed only while the branch is open and the merchant's "accepting" toggle is on | Proposed |
| D-13 | Cancellation policies are presets (FLEXIBLE / STRICT); a merchant cancelling = always a full refund | Proposed |
| D-14 | No-show policy: token forfeited to the merchant; 3 no-shows in 30 days blocks reserving for 14 days | Proposed |
| D-15 | Pickup/delivery handover verified by a consumer code/OTP; release of funds depends on it | Proposed |
| D-16 | Freshness TTL per source: native 24h, CSV 72h, manual 7d (then "Check with shop") | Proposed |
| D-17 | Stack: TypeScript/NestJS modular monolith, Postgres+PostGIS, Redis/BullMQ, Next.js, React Native (Expo), AWS Mumbai | Proposed |
| D-18 | Search on Postgres (FTS + trigram + PostGIS) until ~1M listings | Proposed |

| D-19 | Reservations, consumer payments and delivery are out of Release 1 and 2; D-09, D-11, D-13, D-14, D-15 apply only when the feature is re-opened | Accepted |
| D-20 | Release 1 languages: English + Hindi (UI and search; Hinglish/transliteration in search) | Accepted |
| D-21 | Entity not yet incorporated; recommended Private Limited (see FRD §12) | Proposed |
| D-22 | Premium plan contents in Release 1: to be decided by the founder after review (FRD §5 has blank columns) | Open |
| D-23 | Pilot city/state undecided; state-specific compliance kept as placeholders | Open |

## Open questions — deferred reservation feature (resolve only when it's re-opened)
1. Platform commission % on paid reservations, and who bears the gateway fee?
2. Return window for delivered items (default 48h) and the non-returnable categories?
3. GST TCS / TDS obligations and registration — confirm with a CA.
4. Merchant payout schedule after release (Razorpay default T+2, or instant for a fee)?
