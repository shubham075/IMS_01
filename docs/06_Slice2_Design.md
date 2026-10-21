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
- **Branch go-live: built afterwards (see below).** Original gap: `branch.is_published` has no API; products can be marked "shown" per branch, but shoppers see nothing until the branch itself is published (UI shows "Branch not public yet"). Add `PUT /branches/:id/publication` (permission `publication.manage`, needs pin + verified hours + ≥1 product) before the consumer slice.
- Offset pagination (fine at R1 sizes); switch to keyset if a shop passes ~10k products.
- Attributes (FR-CAT-04) accepted and stored but no category schemas or UI yet; unit conversions (FR-CAT-06) have no UI yet (needed in 2b when quantities move).
- Price-hide-after-14-days (D-10) is applied by the projection, not shown in the merchant UI.

## Status of 2b (built 2026-10-21)
Done: stock list per branch (low / out / needs-check filters, search), record opening / receipt / sale / returns / damage / expiry / loss / found / correction, status-only products (in/out), per-branch low-stock level, history with who/when/why, undo-once, dashboard stock card. API `/merchant/orgs/:orgId/branches/:branchId/stock…`; EN/HI.
Rules as built: sales and customer returns need `sale.record`, everything else `stock.write`; negative stock allowed and flagged (D-01); opening stock once per product and branch; more than 10× typical quantity needs confirmation; dates may not be in the future or more than 30 days back; unit locked once stock exists; a product that was never stocked is "not counted yet", not "out".
Not in 2b: backdating beyond 30 days with an admin reason, unit conversions, stock counts (FR-INV-12) and transfers (2c).

## "How would real users break this?" — attack suite (`apps/api/test/abuse.test.ts`, `apps/web-merchant/e2e/stock.spec.ts`)
| # | Attack / mistake | Result |
|---|---|---|
| 1 | Double tap, ten parallel submits of one form | one entry (idempotent) |
| 2 | 25 simultaneous sales | no lost or invented stock; balances match the ledger |
| 3 | Five tabs undo the same sale | undone once, others 409 |
| 4 | Two people set opening stock at once | **bug found:** both succeeded → fixed with a per-product lock |
| 5 | Two people add the same barcode at once | **bug found:** 500 → now 409 with link to the product |
| 6 | Retry after dropped connection with a *changed* amount, or event id re-used for another product/branch | **bug found:** silently ignored → now 409 `IDEMPOTENCY_KEY_REUSED`; a true retry of opening stock now returns the original result |
| 7 | NUL bytes, huge numbers, 10k-character text, nested JSON | **bug found:** 500 on control characters → 400 |
| 8 | SQL / wildcard / emoji search | treated as text; `%` is not a wildcard |
| 9 | Broken IDs, limits, offsets, page=99999, NUL in address bar | **bug found:** 500 on huge page / NUL → clamped and sanitised |
| 10 | Other shop's IDs in every position; extra body fields (`org_id`, `status: merged`) | 404 / ignored / 400 |
| 11 | Role escalation through the body | ignored; 403 |
| 12 | Change unit under existing stock | **bug found:** allowed → now rejected |
| 13 | Removed colleague with an old session; garbage tokens | no access |
| 14 | Script script-tags in names and notes | shown as text, nothing runs |
| 15 | 320 requests in a minute | 429 with Retry-After |
| 16 | A "not counted" product nobody had marked | **bug found (by the browser test):** list returned 500 (NULL boolean) → fixed |
Not covered yet: multi-instance rate limiting (in-memory), clock-skewed devices (offline sync slice), very large catalogues (load test), screen-reader testing by a person.

## Go live (built 2026-10-21)
`PUT /merchant/orgs/:orgId/branches/:branchId/publication {isPublished}` (permission `publication.manage`, branch scope enforced). Going live needs a map pin, verified hours, an active branch and at least one product shown (restricted or switched-off products do not count); otherwise 422 `BRANCH_NOT_READY` listing what is missing (`errors[].path`: location, hours, products, status). Hiding is always allowed and keeps the per-product choices. Public rows are rebuilt in the same transaction, an audit event is written once per change, and repeating the call is harmless. A live branch cannot lose its pin (422), and edits to a live branch refresh what shoppers see. `Branch.liveProductCount` added. Web: go-live card on each branch (checklist, Go live / Hide with confirmation), dashboard checklist item.
Tests: API 165 (go-live: readiness, audit once, hide/restore, live edits, restricted products, role matrix, branch scope, strangers 404, read-only org, bad bodies, 10 parallel flips, DB check bypass), browser 38+ (go-live journey, role limit, Hindi, phone).

## 2c-1 Transfers (built 2026-10-21)
Flow: draft -> sent (stock leaves the sender, "in transit") -> received (receiver confirms what arrived; a shortage is written off at the sender). Endpoints under `/merchant/orgs/:orgId/transfers` (list, create, get, `PUT :id/lines`, `POST :id/dispatch|receive|cancel`), permission `transfer.manage`. Rules: both branches in the shop and different; products must be counted, switched on, and allow the quantity (whole units for pieces); sending more than the sender has is allowed and flags it for a check (D-01); nothing can arrive that was not sent (database function does not check this, the API does); repeating send / receive / cancel is harmless; branch-limited people send from and receive at their own branch only and see only transfers touching it. Migration `0007_transfer_note.sql` adds the optional note.
Attack tests found: silent failure when a map pin is placed outside India (now a clear message); server-action files must only export async functions.
Limit: a branch-limited person only sees branches they belong to, so they can only transfer between those; an owner or admin arranges the rest.

## 2c-2 CSV import (built 2026-10-21)
Products + opening stock for one chosen branch (decision with the founder). Flow: **preview** (reads the file, checks every row, stores the result, changes nothing) -> **apply** (creates exactly what was previewed) -> optional **undo**. Endpoints `/merchant/orgs/:orgId/imports` (list, `POST preview`, get, `GET :id/rows`, `POST :id/apply`, `POST :id/undo`), permission `import.run` (owner, admin, branch manager).
Rules as built: CSV only (no XLSX: formulas, macros and hidden sheets are a risk we do not need in R1); up to 2,000 rows and about 900 KB; delimiter, BOM, CRLF and quoting handled; the browser decodes UTF-8, UTF-16 and Windows-1252; English and Hindi column titles (name, category, unit, price, cost, barcode, code, brand, pack size, stock); category matched by slug or English/Hindi name, or one default for all rows; units by common words (pcs, piece, nos, kg, किलो…); prices in rupees to paise; cells starting with `= + @` are refused (formula injection); the first of a repeated barcode/code or name in a file is kept and later rows flagged (M4); anything the shop already has (barcode, code, or same name when there is no code) is skipped and linked, so uploading a file twice adds nothing; apply re-checks codes (the shop may have changed), is safe to repeat or run at once, and every product gets a short code if it has no barcode; undo reverses the opening stock and switches the products off, and is refused once anything else was recorded on them (M7).
Not built: XLSX, stock snapshots with timestamps (FR-IMP-05), remembered mappings / review queue for unknown products (FR-IMP-04), downloadable report (FR-IMP-06 shows on screen), exports (FR-IMP-08). Files are processed inline, not stored (`file_key` is `inline:<id>`).

## 2c-3 Scan, quick stock and stock counts (built 2026-10-21)
**Find:** `GET /merchant/orgs/:orgId/catalogue/lookup?code=&branchId=` matches your product by barcode, product code, search name or quick code (any case); when you have none it offers a shared-catalogue match so the product can be added or created with the barcode filled in. Codes are limited to letters, digits and `._/- `, 64 characters.
**Scanner (web):** `BarcodeDetector` camera scanning where the browser has it (Chrome/Android), always with a typed box; USB or Bluetooth scanners work because they type the digits and press Enter. The same code is ignored for 2 seconds. The site's Permissions-Policy now allows the camera for itself (`camera=(self)`). No scanning library (decision with the founder); the mobile apps will do camera scanning properly.
**Quick stock:** after a scan, enter a quantity and tap Sold or Stock received (the same ledger rules as the stock screen: roles, idempotency, negative allowed).
**Stock counts (FR-INV-12):** `/merchant/orgs/:orgId/branches/:branchId/counts` (list, start, get, `POST :id/lines`, `POST :id/finalize|abandon`), permission `count.run`. One count open per branch (two people starting at once share it); every entry is kept and the latest per product wins; finishing corrects each product by counted minus the records *at the moment of counting*, so sales made during the count are not lost (D-06); finish and cancel are safe to repeat; a count left open for 7 days closes itself without touching stock (T6); only counted, switched-on products can be counted. Web: each scan adds one to that product, scans are queued and tallied so fast scanning never loses a unit, numbers can be typed over, a preview shows how many products will change.
Attack tests found and fixed: lookup accepted another shop's branch id without complaint when nothing matched; fast successive scans in the count screen could each start from a stale number.
Not built: scheduled/cyclic count suggestions, count by category/zone, variance reasons per line (the correction is recorded as `count_correction`).
