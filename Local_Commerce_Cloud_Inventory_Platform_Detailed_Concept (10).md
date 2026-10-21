# Local Commerce & Cloud Inventory Network

## Detailed Product Concept, Requirements, Architecture, and Roadmap

**Document purpose:** Shareable concept document for peer review and
early product planning\
**Product type:** B2B cloud inventory SaaS + B2C local product discovery
marketplace\
**Initial market context:** India, with a design that can expand to
other regions\
**Status:** Concept / discovery stage

------------------------------------------------------------------------

## 1. Executive Summary

The **Local Commerce & Cloud Inventory Network** connects local
consumers with nearby shops that are likely to have the products they
need, while giving shopkeepers a modern cloud-based inventory management
system.

It combines two complementary products:

1.  **B2C consumer app:** Search for a product, brand, model,
    barcode/SKU, or shop category; see nearby shops, indicative
    availability, price when supplied, freshness of the stock update,
    and ways to contact or reach the shop. Consumers may send a
    reservation request before travelling.
2.  **B2B merchant app:** Manage products, branches, purchases, sales,
    returns, stock movements, suppliers, alerts, and reports through a
    cloud-native system. Merchants can also connect or import data from
    existing desktop or accounting/inventory software.

The two sides share a common catalogue, inventory availability service,
search system, and reservation workflow. Inventory data is published to
consumers only when the merchant authorizes it.

**Core recommendation:** Build this as a useful inventory SaaS first,
with local product discovery built in. A merchant should receive value
from inventory management even before the consumer marketplace has high
traffic. Start in a focused locality and a few product categories, but
make the data model multi-category-ready from the beginning.

## 2. Problem Statement

### 2.1 Consumer problem

Consumers often travel to several nearby shops because they cannot tell
whether a specific product is in stock. Search engines and map listings
may show that a shop exists, but usually do not confirm availability for
a specific SKU, brand, size, model, or pack.

This creates: - Wasted travel time and transport cost. - Frustration
when a product is unavailable. - Repeated phone calls to multiple
shops. - Poor visibility into alternatives or nearby stock. - A weak
digital presence for smaller merchants.

### 2.2 Merchant problem

Many small and medium shops use paper records, spreadsheets, or desktop
software that stores data locally. Even when a merchant has an inventory
system, the data may not be accessible to consumers or synchronized
across branches.

This creates: - Limited remote access to inventory. - Difficulty
managing multiple branches and staff. - Manual stock reconciliation and
reporting. - Low discoverability by nearby customers. - Challenges
integrating legacy systems with online channels. - Risk of inaccurate
stock caused by delayed updates or duplicate data entry.

### 2.3 Platform opportunity

Connect the two problems through a shared inventory network:

``` mermaid
flowchart TD
    C[Consumer needs a product] --> S[Search nearby shops]
    S --> I[Availability and location results]
    I --> R[Call, directions, or request reservation]
    M[Merchant manages inventory] --> D[Shared inventory and catalogue services]
    D --> I
    M --> U[More accurate stock data]
    U --> D
```

The marketplace becomes more useful as more merchants maintain reliable
inventory, and the inventory product becomes more valuable as it brings
merchants additional customer discovery.

------------------------------------------------------------------------

## 3. Product Vision and Principles

### Vision

**Make local product availability discoverable and local retail
inventory easier to manage.**

### Product principles

1.  **Availability confidence over false certainty:** Show when stock
    was last updated and communicate uncertainty honestly.
2.  **Merchant control:** Merchants decide which products, prices,
    branches, and stock signals are visible to consumers.
3.  **Useful without the marketplace:** The B2B inventory product must
    work even if consumer traffic is initially low.
4.  **Integration-friendly:** Support native cloud workflows, manual
    adjustments, CSV/Excel import, APIs, webhooks, and optional legacy
    connectors.
5.  **Multi-category foundation:** Support category-specific attributes
    without forcing all categories into one rigid product schema.
6.  **Privacy and least privilege:** Never expose internal stock,
    supplier, sales, customer, or branch data beyond authorized
    purposes.
7.  **Auditability:** Important stock changes and reservations must have
    traceable records.
8.  **Small-shop usability:** Keep routine actions fast,
    mobile-friendly, and understandable for merchants with limited
    technical support.

------------------------------------------------------------------------

## 4. Target Users and Roles

### B2C users

-   Consumers looking for a specific item nearby.
-   Consumers looking for a category of shop, such as pharmacies,
    hardware stores, electronics shops, stationery stores, or grocery
    stores.
-   Consumers who want to confirm stock before travelling.
-   Consumers who need to compare available options or contact
    merchants.

### B2B users

-   Independent shop owners.
-   Store managers and inventory operators.
-   Cashiers or sales staff with limited permissions.
-   Purchasing and supplier-management staff.
-   Chain or franchise administrators managing multiple branches.
-   IT or operations teams integrating existing software.

### Platform operator

-   Platform administrator and support team.
-   Catalogue moderation and duplicate-resolution staff.
-   Integration support staff.
-   Trust, safety, security, and compliance staff.

### Suggested role model

  -----------------------------------------------------------------------
  Role                                Typical permissions
  ----------------------------------- -----------------------------------
  Organisation owner                  Billing, organisation settings,
                                      branches, users, integrations, data
                                      export

  Organisation admin                  Most operational configuration,
                                      excluding owner-only actions

  Branch manager                      Branch inventory, staff, reports,
                                      and local settings

  Inventory operator                  Stock receipts, adjustments,
                                      counts, transfers

  Sales operator                      Sales-related stock deductions and
                                      returns, where integrated

  Read-only auditor                   View permitted records and audit
                                      history

  Platform support                    Limited, logged support access
                                      under controlled policy
  -----------------------------------------------------------------------

Permissions should be tenant- and branch-aware. A user from one merchant
organisation must never be able to access another organisation's private
records.

------------------------------------------------------------------------

## 5. B2C Consumer Application

### 5.1 Core capabilities

-   Search by product name, brand, model, SKU, barcode, or common alias.
-   Browse by shop category or product category.
-   Search within a radius or selected area.
-   Show nearby stores with distance, address, directions, contact
    options, and branch identity.
-   Show availability as a meaningful status rather than an unsupported
    guarantee.
-   Display price when a merchant chooses to publish it.
-   Display last-updated time or freshness indicator.
-   Filter by availability, distance, category, brand, price (when
    reliable), and open status (when verified).
-   Show alternatives from nearby shops.
-   Call or message a shop using supported contact methods.
-   Open map directions.
-   Submit a reservation request.
-   View request status and expiration, if a reservation workflow is
    enabled.
-   Report an inaccurate listing or unavailable item.
-   Save favourites or recent searches as a later enhancement.

### 5.2 Availability labels

Use clear, consistent labels. Example:

  -----------------------------------------------------------------------
  Status                              Meaning
  ----------------------------------- -----------------------------------
  Available                           Recent inventory data indicates
                                      stock is available

  Limited stock                       The reported quantity is at or
                                      below a configured threshold

  Check with shop                     Data is stale, incomplete, or not
                                      reliable enough to confirm

  Out of stock                        The current trusted inventory
                                      signal indicates no sellable stock

  Temporarily unavailable             Merchant or system has marked the
                                      item unavailable

  Reservation pending                 The consumer request has been
                                      submitted but not confirmed

  Reserved                            The merchant/system has confirmed a
                                      reservation under defined terms
  -----------------------------------------------------------------------

Do not imply live availability when data is based on a delayed import or
manual update. The UI should explain when the result was last updated.

### 5.3 Consumer journey

``` mermaid
flowchart TD
    A[Open app or website] --> B[Search product or browse category]
    B --> C[Choose location or use permitted location access]
    C --> D[Search nearby merchant branches]
    D --> E[Review availability, freshness, distance, and price]
    E --> F{Next action}
    F -->|Call shop| G[Confirm details directly]
    F -->|Directions| H[Travel to selected shop]
    F -->|Reservation request| I[Submit requested item and quantity]
    I --> J[Merchant confirms, declines, or suggests alternative]
    J --> K[Consumer receives status and expiry details]
```

### 5.4 Search experience

Search should accommodate imperfect real-world data: - Typo tolerance
and synonyms. - Brand and model matching. - Barcode/SKU matching where
available. - Category-specific fields, such as size, colour, capacity,
pack size, strength, or model number. - Duplicate product resolution and
merchant-specific aliases. - Search ranking that balances match quality,
availability confidence, distance, freshness, and merchant quality
signals. - Clear disclosure when price is absent or last updated.

Avoid ranking solely on paid promotion. Sponsored results, if
introduced, must be clearly labelled and should not falsely claim
availability.

------------------------------------------------------------------------

## 6. B2B Cloud Inventory Management Application

### 6.1 Organisation and branch management

-   Organisation profile and business category.
-   One or many branches.
-   Branch-specific address, hours, contact details, and publication
    settings.
-   Users, roles, and permissions.
-   Branch-level or organisation-level catalogue rules.
-   Stock visibility controls for the B2C app.
-   Audit history for sensitive actions.
-   Data export and organisation closure/offboarding workflows.

### 6.2 Product catalogue

-   Product name and description.
-   Brand, manufacturer, model, SKU, barcode, and aliases.
-   Category and subcategory.
-   Unit of measure and pack size.
-   Variant attributes such as size, colour, capacity, or specification.
-   Tax and price fields where relevant to the merchant's market.
-   Supplier references.
-   Active/inactive status.
-   Category-specific fields without breaking the common product model.
-   Product image and documents, where useful.
-   Duplicate detection and merge workflow.

### 6.3 Inventory operations

-   Opening stock.
-   Purchase receipt and supplier delivery.
-   Sales deduction (manual or integrated).
-   Customer returns and supplier returns.
-   Stock adjustment with reason.
-   Damaged, expired, quarantined, or otherwise unsellable stock.
-   Stock transfer between branches.
-   Cycle counts and full stock counts.
-   Reorder thresholds and low-stock alerts.
-   Stock movement ledger and reconciliation.
-   Batch, lot, serial number, or expiry tracking where required by the
    category.
-   Reservation and release of stock.
-   Inventory valuation/reporting if included in the selected accounting
    scope.

### 6.4 Purchasing and suppliers

-   Supplier directory.
-   Purchase orders.
-   Goods-received notes.
-   Purchase returns.
-   Cost and lead-time fields.
-   Reorder suggestions.
-   Supplier product codes and mappings.
-   Purchase history and supplier-level reports.

### 6.5 Reports and dashboards

-   Current stock by branch.
-   Low-stock items.
-   Out-of-stock items.
-   Stock movement history.
-   Inventory discrepancies.
-   Fast- and slow-moving products.
-   Expiry/batch alerts where relevant.
-   Purchase and return summaries.
-   Reservation requests and fulfilment.
-   Data synchronization health.
-   Consumer listing freshness.
-   User activity and audit reports.

### 6.6 Merchant B2C publication controls

Merchants should explicitly choose: - Which branches appear publicly. -
Which products appear in consumer search. - Whether price is
displayed. - Whether exact quantity, a range, or only a status is
exposed. - Whether reservation requests are accepted. - Reservation
duration and maximum quantity rules. - What contact information is
public. - Whether imported data is published immediately or only after
review.

------------------------------------------------------------------------

## 7. Shared Platform Architecture

### 7.1 High-level architecture

``` mermaid
flowchart TB
    subgraph Clients
        B2C[Consumer Web / Mobile App]
        B2B[Merchant Web / Mobile App]
        POS[Existing POS / Desktop Inventory]
    end

    subgraph Edge
        API[API Gateway / Backend API]
        AUTH[Authentication and Tenant Authorization]
    end

    subgraph CoreServices
        CAT[Product Catalogue Service]
        INV[Inventory Ledger and Availability Service]
        SEARCH[Search and Geolocation Service]
        RES[Reservation Service]
        SYNC[Integration and Synchronization Service]
        NOTIFY[Notification Service]
        REPORT[Reporting and Analytics]
    end

    subgraph Data
        DB[(Relational Database)]
        GEO[(Geospatial Index)]
        IDX[(Search Index)]
        QUEUE[Background Queue / Events]
        OBJ[(Object Storage)]
        AUDIT[(Audit and Integration Logs)]
    end

    B2C --> API
    B2B --> API
    POS <--> SYNC
    API --> AUTH
    API --> CAT
    API --> INV
    API --> SEARCH
    API --> RES
    API --> REPORT
    CAT --> DB
    INV --> DB
    INV --> QUEUE
    SEARCH --> GEO
    SEARCH --> IDX
    RES --> DB
    RES --> QUEUE
    SYNC --> DB
    SYNC --> AUDIT
    QUEUE --> NOTIFY
    CAT --> OBJ
    REPORT --> DB
```

### 7.2 Architectural boundaries

-   **Catalogue:** Defines canonical products and category attributes;
    merchant listings may map to canonical products.
-   **Inventory ledger:** Records stock-changing events and calculates
    current sellable availability.
-   **Search:** Returns public listings using geospatial and product
    relevance signals.
-   **Reservations:** Coordinates temporary commitments and their
    lifecycle.
-   **Synchronization:** Imports, exports, maps, validates, and
    reconciles data from external systems.
-   **Identity and tenancy:** Enforces organisation, branch, user, and
    role boundaries.
-   **Notifications:** Sends reservation updates, sync failures,
    low-stock alerts, and other permitted events.
-   **Audit:** Preserves traceable records of high-impact operations.

For an MVP, these may be modules within a well-structured modular
monolith rather than independent microservices. Split services only when
scale, team boundaries, or operational needs justify it.

------------------------------------------------------------------------

## 8. Inventory Synchronization Strategy

### 8.1 Supported sources

1.  **Cloud-native transactions:** Stock changes are created directly in
    the platform.
2.  **Manual adjustments:** An authorized merchant user records a change
    with a reason.
3.  **CSV/Excel import:** Merchants upload product and stock data from
    supported templates.
4.  **Scheduled export/import:** A legacy system exports files on a
    schedule.
5.  **API and webhooks:** Supported systems send stock changes or query
    updates.
6.  **Optional local connector:** A small agent on the merchant's local
    network synchronizes a desktop database or exports files, where the
    legacy vendor and security model permit it.

Do not assume that every legacy desktop system has an accessible API.
Integrations should be validated individually and must respect vendor
licensing and customer authorization.

### 8.2 Hybrid synchronization diagram

``` mermaid
flowchart LR
    N[Native cloud transactions] --> ING[Ingestion and validation]
    M[Authorized manual adjustment] --> ING
    F[CSV / Excel import] --> ING
    API[External API / Webhook] --> ING
    L[Legacy local connector or scheduled export] --> ING
    ING --> MAP[Product and branch mapping]
    MAP --> VAL[Validation and conflict detection]
    VAL -->|Valid event| LEDGER[Inventory ledger]
    VAL -->|Needs review| ERR[Quarantine / review queue]
    LEDGER --> AVAIL[Availability calculation]
    AVAIL --> PUB[Merchant-controlled public listing]
    ERR --> FIX[Correct mapping or data]
    FIX --> ING
```

### 8.3 Synchronization rules

-   Every import has a source, timestamp, job ID, and result summary.
-   Validate records before they affect trusted inventory.
-   Make retries idempotent to avoid duplicate stock movements.
-   Preserve source timestamps and ingestion timestamps separately.
-   Detect stale snapshots and do not blindly overwrite newer data.
-   Prefer event deltas when the source supports reliable events.
-   For snapshot imports, compare source version/timestamp and use
    explicit conflict policy.
-   Route ambiguous product or branch mappings to a review queue.
-   Keep error details useful but avoid logging secrets or unnecessary
    personal data.
-   Show sync status and last successful synchronization to merchants.
-   Provide rollback or compensating adjustments for incorrect imports.
-   Maintain an audit trail for manual overrides and conflict
    resolutions.

### 8.4 Source-of-truth policy

A product may have different authoritative sources for different fields.
For example, a merchant's POS may be authoritative for sales, while the
platform may be authoritative for reservations. Define field-level or
event-level authority for every integration instead of assuming one
universal source of truth.

------------------------------------------------------------------------

## 9. Stock Availability and Reservation Logic

### 9.1 Sellable availability

A simple conceptual formula is:

**Sellable availability = physical on-hand stock − active reservations −
other committed stock − unsellable stock**

Unsellable stock can include damaged, expired, quarantined, recalled, or
otherwise unavailable units, depending on the category and merchant
policy.

The actual implementation should account for the inventory model, stock
locations, batches, units of measure, and the source system's semantics.
Do not subtract the same commitment twice if the external POS already
includes it in its stock figure.

### 9.2 Reservation lifecycle

``` mermaid
stateDiagram-v2
    [*] --> Requested
    Requested --> Confirmed: Merchant/system accepts
    Requested --> Declined: Merchant declines
    Requested --> Cancelled: Consumer cancels
    Confirmed --> Fulfilled: Item collected or sale completed
    Confirmed --> Cancelled: Permitted cancellation
    Confirmed --> Expired: Reservation deadline passes
    Expired --> [*]
    Declined --> [*]
    Cancelled --> [*]
    Fulfilled --> [*]
```

### 9.3 Reservation safeguards

-   Reservation creation must be atomic so concurrent requests cannot
    over-allocate stock.
-   Use idempotency keys to prevent duplicate reservations when clients
    retry.
-   Reserve only against eligible sellable stock.
-   Define expiration time and automatic release behavior.
-   Release stock when a reservation is cancelled, declined, or expires.
-   Record who confirmed or changed the reservation and when.
-   Do not guarantee an item until the system or merchant has confirmed
    under the stated rules.
-   Handle partial fulfilment and alternatives only if explicitly
    supported.
-   Define maximum reservation quantity and per-customer limits where
    appropriate.
-   Avoid exposing customer contact information beyond what fulfilment
    requires.
-   Make the merchant's reservation acceptance mode explicit: manual
    confirmation, automatic confirmation for eligible stock, or
    disabled.

### 9.4 Race conditions and stale inventory

Search results are an estimate, not a lock. Availability can change
after a search. The reservation operation must re-check inventory inside
a transaction or equivalent atomic mechanism. If the source system is
external and cannot lock stock, communicate that the request is pending
until confirmed.

------------------------------------------------------------------------

## 10. Conceptual Data Model

The following is a starting point, not a final database schema.

``` mermaid
erDiagram
    ORGANIZATION ||--o{ BRANCH : owns
    ORGANIZATION ||--o{ USER_MEMBERSHIP : has
    USER ||--o{ USER_MEMBERSHIP : joins
    BRANCH ||--o{ INVENTORY_BALANCE : holds
    PRODUCT ||--o{ INVENTORY_BALANCE : tracked_as
    PRODUCT ||--o{ PRODUCT_IDENTIFIER : identified_by
    PRODUCT ||--o{ MERCHANT_LISTING : listed_as
    BRANCH ||--o{ MERCHANT_LISTING : publishes
    PRODUCT ||--o{ STOCK_MOVEMENT : changes
    BRANCH ||--o{ STOCK_MOVEMENT : records_at
    ORGANIZATION ||--o{ INTEGRATION_CONNECTION : configures
    INTEGRATION_CONNECTION ||--o{ SYNC_JOB : runs
    SYNC_JOB ||--o{ SYNC_ERROR : reports
    BRANCH ||--o{ RESERVATION : receives
    USER ||--o{ RESERVATION : requests
    RESERVATION ||--|{ RESERVATION_ITEM : contains
    PRODUCT ||--o{ RESERVATION_ITEM : requested
    ORGANIZATION ||--o{ AUDIT_EVENT : records
```

### 10.1 Main entities

  -----------------------------------------------------------------------
  Entity                              Purpose
  ----------------------------------- -----------------------------------
  Organisation                        Merchant tenant and business
                                      settings

  Branch                              Physical store/location

  User and membership                 Identity, organisation membership,
                                      and role assignment

  Product                             Canonical or merchant-defined
                                      product record

  Product identifier                  SKU, barcode, model, alias, or
                                      external code

  Merchant listing                    Branch-specific public listing,
                                      price, and visibility rules

  Inventory balance                   Efficient current view of stock by
                                      product and location

  Stock movement                      Immutable or append-only record of
                                      stock-changing events

  Reservation                         Consumer request and reservation
                                      lifecycle

  Reservation item                    Product, quantity, and status for
                                      each requested item

  Supplier and purchase records       Purchasing workflow and receiving
                                      history

  Integration connection              External system configuration and
                                      mapping

  Sync job and error                  Import/export history, failures,
                                      and review items

  Audit event                         Traceability for important
                                      user/system actions

  Notification                        Delivery status and message
                                      metadata
  -----------------------------------------------------------------------

### 10.2 Data modelling guidance

-   Keep inventory movements auditable; avoid treating a mutable
    quantity field as the only record of truth.
-   Use database transactions for stock changes and reservations.
-   Add unique constraints for tenant-scoped identifiers and external
    source event IDs.
-   Use decimal or integer representations appropriate to the unit of
    measure; avoid floating-point arithmetic for stock and money.
-   Store timestamps consistently, and display them in the user's or
    branch's local time zone.
-   Model category-specific fields through typed extensions or a
    validated attribute schema.
-   Consider batch/lot/expiry/serial tracking as optional capabilities,
    not mandatory fields for every category.
-   Keep public search documents separate from private merchant records
    where useful.

------------------------------------------------------------------------

## 11. Suggested Technology Stack

The stack should be chosen based on the team's skills, deployment
requirements, expected load, and integration needs. The following is a
practical starting option rather than a mandatory choice.

  ------------------------------------------------------------------------
  Layer                   Suggested option         Reason
  ----------------------- ------------------------ -----------------------
  Consumer web            React / Next.js with     Strong ecosystem and
                          TypeScript               responsive web support

  Merchant web            React / Next.js with     Shared UI foundations
                          TypeScript               and component reuse

  Mobile app              React Native or Flutter, Cross-platform delivery
                          if native apps are       
                          needed                   

  Backend                 TypeScript with NestJS,  Structured APIs and
                          or Python with FastAPI   validation

  Primary database        PostgreSQL               Relational integrity,
                                                   transactions, mature
                                                   tooling

  Geospatial              PostGIS                  Nearby-store and radius
                                                   searches

  Search                  PostgreSQL initially;    Start simple, add
                          OpenSearch/Meilisearch   dedicated search when
                          later if justified       needed

  Cache / jobs            Redis plus a queue, or   Background processing
                          managed cloud queue      and caching

  File storage            S3-compatible object     Imports, exports,
                          storage                  images, and documents

  Authentication          Managed identity         Secure identity and
                          provider or robust       session handling
                          standards-based auth     

  Observability           Structured logs,         Operational reliability
                          metrics, tracing, error  
                          reporting                

  Deployment              Managed cloud services   Reduce early
                          and CI/CD                operational burden
  ------------------------------------------------------------------------

### Architecture recommendation

Start with a **modular monolith** with clear domain boundaries: -
Identity and tenancy - Catalogue - Inventory ledger - Search/public
listings - Reservations - Integrations - Notifications - Reporting

Use asynchronous jobs for imports, indexing, notifications, and heavy
reports. Keep the critical stock and reservation paths transactional.
Add microservices only when the evidence supports the operational cost.

------------------------------------------------------------------------

## 12. Security, Privacy, and Reliability

### 12.1 Security requirements

-   Enforce tenant isolation on every server-side data access.
-   Use role-based access control and branch-level scoping.
-   Apply secure password/session practices or use a trusted identity
    provider.
-   Require stronger authentication for privileged users where
    appropriate.
-   Encrypt data in transit and at rest.
-   Store secrets in a secrets manager, never in source control or plain
    logs.
-   Validate all input and uploaded files; limit size and file types for
    imports.
-   Use rate limits and abuse controls on search, authentication, and
    reservation endpoints.
-   Protect APIs against unauthorized object access and injection
    attacks.
-   Maintain backups and test restoration.
-   Record sensitive administrative actions.
-   Provide controlled, audited support access.
-   Use least-privilege access for integration credentials.
-   Rotate and revoke tokens and connector credentials.
-   Monitor failed logins, suspicious API activity, and repeated sync
    failures.

### 12.2 Privacy requirements

-   Collect only the personal data necessary for the user journey.
-   Do not expose merchant-only sales, cost, supplier, or customer
    records in public search.
-   Explain how location access is used; allow manual location
    selection.
-   Define retention periods for reservation and contact data.
-   Give merchants control over public listing fields.
-   Avoid including sensitive customer details in logs or analytics.
-   Provide clear account, export, deletion, and support processes where
    legally required.
-   Review applicable Indian data protection and consumer laws with
    qualified counsel before launch.

### 12.3 Reliability requirements

-   Use idempotent operations for stock events and imports.
-   Use transactions for reservation and inventory commitment.
-   Provide retry policies and dead-letter/review queues for failed
    jobs.
-   Monitor data freshness and integration lag.
-   Track API latency, errors, reservation failures, and stock
    discrepancies.
-   Have an incident process for incorrect public availability data.
-   Make graceful degradation possible: if the search index is delayed,
    the inventory ledger remains authoritative.

------------------------------------------------------------------------

## 13. Category-Specific Considerations

A multi-category platform needs a common foundation and
category-specific rules.

### 13.1 Pharmacy and medical retail

Pharmacy is potentially valuable but has higher safety and regulatory
risk. Requirements may include: - Correct product identity:
brand/generic, strength, dosage form, pack size, and manufacturer where
applicable. - Clear distinction between an exact match and a possible
alternative. - No automated medical advice or recommendation to
substitute prescription medicines. - Prescription and dispensing
controls remain with the licensed merchant and applicable law. - Do not
imply that listing or reservation guarantees lawful dispensing. -
Carefully review applicable Indian pharmacy, drug advertising,
prescription, privacy, and e-commerce rules with qualified
legal/compliance experts before enabling this category. - Design for
batch/lot, expiry, recall, and restricted-item handling if required. -
Limit public availability details where exposing them would create
safety or compliance concerns.

### 13.2 Other category-specific attributes

  -----------------------------------------------------------------------
  Category                            Potential attributes
  ----------------------------------- -----------------------------------
  Electronics                         Brand, model, capacity, colour,
                                      warranty, serial/IMEI where
                                      appropriate

  Hardware                            Dimensions, grade, material, unit,
                                      pack size

  Grocery                             Weight/volume, variant, expiry or
                                      batch where needed

  Stationery                          Size, paper type, pack quantity

  Apparel                             Size, colour, fit, variant

  Automotive parts                    Vehicle compatibility, part number,
                                      manufacturer

  Beauty and personal care            Brand, size, shade, variant,
                                      authenticity/supplier controls
                                      where relevant
  -----------------------------------------------------------------------

Do not make consumers rely on a loose text match when product
specifications materially affect safety or compatibility.

------------------------------------------------------------------------

## 14. Business Model and Monetization

Potential revenue sources:

1.  **B2B subscription:** Monthly or annual plans by branch, user count,
    feature set, or transaction volume.
2.  **Premium inventory tools:** Advanced reporting, purchasing,
    multi-branch controls, batch/expiry management, and integrations.
3.  **Enterprise plan:** Custom roles, APIs, integrations, support SLAs,
    and consolidated reporting for chains.
4.  **Clearly labelled sponsored placements:** Paid visibility that does
    not misrepresent availability.
5.  **Optional reservation or transaction fees:** Only if the fulfilment
    model supports the cost and merchants see clear value.
6.  **Integration/setup services:** Paid migration, legacy connector
    setup, data cleaning, and onboarding.
7.  **Partner ecosystem:** Accounting/POS integrations or service
    partners, with transparent terms.

### Pricing principles

-   Keep entry pricing affordable for small shops.
-   Provide a low-friction trial or guided onboarding.
-   Charge for meaningful value, not merely listing a shop.
-   Avoid making accurate inventory updates too expensive or burdensome.
-   Separate software subscription value from paid marketplace
    promotion.
-   Validate willingness to pay before finalizing pricing.

------------------------------------------------------------------------

## 15. Risks and Mitigations

  -----------------------------------------------------------------------
  Risk                    Why it matters          Mitigation
  ----------------------- ----------------------- -----------------------
  Stale inventory         Consumers travel for    Freshness timestamps,
                          unavailable products    sync health,
                                                  conservative labels,
                                                  reservation re-check

  Merchant onboarding     Marketplace lacks       Guided setup,
  friction                coverage                templates, migration
                                                  support, local
                                                  onboarding partners

  Legacy software         Every vendor may have   Integration discovery,
  complexity              different data formats  standard templates,
                                                  connector framework,
                                                  paid integration tier

  Catalogue mismatch      Wrong product or        Identifiers, category
                          variant appears         attributes, aliases,
                          available               mapping review

  Double reservation      More than one consumer  Atomic stock
                          is promised the same    commitment,
                          unit                    idempotency, expiry and
                                                  release

  Low consumer demand     Merchants may not see   Start in a dense
  initially               discovery value         locality/category; make
                                                  B2B SaaS independently
                                                  valuable

  Data leakage across     Serious trust and legal Tenant isolation,
  merchants               risk                    authorization tests,
                                                  audits, least privilege

  Inaccurate prices       Consumer trust erosion  Merchant-controlled
                                                  pricing, update
                                                  timestamps, hide stale
                                                  prices where
                                                  appropriate

  Pharmacy compliance     Potential consumer harm Legal review, category
  risk                    and regulatory exposure restrictions, exact
                                                  matching, no
                                                  substitution advice

  Poor source data        Imported data may be    Validation, staging,
                          incomplete or           quarantine,
                          inconsistent            reconciliation, audit
                                                  trail

  Operational burden      Too many categories and Narrow initial market
                          workflows at launch     and phased feature
                                                  rollout
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 16. MVP and Implementation Roadmap

### Phase 0 --- Discovery and validation

-   Interview shopkeepers and consumers.
-   Select a launch locality and initial category mix.
-   Identify common legacy inventory/POS systems.
-   Test willingness to pay for cloud inventory.
-   Validate the value of stock visibility and reservation.
-   Define category-specific legal and operational constraints.
-   Create clickable prototypes and test them with real users.

**Exit criteria:** Evidence of a real recurring problem, a feasible
initial merchant segment, and willingness to pilot.

### Phase 1 --- Inventory foundation

-   Organisation and branch management.
-   Users, roles, and tenant isolation.
-   Product catalogue and identifiers.
-   Opening stock, receipts, adjustments, and stock ledger.
-   CSV/Excel import with validation and preview.
-   Basic stock reports and low-stock alerts.
-   Audit history and data export.
-   Merchant-controlled public listing settings.

**Exit criteria:** Pilot merchants can maintain useful inventory without
relying on the consumer marketplace.

### Phase 2 --- Consumer discovery

-   Public shop profiles and branch locations.
-   Product/category search.
-   Nearby results and map directions.
-   Availability status and freshness timestamp.
-   Merchant contact options.
-   Basic reporting of inaccurate listings.
-   Merchant publication controls.

**Exit criteria:** Consumers can find relevant local merchants and
understand how trustworthy the availability result is.

### Phase 3 --- Reservation and synchronization

-   Reservation request and confirmation lifecycle.
-   Atomic stock commitment for platform-controlled inventory.
-   Expiration, cancellation, and release.
-   Notifications.
-   Import scheduling and sync-health dashboards.
-   One or two validated integrations or local connectors.
-   Conflict resolution and audit reporting.

**Exit criteria:** Reservations do not over-allocate platform-controlled
stock, and integrations have measurable sync reliability.

### Phase 4 --- Scale and advanced operations

-   Multi-branch transfers and consolidated reporting.
-   Additional integrations and APIs.
-   Advanced catalogue deduplication.
-   Batch/expiry/serial support where appropriate.
-   Enterprise permissions and audit capabilities.
-   Premium analytics and carefully governed sponsored listings.
-   Expand categories and localities based on evidence.

### Roadmap diagram

``` mermaid
flowchart LR
    P0[Phase 0: Discover and validate] --> P1[Phase 1: Inventory foundation]
    P1 --> P2[Phase 2: Consumer discovery]
    P2 --> P3[Phase 3: Reservations and sync]
    P3 --> P4[Phase 4: Scale and advanced operations]
```

------------------------------------------------------------------------

## 17. Validation Plan and Success Metrics

### 17.1 Merchant validation

Measure: - Time required to onboard a shop. - Percentage of catalogue
records imported successfully. - Weekly active merchants. - Percentage
of products with recently verified stock. - Stock discrepancy rate
during physical checks. - Sync job success rate and median sync lag. -
Merchant retention and willingness to pay. - Time spent on routine
inventory operations.

### 17.2 Consumer validation

Measure: - Search-to-relevant-result rate. - Percentage of searches with
at least one nearby match. - Search-to-contact or directions rate. -
Reservation request-to-confirmation rate. - Reservation fulfilment
rate. - Reports of inaccurate availability. - Repeat searches and
returning consumers. - Consumer satisfaction after visiting a shop.

### 17.3 Platform reliability

Measure: - API availability and latency. - Search latency. - Reservation
conflict/failure rate. - Duplicate-event rate. - Import error rate. -
Data freshness distribution. - Tenant authorization test coverage. -
Backup restore success and incident resolution time.

### 17.4 North-star metric candidate

A useful early north-star metric is **successful local product
fulfilments influenced by the platform**. This combines consumer value
with merchant value more directly than downloads or listings alone.
Track it only when fulfilment can be measured reliably; in the earliest
pilot, use verified contact/reservation outcomes as proxies.

------------------------------------------------------------------------

## 18. Future Enhancements

Potential later capabilities, subject to validation: - Barcode scanning
for stock receiving and stock counts. - Purchase-order
recommendations. - Supplier portals and catalogue feeds. -
Branch-to-branch stock transfer workflows. - Customer loyalty and
repeat-purchase tools. - Merchant storefronts and curated collections. -
Better synonym and typo handling. - Demand forecasting once reliable
historical data exists. - Automated data-quality warnings. - Accounting
and POS partner integrations. - Consumer saved lists and stock alerts. -
Reservation pickup windows and fulfilment statuses. - Enterprise APIs
and webhooks. - Optional AI-assisted catalogue cleanup, with human
review for consequential mappings. - Analytics for merchant demand and
product availability gaps, with privacy safeguards.

AI features should not be required for the initial core product. Start
with deterministic inventory rules, auditable sync, and reliable search.

------------------------------------------------------------------------

## 19. Decisions to Resolve Before Implementation

1.  Which city/locality will be the pilot market?
2.  Which initial categories offer the best combination of demand,
    merchant readiness, and manageable compliance?
3.  Is the first release web-first, mobile-first, or both?
4.  Which merchant systems are most common among target shops?
5.  Which fields are authoritative in each external integration?
6.  Will reservation requests be manual-confirmation only at launch?
7.  Will exact quantity ever be public, or only an availability label?
8.  How fresh must inventory data be before it can be labelled
    "Available"?
9.  What is the initial subscription and onboarding model?
10. What support will be provided for data migration and legacy
    connectors?
11. What is the minimum legal/compliance review needed for each launch
    category?
12. Which operational metrics will define a successful pilot?

------------------------------------------------------------------------

## 20. Suggested Initial Pilot

A practical pilot could focus on a compact geographic area and a small
set of merchants, rather than launching across an entire city.

Pilot sequence: 1. Recruit a small group of merchants with a clear
inventory pain point. 2. Import and clean their product catalogues. 3.
Help them maintain stock through the simplest reliable workflow. 4.
Publish only listings with adequate data quality and merchant approval.
5. Test consumer search and contact/directions first. 6. Add
reservations after stock-change and freshness behavior is understood. 7.
Compare consumer reports with actual shop stock. 8. Review merchant
retention and willingness to pay before expanding.

The precise number of merchants and categories should be decided after
local discovery rather than guessed in advance.

------------------------------------------------------------------------

## 21. Final Product Definition

**Local Commerce & Cloud Inventory Network** is a multi-tenant cloud
platform that helps merchants manage products and inventory across one
or more branches, synchronize authorized data from existing systems, and
publish selected availability information to nearby consumers. Consumers
can discover local shops by product or category, assess stock freshness,
contact merchants, get directions, and request reservations where
supported.

Its distinguishing feature is the combination of **operational inventory
software** and **local product discovery**, connected through a shared,
auditable availability layer.

The key to success is not simply listing many shops. It is building a
trustworthy inventory update process, reducing the effort merchants
spend maintaining stock, making consumer availability claims
appropriately cautious, and proving value in a focused market before
expanding.

------------------------------------------------------------------------

## Appendix A --- Core User Flows

### Merchant onboarding

``` mermaid
flowchart TD
    A[Create organisation] --> B[Add branch and business details]
    B --> C[Invite staff and assign roles]
    C --> D[Import or create product catalogue]
    D --> E[Review product and branch mappings]
    E --> F[Enter opening stock or reconcile source]
    F --> G[Configure public listing controls]
    G --> H[Publish approved inventory signals]
    H --> I[Monitor freshness, discrepancies, and alerts]
```

### Stock update and publication

``` mermaid
sequenceDiagram
    participant Staff as Merchant Staff
    participant API as Platform API
    participant Ledger as Inventory Ledger
    participant Search as Search Index
    participant Consumer as Consumer App

    Staff->>API: Record stock receipt / sale / adjustment
    API->>Ledger: Validate and append stock movement
    Ledger-->>API: Commit updated availability
    API->>Search: Publish authorized availability update
    Search-->>Consumer: Return listing with freshness metadata
    Consumer->>Consumer: Display status and last-updated time
```

### Import failure handling

``` mermaid
flowchart TD
    A[Upload or receive source data] --> B[Validate file and schema]
    B -->|Invalid file| C[Reject with actionable errors]
    B -->|Valid structure| D[Stage rows]
    D --> E[Map products and branches]
    E -->|Ambiguous mapping| F[Human review queue]
    E -->|Valid mapping| G[Apply idempotent events]
    G --> H[Reconcile totals and record audit]
    H --> I[Report results and sync freshness]
    F --> E
```

## Appendix B --- Non-Functional Requirements Checklist

-   [ ] Tenant isolation is enforced and tested.
-   [ ] All stock mutations are authenticated and authorized.
-   [ ] Critical inventory operations are transactional.
-   [ ] Reservation endpoints are idempotent.
-   [ ] Import jobs support validation, staging, retries, and error
    reports.
-   [ ] Public availability includes freshness metadata.
-   [ ] Stale data is not silently presented as guaranteed stock.
-   [ ] Audit logs capture important changes without storing secrets.
-   [ ] Backup and restore procedures are tested.
-   [ ] API rate limits and abuse controls are configured.
-   [ ] Search results expose only merchant-approved fields.
-   [ ] Integration credentials are encrypted and revocable.
-   [ ] Category-specific compliance requirements are reviewed before
    launch.
-   [ ] Accessibility, responsive layouts, and low-bandwidth behavior
    are tested.
-   [ ] Data export and merchant offboarding are defined.

## Appendix C --- Glossary

-   **Availability:** A calculated indication of whether an item can
    likely be supplied at a branch.
-   **Canonical product:** A normalized product record used to reconcile
    different names or identifiers.
-   **Inventory ledger:** A record of stock-changing events used to
    audit and calculate inventory.
-   **Merchant listing:** The merchant- and branch-specific public
    representation of a product.
-   **Reservation:** A request or confirmed temporary commitment for a
    product quantity.
-   **Sync job:** A tracked import/export or integration operation.
-   **Tenant:** An organisation boundary used to isolate merchant data.
-   **Sellable stock:** Stock that is not reserved, committed, damaged,
    expired, or otherwise unavailable under the applicable rules.
