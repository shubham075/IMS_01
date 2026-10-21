-- 0005_sync_notify_billing: imports, review queue, offline sync log, notifications, subscription billing.
-- FRD: FR-IMP, FR-OFF, FR-NOT, FR-BIL. docs/01: M1-M11, O1-O11, B1-B4.

-- ---------- Imports ----------
CREATE TABLE import_job (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  branch_id    uuid,
  kind         text NOT NULL CHECK (kind IN ('products','opening_stock','snapshot')),
  status       text NOT NULL DEFAULT 'uploaded'
               CHECK (status IN ('uploaded','validated','needs_review','applying','applied','failed','undone')),
  file_key     text NOT NULL,
  file_name    text,
  snapshot_ts  timestamptz,                 -- when the source data was true (M1: delta uses this, not "now")
  total_rows   int NOT NULL DEFAULT 0,
  applied_rows int NOT NULL DEFAULT 0,
  error_rows   int NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  applied_at   timestamptz,
  undone_at    timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);
CREATE TABLE import_row (
  org_id     uuid NOT NULL,
  job_id     uuid NOT NULL,
  row_no     int  NOT NULL,
  raw        jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','error','needs_review','skipped','applied')),
  error_code text,
  message    text,
  product_id uuid,
  PRIMARY KEY (job_id, row_no),             -- also the idempotency key for restarting a crashed job (M6)
  FOREIGN KEY (org_id, job_id) REFERENCES import_job (org_id, id) ON DELETE CASCADE
);
CREATE TABLE import_mapping (                -- remembered mappings: source code -> product (FR-IMP-04)
  org_id     uuid NOT NULL,
  source_key text NOT NULL,
  product_id uuid NOT NULL,
  PRIMARY KEY (org_id, source_key),
  FOREIGN KEY (org_id, product_id) REFERENCES product (org_id, id) ON DELETE CASCADE
);

-- Anything a human must decide: unknown products, offline ops from removed users (D-02), discrepancies.
CREATE TABLE review_queue_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('product_mapping','offline_op','discrepancy','import_row','listing_report')),
  ref_type    text,
  ref_id      text,
  payload     jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected')),
  resolved_by uuid REFERENCES app_user(id),
  resolved_at timestamptz,
  resolution  jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_queue_open_idx ON review_queue_item (org_id, status, created_at);

-- Offline mobile: every client operation is recorded once (idempotent by client uuid). FR-OFF, docs/01 O1-O11.
CREATE TABLE sync_op_log (
  org_id         uuid NOT NULL,
  client_op_uuid uuid NOT NULL,
  device_id      uuid,
  client_seq     bigint,
  op_type        text NOT NULL,
  payload        jsonb NOT NULL,
  client_ts      timestamptz,
  result         text NOT NULL CHECK (result IN ('applied','duplicate','rejected','needs_review','blocked')),
  error_code     text,
  movement_id    uuid,
  received_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, client_op_uuid)
);
CREATE INDEX sync_op_device_idx ON sync_op_log (org_id, device_id, client_seq);

-- ---------- Notifications ----------
CREATE TABLE notification (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid REFERENCES organization(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  type       text NOT NULL,                   -- low_stock, discrepancy, import_done, report_received, billing ...
  title      text NOT NULL,
  body       text,
  data       jsonb NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_user_idx ON notification (user_id, created_at DESC);
CREATE TABLE notification_pref (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  type    text NOT NULL,
  in_app  boolean NOT NULL DEFAULT true,
  push    boolean NOT NULL DEFAULT false,     -- opt-in (FR-NOT-02)
  sms     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, type)
);

-- ---------- Billing (the merchant's subscription to the platform; FR-BIL) ----------
CREATE TABLE plan (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  features            jsonb NOT NULL DEFAULT '{}',    -- {"transfers": true, ...}  founder fills in after review (D-22)
  limits              jsonb NOT NULL DEFAULT '{}',    -- {"branches": 1, "staff": 2, ...}
  price_monthly_paise bigint,                          -- null = to be decided
  price_annual_paise  bigint,
  active              boolean NOT NULL DEFAULT true
);
INSERT INTO plan (id, name) VALUES ('free', 'Free'), ('premium', 'Premium');

CREATE TABLE subscription (
  org_id               uuid PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  plan_id              text NOT NULL REFERENCES plan(id),
  status               text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('trialing','active','past_due','grace','read_only','cancelled')),
  billing_cycle        text CHECK (billing_cycle IN ('monthly','annual')),
  current_period_start timestamptz,
  current_period_end   timestamptz,
  trial_ends_at        timestamptz,
  grace_until          timestamptz,                    -- B1: retries, then 7-day grace, then read-only
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  gateway_customer_ref text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER subscription_updated BEFORE UPDATE ON subscription FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invoice_counter (fy text PRIMARY KEY, last_no int NOT NULL DEFAULT 0);
-- Gap-free invoice numbers per financial year (Apr-Mar), e.g. INV/2026-27/000001. CA to confirm the format (FRD F-3).
CREATE FUNCTION next_invoice_number(p_at timestamptz DEFAULT now()) RETURNS text LANGUAGE plpgsql AS $$
DECLARE y int := extract(year FROM p_at AT TIME ZONE 'Asia/Kolkata')::int; m int := extract(month FROM p_at AT TIME ZONE 'Asia/Kolkata')::int;
        v_fy text; n int;
BEGIN
  IF m < 4 THEN y := y - 1; END IF;
  v_fy := y || '-' || lpad(((y + 1) % 100)::text, 2, '0');
  INSERT INTO invoice_counter (fy, last_no) VALUES (v_fy, 1)
    ON CONFLICT (fy) DO UPDATE SET last_no = invoice_counter.last_no + 1 RETURNING last_no INTO n;
  RETURN 'INV/' || v_fy || '/' || lpad(n::text, 6, '0');
END $$;

CREATE TABLE invoice (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organization(id),
  number          text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','paid','void')),
  period_start    timestamptz,
  period_end      timestamptz,
  subtotal_paise  bigint NOT NULL CHECK (subtotal_paise >= 0),
  gst_rate_bp     int NOT NULL DEFAULT 1800,           -- basis points; rate/SAC verified by the CA before billing (FRD F-2)
  gst_paise       bigint NOT NULL CHECK (gst_paise >= 0),
  total_paise     bigint NOT NULL CHECK (total_paise = subtotal_paise + gst_paise),
  customer_gstin  text,
  place_of_supply text,
  sac             text,
  pdf_key         text,
  issued_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organization(id),
  invoice_id         uuid REFERENCES invoice(id),
  gateway            text NOT NULL,
  gateway_order_id   text NOT NULL,
  gateway_payment_id text,
  amount_paise       bigint NOT NULL CHECK (amount_paise > 0),
  status             text NOT NULL DEFAULT 'created' CHECK (status IN ('created','authorized','captured','failed','refunded')),
  method             text,
  idempotency_key    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  captured_at        timestamptz,
  UNIQUE (gateway, gateway_order_id)
);
-- Gateway webhooks are deduplicated here; payment truth comes only from verified webhooks (docs/02 P1-P3 patterns).
CREATE TABLE payment_event (
  provider          text NOT NULL,
  provider_event_id text NOT NULL,
  type              text NOT NULL,
  payload_hash      text NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  PRIMARY KEY (provider, provider_event_id)
);

-- Server-side entitlement check (error code ENTITLEMENT_REQUIRED when false). Read-only orgs lose paid features.
CREATE FUNCTION org_has_feature(p_org uuid, p_feature text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT (pl.features ->> p_feature)::boolean
       FROM subscription s JOIN plan pl ON pl.id = s.plan_id
      WHERE s.org_id = p_org AND s.status IN ('trialing','active','past_due','grace')), false)
$$;

SELECT enable_tenant_rls('import_job');
SELECT enable_tenant_rls('import_row');
SELECT enable_tenant_rls('import_mapping');
SELECT enable_tenant_rls('review_queue_item');
SELECT enable_tenant_rls('sync_op_log');
SELECT enable_tenant_rls('subscription');
SELECT enable_tenant_rls('invoice');
SELECT enable_tenant_rls('payment');

ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_own ON notification USING (user_id = current_user_id()) WITH CHECK (org_id IS NULL OR org_id = current_org_id() OR user_id = current_user_id());
