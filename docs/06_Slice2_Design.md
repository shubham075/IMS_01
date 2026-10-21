# Slice 2 — Catalogue + inventory (design note)

Scope decided with the founder (2026-10-21): shared + custom products, CSV import, barcode, stock in/out/adjust, low-stock alerts, branch transfers, history, per-product publish toggle, negative stock allowed but flagged (D-01). Built as three parts, one commit each. Schema already exists (`0003`, `0004`, `0005`); IDs below refer to `FRD.md`.

## Split
| Part | Delivers | FRs |
|---|---|---|
| **2a Catalogue** | Search the shared catalogue and add; custom product; edit; identifiers; units; activate/deactivate; publish toggle + show-price per branch | FR-CAT-01/02/04/06/07/08/10/11, FR-PUB-02/03/04/08 |
| **2b Stock** | Opening/receipt/sale/return/adjust movements, status-only products, balances per branch, low-stock list, history, reverse once | FR-INV-01…11, 14, 15, 17 |
| **2c Fast entry** | Transfers (draft → dispatched → received), CSV import with remembered mappings, barcode scan (camera, manual fallback) | FR-INV-13, FR-IMP-*, FR-CAT-03 |

## 2a decisions
- **Shared catalogue = `canonical_product`** (global, read-only to merchants). "Add" copies name/brand/category/barcode into a new org `product` and stores `canonical_id`. Never automatic (FR-CAT-10). No-op if the org already has that `canonical_id` → 409 `DUPLICATE_IDENTIFIER` with `existing_id` (the web links to it).
- **Custom product:** required name, category, unit. Hindi name optional. `allow_fraction` is implied by unit (`kg`, `g`, `litre`, `ml`, `m` fractional; `pcs`, `box`, `pack`, `dozen` whole).
- **Identifiers:** barcode / SKU unique per org (C1) → 409 `DUPLICATE_IDENTIFIER` carrying the existing product id. A product without barcode gets a short code (FR-CAT-07), generated server-side (6 chars, unambiguous alphabet), unique per org.
- **Attributes (FR-CAT-04):** validated against `category.attr_schema` only when the category defines one; unknown keys rejected.
- **Money:** prices are integer paise in the API (`pricePaise`); the UI shows ₹ with Indian grouping. Cost is private and never leaves the merchant API.
- **Publishing:** per branch × product row in `merchant_listing`. Publish requires: product active, category not restricted (422 `RESTRICTED_CATEGORY`), branch published and has a map pin. Show-price is separate. After each change the API calls `refresh_public_listing(branch, product)` in the same transaction; public data never has quantity (D-05). Each change writes an audit event (FR-PUB-08).
- **Deactivate:** inactive products disappear from the public listing in the same transaction (and return if switched back on). No delete in R1 (history is kept); merge is later (FR-CAT-09).
- **Variants / merge / images** are deferred (not asked for); columns stay unused.

## 2a API (all under `/v1/merchant/orgs/:orgId`)
| Method + path | Permission | Notes |
|---|---|---|
| `GET /categories` | any member | global list with `restricted` |
| `GET /catalogue/search?q=&categoryId=&limit=` | any member | canonical products; Hindi/English; flags `alreadyAdded` |
| `GET /products?q=&categoryId=&status=&offset=&limit=` | any member | offset/limit pagination (`total` returned), name/brand/identifier search, includes identifiers and `publishedBranchCount` |
| `POST /products` | `catalogue.write` | custom; `@Idempotent` |
| `POST /products/from-catalogue` | `catalogue.write` | `{canonicalId, pricePaise?, unit?}`; `@Idempotent` |
| `GET /products/:id` | any member | with identifiers, unit conversions, listings per branch |
| `PATCH /products/:id` | `catalogue.write` | partial; `active` toggle lives here |
| `PUT /products/:id/identifiers` | `catalogue.write` | replace the set (barcode, sku, aliases) |
| `PUT /products/:id/listings/:branchId` | `publication.manage` | `{isPublished, showPrice, pricePaise?, temporarilyUnavailable?}`; branch scope enforced |

Errors keep RFC 7807 with stable codes: `NOT_FOUND`, `VALIDATION_FAILED`, `DUPLICATE_IDENTIFIER`, `RESTRICTED_CATEGORY`, `BRANCH_NOT_READY`, `PERMISSION_DENIED`. Read-only orgs allow GET only (existing rule).

## 2a web (merchant)
- `/app/products` list (search, category filter, status filter, "load more"), empty state pushing to "Add your first products".
- `/app/products/add`: two tabs — **From catalogue** (search → tick → add) and **New product** form.
- `/app/products/[id]`: edit details, identifiers, and a **Visible to shoppers** table per branch (publish, show price, temporarily unavailable). Stock numbers arrive in 2b.
- Dashboard checklist gains "Add products" and "Publish a product". Strings in EN + HI, 4-colour palette only, phone-first.
- Roles: `inventory_operator` can add/edit products but not publish; `sales_operator` and `auditor` are read-only; `branch_manager`+ can publish within their branches.

## 2b preview (designed in detail before building)
- All movements go through `apply_stock_movement` with `source='manual'` and a client-generated `source_event_id` (UUID per form submit) → double-submit = one movement (FR-INV-17). Response returns new `onHand`, `discrepancy`.
- Negative result is accepted and sets `discrepancy`; the UI shows an amber "Check this stock" badge and a review list; public label becomes "Check with shop".
- Low stock = `sellable <= threshold` (per-branch override, else product). Dashboard card + list.
- Large-quantity confirm (FR-INV-09), backdating ≤ 30 days (FR-INV-10) enforced by the DB function.

## 2c preview
Transfers use the existing dispatch/receive functions; CSV: upload → column mapping → preview with row errors → commit, import is one idempotent job; barcode: `BarcodeDetector` where supported with a typed-entry fallback (no heavy library).

## Tests
API integration tests on real Postgres (RLS leak checks, role matrix, duplicate identifiers, restricted category, publish gate, listing projection has no quantity/cost), schema unit tests, web unit tests for money/units helpers, Playwright journey (add from catalogue, custom product, publish, role limits).

## Known limits to record at the end
No images (FR-CAT-12), variants, merge or platform-wide dedupe in 2a; price freshness rule (hide after 14 days) is applied by the projection, not the UI.

## Status of 2a (built 2026-10-21)
Done: all endpoints above, web pages (`/app/products`, `/add`, `/[id]`), dashboard checklist, EN/HI. Tests: API 115 (catalogue 18, RLS/role matrix included), schemas 37, web 28, Playwright catalogue journeys (desktop + phone).
Deviations / gaps to remember:
- **Branch go-live is not built yet.** `branch.is_published` has no API; products can be marked "shown" per branch, but shoppers see nothing until the branch itself is published (UI shows "Branch not public yet"). Add `PUT /branches/:id/publication` (permission `publication.manage`, needs pin + verified hours + ≥1 product) before the consumer slice.
- Offset pagination (fine at R1 sizes); switch to keyset if a shop passes ~10k products.
- Attributes (FR-CAT-04) accepted and stored but no category schemas or UI yet; unit conversions (FR-CAT-06) have no UI yet (needed in 2b when quantities move).
- Price-hide-after-14-days (D-10) is applied by the projection, not shown in the merchant UI.
