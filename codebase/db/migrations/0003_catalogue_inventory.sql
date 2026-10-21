-- 0003_catalogue_inventory: categories, products, identifiers, and the inventory ledger.
-- FRD: FR-CAT, FR-INV. Rules: D-01 (negative stock allowed + flagged), D-06 (counts don't freeze),
-- BR-09 (history is never edited). docs/01: S1-S11, T1-T6.

-- ---------- Catalogue ----------
CREATE TABLE category (                          -- global reference data
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  parent_id   uuid REFERENCES category(id),
  name_en     text NOT NULL,
  name_hi     text,
  restricted  boolean NOT NULL DEFAULT false,    -- cannot be published (D-04, FR-CAT-11)
  ttl_seconds int,                               -- freshness override (BR-02)
  attr_schema jsonb NOT NULL DEFAULT '{}'        -- JSON schema for product.attrs (FR-CAT-04)
);

CREATE TABLE canonical_product (                 -- optional platform catalogue (suggested links only)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  brand       text,
  barcode     text,
  category_id uuid REFERENCES category(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canonical_barcode_idx ON canonical_product (barcode);

CREATE TABLE product (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  category_id   uuid REFERENCES category(id),
  canonical_id  uuid REFERENCES canonical_product(id),
  parent_id     uuid,                            -- variants group under a parent (FR-CAT-05)
  name          text NOT NULL,
  name_hi       text,
  brand         text,
  model         text,
  description   text,
  unit          text NOT NULL DEFAULT 'pcs',     -- base unit
  allow_fraction boolean NOT NULL DEFAULT false, -- pcs/box are whole; kg/litre may be fractional
  pack_size     text,
  attrs         jsonb NOT NULL DEFAULT '{}',
  tracking_mode text NOT NULL DEFAULT 'quantity' CHECK (tracking_mode IN ('quantity','status_only')),
  low_stock_threshold numeric(14,3) NOT NULL DEFAULT 0,
  price_paise   bigint CHECK (price_paise IS NULL OR price_paise >= 0),
  price_updated_at timestamptz,
  cost_paise    bigint CHECK (cost_paise IS NULL OR cost_paise >= 0),   -- private, never public
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','merged')),
  merged_into   uuid,                            -- alias after merge (FR-CAT-09, docs/01 C3)
  created_by    uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, parent_id)   REFERENCES product (org_id, id),
  FOREIGN KEY (org_id, merged_into) REFERENCES product (org_id, id)
);
CREATE INDEX product_org_idx ON product (org_id, status);
CREATE INDEX product_name_trgm ON product USING gin (f_unaccent(lower(name)) gin_trgm_ops);
CREATE TRIGGER product_updated BEFORE UPDATE ON product FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Barcode / SKU / alias / short code. Barcode and SKU are unique per org only (docs/01 C1).
CREATE TABLE product_identifier (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  product_id uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('barcode','sku','alias','short_code')),
  value      text NOT NULL,
  FOREIGN KEY (org_id, product_id) REFERENCES product (org_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX product_identifier_uidx ON product_identifier (org_id, kind, value) WHERE kind IN ('barcode','sku','short_code');
CREATE INDEX product_identifier_lookup ON product_identifier (org_id, value);

CREATE TABLE product_unit_conversion (          -- 1 box = 12 pcs (FR-CAT-06)
  org_id     uuid NOT NULL,
  product_id uuid NOT NULL,
  unit       text NOT NULL,
  factor     numeric(14,6) NOT NULL CHECK (factor > 0),   -- units of base unit per 1 of `unit`
  PRIMARY KEY (product_id, unit),
  FOREIGN KEY (org_id, product_id) REFERENCES product (org_id, id) ON DELETE CASCADE
);

CREATE TABLE product_image (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  product_id uuid NOT NULL,
  object_key text NOT NULL,
  sort_order int  NOT NULL DEFAULT 0,
  FOREIGN KEY (org_id, product_id) REFERENCES product (org_id, id) ON DELETE CASCADE
);

-- ---------- Ledger ----------
-- One row per stock-changing event. Append-only. Partitioned monthly. Idempotent via stock_event_key.
CREATE TABLE stock_movement (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL,
  branch_id     uuid        NOT NULL,
  product_id    uuid        NOT NULL,
  qty_delta     numeric(14,3) NOT NULL CHECK (qty_delta <> 0),
  bucket        text        NOT NULL DEFAULT 'on_hand' CHECK (bucket IN ('on_hand','unsellable')),
  reason        text        NOT NULL CHECK (reason IN ('opening','receipt','sale','customer_return','supplier_return',
                  'adjustment','damage','expiry','loss','found','transfer_out','transfer_in','count_correction',
                  'reversal','import_snapshot')),
  source        text        NOT NULL CHECK (source IN ('native','manual','csv','api','connector','system')),
  source_event_id text      NOT NULL,
  occurred_at   timestamptz NOT NULL,            -- when it happened (client clock, validated)
  source_ts     timestamptz,                     -- timestamp inside the source system, if different
  ingested_at   timestamptz NOT NULL DEFAULT now(),   -- when we received it (server clock)
  actor_user_id uuid,
  device_id     uuid,
  client_seq    bigint,
  sync_job_id   uuid,
  ref_type      text,
  ref_id        text,
  note          text,
  reverses_movement_id uuid,
  clock_unreliable boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id, occurred_at),
  FOREIGN KEY (org_id, branch_id)  REFERENCES branch  (org_id, id),
  FOREIGN KEY (org_id, product_id) REFERENCES product (org_id, id)
) PARTITION BY RANGE (occurred_at);
CREATE INDEX stock_movement_product_idx ON stock_movement (org_id, branch_id, product_id, occurred_at DESC);
CREATE INDEX stock_movement_id_idx ON stock_movement (id);
CREATE INDEX stock_movement_ref_idx ON stock_movement (org_id, ref_type, ref_id);
CREATE TRIGGER stock_movement_append_only BEFORE UPDATE OR DELETE ON stock_movement
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE stock_movement_default PARTITION OF stock_movement DEFAULT;

CREATE FUNCTION ensure_stock_movement_partitions(p_from date, p_months int) RETURNS int LANGUAGE plpgsql AS $$
DECLARE d date := date_trunc('month', p_from)::date; n int := 0;
BEGIN
  FOR i IN 0..p_months - 1 LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF stock_movement FOR VALUES FROM (%L) TO (%L)',
      'stock_movement_' || to_char(d, 'YYYY_MM'), d, (d + interval '1 month')::date);
    d := (d + interval '1 month')::date; n := n + 1;
  END LOOP;
  RETURN n;
END $$;
SELECT ensure_stock_movement_partitions((now() - interval '3 months')::date, 15);

-- Global idempotency for stock events (a partitioned table can't enforce this across partitions).
CREATE TABLE stock_event_key (
  org_id          uuid NOT NULL,
  source          text NOT NULL,
  source_event_id text NOT NULL,
  movement_id     uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, source, source_event_id)
);
-- A movement can be reversed at most once (docs/01 S8).
CREATE TABLE reversed_movement (
  org_id        uuid NOT NULL,
  movement_id   uuid NOT NULL,
  reversing_id  uuid NOT NULL,
  PRIMARY KEY (org_id, movement_id)
);

-- Current balance per branch x product (derived from the ledger, updated in the same transaction).
CREATE TABLE inventory_balance (
  org_id        uuid NOT NULL,
  branch_id     uuid NOT NULL,
  product_id    uuid NOT NULL,
  on_hand       numeric(14,3) NOT NULL DEFAULT 0,       -- may go negative (D-01)
  reserved      numeric(14,3) NOT NULL DEFAULT 0 CHECK (reserved >= 0),   -- 0 until the reservations release
  unsellable    numeric(14,3) NOT NULL DEFAULT 0,
  sellable      numeric(14,3) GENERATED ALWAYS AS (on_hand - reserved - unsellable) STORED,
  version       bigint  NOT NULL DEFAULT 0,
  discrepancy   boolean NOT NULL DEFAULT false,         -- negative stock etc.; label becomes "check with shop"
  status_override text CHECK (status_override IN ('in_stock','out_of_stock')),   -- status_only products (FR-INV-06)
  low_stock_threshold numeric(14,3),                    -- overrides product.low_stock_threshold
  last_movement_at timestamptz,
  last_verified_at timestamptz,
  last_source   text,
  PRIMARY KEY (branch_id, product_id),
  FOREIGN KEY (org_id, branch_id)  REFERENCES branch  (org_id, id),
  FOREIGN KEY (org_id, product_id) REFERENCES product (org_id, id)
);
CREATE INDEX inventory_balance_org_idx ON inventory_balance (org_id, branch_id);
CREATE INDEX inventory_balance_low_idx ON inventory_balance (org_id, branch_id) WHERE discrepancy;

-- Org-defined labels for adjustments (FR-INV-05); each maps to a ledger reason.
CREATE TABLE adjustment_reason (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  label   text NOT NULL,
  reason  text NOT NULL CHECK (reason IN ('adjustment','damage','expiry','loss','found')),
  active  boolean NOT NULL DEFAULT true
);

-- Stock counts (FR-INV-12) and transfers (FR-INV-13)
CREATE TABLE stock_count (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  branch_id    uuid NOT NULL,
  kind         text NOT NULL DEFAULT 'cycle' CHECK (kind IN ('cycle','full')),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','abandoned')),
  started_by   uuid REFERENCES app_user(id),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '7 days',   -- T6
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id)
);
CREATE TABLE stock_count_line (                   -- every scan is kept; the latest per product wins (T5)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  count_id    uuid NOT NULL,
  product_id  uuid NOT NULL,
  counted_qty numeric(14,3) NOT NULL CHECK (counted_qty >= 0),
  counted_at  timestamptz NOT NULL DEFAULT now(),
  counted_by  uuid REFERENCES app_user(id),
  FOREIGN KEY (org_id, count_id)   REFERENCES stock_count (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, product_id) REFERENCES product (org_id, id)
);
CREATE INDEX stock_count_line_idx ON stock_count_line (count_id, product_id, counted_at DESC);

CREATE TABLE stock_transfer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  from_branch uuid NOT NULL,
  to_branch   uuid NOT NULL CHECK (to_branch <> from_branch),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','dispatched','received','cancelled')),
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  received_at timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, from_branch) REFERENCES branch (org_id, id),
  FOREIGN KEY (org_id, to_branch)   REFERENCES branch (org_id, id)
);
CREATE TABLE stock_transfer_line (
  org_id       uuid NOT NULL,
  transfer_id  uuid NOT NULL,
  product_id   uuid NOT NULL,
  qty_sent     numeric(14,3) NOT NULL CHECK (qty_sent > 0),
  qty_received numeric(14,3) CHECK (qty_received IS NULL OR qty_received >= 0),
  PRIMARY KEY (transfer_id, product_id),
  FOREIGN KEY (org_id, transfer_id) REFERENCES stock_transfer (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, product_id)  REFERENCES product (org_id, id)
);

-- ---------- Core ledger function ----------
-- Runs as the caller (RLS applies). Raises errors whose HINT is the API error code (docs/01 §0.2).
CREATE FUNCTION apply_stock_movement(
  p_org uuid, p_branch uuid, p_product uuid,
  p_qty numeric, p_bucket text, p_reason text, p_source text, p_event_id text, p_occurred_at timestamptz,
  p_actor uuid DEFAULT NULL, p_device uuid DEFAULT NULL, p_client_seq bigint DEFAULT NULL,
  p_note text DEFAULT NULL, p_ref_type text DEFAULT NULL, p_ref_id text DEFAULT NULL,
  p_source_ts timestamptz DEFAULT NULL, p_allow_old boolean DEFAULT false, p_reverses uuid DEFAULT NULL,
  p_clock_unreliable boolean DEFAULT false
) RETURNS TABLE (o_movement_id uuid, o_duplicate boolean, o_on_hand numeric, o_unsellable numeric, o_discrepancy boolean)
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_status text; v_fraction boolean;
  v_bal inventory_balance%ROWTYPE;
  v_on_hand numeric; v_unsell numeric;
  v_existing uuid;
BEGIN
  IF p_qty = 0 THEN RAISE EXCEPTION 'quantity must be non-zero' USING ERRCODE = '22023', HINT = 'VALIDATION_FAILED'; END IF;
  IF p_occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'movement is dated in the future' USING ERRCODE = '22008', HINT = 'DATE_OUT_OF_RANGE'; END IF;
  IF p_occurred_at < now() - interval '30 days' AND NOT p_allow_old THEN
    RAISE EXCEPTION 'movement is back-dated beyond the limit' USING ERRCODE = '22008', HINT = 'DATE_OUT_OF_RANGE'; END IF;

  SELECT status, allow_fraction INTO v_status, v_fraction FROM product WHERE org_id = p_org AND id = p_product;
  IF NOT FOUND THEN RAISE EXCEPTION 'product not found' USING ERRCODE = 'P0002', HINT = 'NOT_FOUND'; END IF;
  IF v_status <> 'active' AND p_reason NOT IN ('count_correction','customer_return','supplier_return','adjustment','reversal') THEN
    RAISE EXCEPTION 'product is not active' USING ERRCODE = '22023', HINT = 'PRODUCT_INACTIVE'; END IF;
  IF NOT v_fraction AND p_qty <> trunc(p_qty) THEN
    RAISE EXCEPTION 'this product is counted in whole units' USING ERRCODE = '22023', HINT = 'QTY_NOT_INTEGRAL'; END IF;

  -- Idempotency: the same (org, source, event id) is applied once.
  INSERT INTO stock_event_key (org_id, source, source_event_id, movement_id)
  VALUES (p_org, p_source, p_event_id, v_id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT movement_id INTO v_existing FROM stock_event_key
      WHERE org_id = p_org AND source = p_source AND source_event_id = p_event_id;
    SELECT * INTO v_bal FROM inventory_balance WHERE branch_id = p_branch AND product_id = p_product;
    RETURN QUERY SELECT v_existing, true, v_bal.on_hand, v_bal.unsellable, v_bal.discrepancy;
    RETURN;
  END IF;

  INSERT INTO stock_movement (id, org_id, branch_id, product_id, qty_delta, bucket, reason, source, source_event_id,
      occurred_at, source_ts, actor_user_id, device_id, client_seq, note, ref_type, ref_id, reverses_movement_id, clock_unreliable)
  VALUES (v_id, p_org, p_branch, p_product, p_qty, p_bucket, p_reason, p_source, p_event_id,
      p_occurred_at, p_source_ts, p_actor, p_device, p_client_seq, p_note, p_ref_type, p_ref_id, p_reverses, p_clock_unreliable);

  INSERT INTO inventory_balance (org_id, branch_id, product_id) VALUES (p_org, p_branch, p_product) ON CONFLICT DO NOTHING;
  SELECT * INTO v_bal FROM inventory_balance WHERE branch_id = p_branch AND product_id = p_product FOR UPDATE;

  v_on_hand := v_bal.on_hand    + CASE WHEN p_bucket = 'on_hand'    THEN p_qty ELSE 0 END;
  v_unsell  := v_bal.unsellable + CASE WHEN p_bucket = 'unsellable' THEN p_qty ELSE 0 END;

  UPDATE inventory_balance SET
      on_hand = v_on_hand, unsellable = v_unsell, version = version + 1,
      discrepancy = (v_on_hand < 0 OR v_unsell < 0),
      last_movement_at = now(),
      last_verified_at = GREATEST(COALESCE(last_verified_at, '-infinity'::timestamptz), LEAST(p_occurred_at, now())),
      last_source = p_source
    WHERE branch_id = p_branch AND product_id = p_product;

  INSERT INTO outbox (org_id, topic, payload)
  VALUES (p_org, 'inventory.balance_changed', jsonb_build_object('branch_id', p_branch, 'product_id', p_product, 'movement_id', v_id));

  RETURN QUERY SELECT v_id, false, v_on_hand, v_unsell, (v_on_hand < 0 OR v_unsell < 0);
END $$;

-- Status-only tracking: "mark in stock / out of stock" (FR-INV-06).
CREATE FUNCTION set_stock_status(p_org uuid, p_branch uuid, p_product uuid, p_status text, p_actor uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_status NOT IN ('in_stock','out_of_stock') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023', HINT = 'VALIDATION_FAILED'; END IF;
  INSERT INTO inventory_balance (org_id, branch_id, product_id, status_override, last_verified_at, last_movement_at, last_source)
  VALUES (p_org, p_branch, p_product, p_status, now(), now(), 'manual')
  ON CONFLICT (branch_id, product_id) DO UPDATE
    SET status_override = EXCLUDED.status_override, last_verified_at = now(), last_movement_at = now(),
        last_source = 'manual', version = inventory_balance.version + 1;
  INSERT INTO outbox (org_id, topic, payload)
  VALUES (p_org, 'inventory.balance_changed', jsonb_build_object('branch_id', p_branch, 'product_id', p_product, 'actor', p_actor));
END $$;

-- Reverse a movement, once (S8). A reversal itself cannot be reversed.
CREATE FUNCTION reverse_stock_movement(p_org uuid, p_movement uuid, p_actor uuid, p_event_id text, p_note text DEFAULT NULL)
RETURNS TABLE (o_movement_id uuid, o_duplicate boolean, o_on_hand numeric, o_unsellable numeric, o_discrepancy boolean)
LANGUAGE plpgsql AS $$
DECLARE m stock_movement%ROWTYPE; v_new uuid;
BEGIN
  SELECT * INTO m FROM stock_movement WHERE org_id = p_org AND id = p_movement;
  IF NOT FOUND THEN RAISE EXCEPTION 'movement not found' USING ERRCODE = 'P0002', HINT = 'NOT_FOUND'; END IF;
  IF m.reverses_movement_id IS NOT NULL THEN
    RAISE EXCEPTION 'a reversal cannot be reversed' USING ERRCODE = '23505', HINT = 'ALREADY_REVERSED'; END IF;
  BEGIN
    INSERT INTO reversed_movement (org_id, movement_id, reversing_id) VALUES (p_org, p_movement, gen_random_uuid());
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'movement already reversed' USING ERRCODE = '23505', HINT = 'ALREADY_REVERSED';
  END;
  RETURN QUERY SELECT * FROM apply_stock_movement(p_org, m.branch_id, m.product_id, -m.qty_delta, m.bucket, 'reversal',
      'native', p_event_id, now(), p_actor, NULL, NULL, COALESCE(p_note, 'reversal'), 'movement', p_movement::text,
      NULL, true, p_movement);
END $$;

-- Stock count finalize (D-06): correction = counted - ledger balance AS OF counted_at. No sales freeze needed.
CREATE FUNCTION finalize_stock_count(p_org uuid, p_count uuid, p_actor uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE c stock_count%ROWTYPE; r record; v_asof numeric; v_corr numeric; n int := 0;
BEGIN
  SELECT * INTO c FROM stock_count WHERE org_id = p_org AND id = p_count FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'count not found' USING ERRCODE = 'P0002', HINT = 'NOT_FOUND'; END IF;
  IF c.status <> 'draft' THEN RAISE EXCEPTION 'count already closed' USING ERRCODE = '55000', HINT = 'VERSION_CONFLICT'; END IF;
  FOR r IN
    SELECT DISTINCT ON (product_id) product_id, counted_qty, counted_at
    FROM stock_count_line WHERE count_id = p_count ORDER BY product_id, counted_at DESC
  LOOP
    SELECT COALESCE(sum(qty_delta), 0) INTO v_asof FROM stock_movement
      WHERE org_id = p_org AND branch_id = c.branch_id AND product_id = r.product_id
        AND bucket = 'on_hand' AND occurred_at <= r.counted_at;
    v_corr := r.counted_qty - v_asof;
    IF v_corr <> 0 THEN
      PERFORM apply_stock_movement(p_org, c.branch_id, r.product_id, v_corr, 'on_hand', 'count_correction', 'native',
          'count:' || p_count || ':' || r.product_id, now(), p_actor, NULL, NULL, 'stock count', 'stock_count', p_count::text,
          NULL, true);
      n := n + 1;
    END IF;
  END LOOP;
  UPDATE stock_count SET status = 'finalized', finalized_at = now() WHERE id = p_count;
  RETURN n;
END $$;

-- Transfers: dispatch removes stock from the source (units are "in transit" while status = dispatched);
-- receive adds what arrived and books any shortage as a loss at the destination (T1-T3).
CREATE FUNCTION dispatch_stock_transfer(p_org uuid, p_transfer uuid, p_actor uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t stock_transfer%ROWTYPE; l record;
BEGIN
  SELECT * INTO t FROM stock_transfer WHERE org_id = p_org AND id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer not found' USING ERRCODE = 'P0002', HINT = 'NOT_FOUND'; END IF;
  IF t.status <> 'draft' THEN RAISE EXCEPTION 'transfer already dispatched' USING ERRCODE = '55000', HINT = 'VERSION_CONFLICT'; END IF;
  FOR l IN SELECT * FROM stock_transfer_line WHERE transfer_id = p_transfer LOOP
    PERFORM apply_stock_movement(p_org, t.from_branch, l.product_id, -l.qty_sent, 'on_hand', 'transfer_out', 'native',
        'transfer_out:' || p_transfer || ':' || l.product_id, now(), p_actor, NULL, NULL, NULL, 'stock_transfer', p_transfer::text);
  END LOOP;
  UPDATE stock_transfer SET status = 'dispatched', dispatched_at = now() WHERE id = p_transfer;
END $$;

CREATE FUNCTION receive_stock_transfer(p_org uuid, p_transfer uuid, p_actor uuid, p_received jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE t stock_transfer%ROWTYPE; l record; v_recv numeric;
BEGIN
  SELECT * INTO t FROM stock_transfer WHERE org_id = p_org AND id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer not found' USING ERRCODE = 'P0002', HINT = 'NOT_FOUND'; END IF;
  IF t.status <> 'dispatched' THEN RAISE EXCEPTION 'transfer is not in transit' USING ERRCODE = '55000', HINT = 'VERSION_CONFLICT'; END IF;
  FOR l IN SELECT * FROM stock_transfer_line WHERE transfer_id = p_transfer LOOP
    v_recv := COALESCE((p_received ->> l.product_id::text)::numeric, l.qty_sent);   -- default: everything arrived
    IF v_recv > 0 THEN
      PERFORM apply_stock_movement(p_org, t.to_branch, l.product_id, v_recv, 'on_hand', 'transfer_in', 'native',
          'transfer_in:' || p_transfer || ':' || l.product_id, now(), p_actor, NULL, NULL, NULL, 'stock_transfer', p_transfer::text);
    END IF;
    IF v_recv < l.qty_sent THEN   -- shortage: record on the source side so branch totals reconcile
      PERFORM apply_stock_movement(p_org, t.from_branch, l.product_id, l.qty_sent - v_recv, 'on_hand', 'transfer_in', 'native',
          'transfer_short_back:' || p_transfer || ':' || l.product_id, now(), p_actor, NULL, NULL, 'shortage returned to source',
          'stock_transfer', p_transfer::text);
      PERFORM apply_stock_movement(p_org, t.from_branch, l.product_id, -(l.qty_sent - v_recv), 'on_hand', 'loss', 'native',
          'transfer_short_loss:' || p_transfer || ':' || l.product_id, now(), p_actor, NULL, NULL, 'transfer shortage',
          'stock_transfer', p_transfer::text);
    END IF;
    UPDATE stock_transfer_line SET qty_received = v_recv WHERE transfer_id = p_transfer AND product_id = l.product_id;
  END LOOP;
  UPDATE stock_transfer SET status = 'received', received_at = now() WHERE id = p_transfer;
END $$;

-- Reconciliation (docs/01 §0.6): balances must equal the sum of the ledger. Empty result = healthy.
CREATE VIEW v_balance_drift WITH (security_invoker = true) AS
SELECT b.org_id, b.branch_id, b.product_id, b.on_hand, b.unsellable,
       COALESCE(m.on_hand_sum, 0) AS ledger_on_hand, COALESCE(m.unsellable_sum, 0) AS ledger_unsellable
FROM inventory_balance b
LEFT JOIN (
  SELECT org_id, branch_id, product_id,
         sum(qty_delta) FILTER (WHERE bucket = 'on_hand')    AS on_hand_sum,
         sum(qty_delta) FILTER (WHERE bucket = 'unsellable') AS unsellable_sum
  FROM stock_movement GROUP BY org_id, branch_id, product_id
) m USING (org_id, branch_id, product_id)
WHERE b.on_hand <> COALESCE(m.on_hand_sum, 0) OR b.unsellable <> COALESCE(m.unsellable_sum, 0);

-- ---------- Reference data ----------
INSERT INTO category (slug, name_en, name_hi, restricted) VALUES
  ('hardware',               'Hardware',                 'हार्डवेयर',        false),
  ('electrical',             'Electrical',               'इलेक्ट्रिकल',      false),
  ('stationery',             'Stationery',               'स्टेशनरी',          false),
  ('electronics-accessories','Electronics accessories',  'इलेक्ट्रॉनिक्स एक्सेसरीज़', false),
  ('pharmacy',               'Pharmacy',                 'दवाइयाँ',           true);

-- ---------- RLS ----------
SELECT enable_tenant_rls('product');
SELECT enable_tenant_rls('product_identifier');
SELECT enable_tenant_rls('product_unit_conversion');
SELECT enable_tenant_rls('product_image');
SELECT enable_tenant_rls('stock_movement');
SELECT enable_tenant_rls('stock_event_key');
SELECT enable_tenant_rls('reversed_movement');
SELECT enable_tenant_rls('inventory_balance');
SELECT enable_tenant_rls('adjustment_reason');
SELECT enable_tenant_rls('stock_count');
SELECT enable_tenant_rls('stock_count_line');
SELECT enable_tenant_rls('stock_transfer');
SELECT enable_tenant_rls('stock_transfer_line');
