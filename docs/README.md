# Docs index (load only what you need)

| File | Load when working on |
|---|---|
| **`FRD.md`** | **Main review document**: scope, functional requirements (FR-*), rules (BR-*), NFRs, compliance (L-*, F-*), open questions |
| `../Local_Commerce_Cloud_Inventory_Platform_Detailed_Concept (10).md` | Product questions only (long; avoid loading for engineering) |
| `../Backend_System_Design.md` | Overall architecture, modules, API surfaces, deployment |
| `01_Exception_Handling.md` | Error codes, idempotency, degradation, per-flow edge cases |
| `02_Reservations_Payments_Delivery.md` | **Deferred** feature (R3) — reference only |
| `03_Decisions_Log.md` | What's decided / open (D-*) |
| `04_Operations_Runbooks.md` | SLOs, alerts, incidents, environments |
| `../.claude/finance-legal-context.md` | Facts for the finance/legal skills |

**Review Hub:** `../review/Idea01_Review.html` bundles all of the above for reading and peer review (notes saved to `review/reviews.json`). Rebuild it with `python review/build.py` after editing docs. To apply review feedback, read `review/reviews.json`, not the HTML.

Refer to items by ID (e.g. `FR-INV-07`, `D-01`, `S3`, `B8.2`) instead of pasting text.
