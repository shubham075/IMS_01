-- 0004_publication_search: merchant publication controls, the public listing projection, availability labels,
-- Hindi/English/Hinglish search, inaccuracy reports, interest counters.
-- FRD: FR-PUB, FR-SRCH, FR-SHOP, FR-RPT. Rules: BR-01..BR-07, D-05 (never expose quantity), D-10, D-16.

-- What a merchant chose to publish, per branch x product (FR-PUB-02/03).
CREATE TABLE merchant_listing (
  org_id        uuid NOT NULL,
  branch_id     uuid NOT NULL,
  product_id    uuid NOT NULL,
  is_published  boolean NOT NULL DEFAULT false,
  show_price    boolean NOT NULL DEFAULT false,
  price_paise   bigint CHECK (price_paise IS NULL OR price_paise >= 0),    -- overrides product.price_paise
  price_updated_at timestamptz,
  temporarily_unavailable boolean NOT NULL DEFAULT false,
  published_by  uuid REFERENCES app_user(id),
  published_at  timestamptz,
  PRIMARY KEY (branch_id, product_id),
  FOREIGN KEY (org_id, branch_id)  REFERENCES branch  (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, product_id) REFERENCES product (org_id, id) ON DELETE CASCADE
);
SELECT enable_tenant_rls('merchant_listing');

-- Public projection: ONLY merchant-approved fields. Never contains quantity, cost or supplier data (D-05).
-- Rebuilt by the worker from outbox events; the ledger stays authoritative (graceful degradation).
CREATE TABLE public_listing (
  branch_id       uuid NOT NULL,
  product_id      uuid NOT NULL,
  org_id          uuid NOT NULL,
  shop_name       text NOT NULL,
  branch_name     text NOT NULL,
  address_line    text,
  area            text,
  city            text,
  pincode         text,
  geo             geography(Point, 4326) NOT NULL,
  phone_public    text,
  whatsapp_public text,
  contact_options text[] NOT NULL DEFAULT '{}',
  timezone        text NOT NULL DEFAULT 'Asia/Kolkata',
  hours           jsonb NOT NULL DEFAULT '{}',
  hours_verified  boolean NOT NULL DEFAULT false,
  closed_override text,
  closed_until    timestamptz,
  branch_synced_at timestamptz,
  category_id     uuid,
  product_name    text NOT NULL,
  product_name_hi text,
  brand           text,
  model           text,
  unit            text,
  pack_size       text,
  price_paise     bigint,                      -- null when the merchant hides price
  price_updated_at timestamptz,
  base_status     text NOT NULL CHECK (base_status IN ('in','limited','out','unavailable','unknown')),
  last_verified_at timestamptz,
  ttl_seconds     int NOT NULL,
  discrepancy     boolean NOT NULL DEFAULT false,
  search_text     text NOT NULL,               -- lower-cased, unaccented
  tsv             tsvector NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, product_id)
);
CREATE INDEX public_listing_geo_idx  ON public_listing USING gist (geo);
CREATE INDEX public_listing_tsv_idx  ON public_listing USING gin (tsv);
CREATE INDEX public_listing_trgm_idx ON public_listing USING gin (search_text gin_trgm_ops);

-- Equivalent words across Hindi / English / Hinglish (FR-SRCH-02). One group_id = one meaning. Single tokens only.
CREATE TABLE search_synonym (
  group_id int  NOT NULL,
  term     text NOT NULL,                      -- stored lower-cased + unaccented
  PRIMARY KEY (group_id, term)
);
CREATE INDEX search_synonym_term_idx ON search_synonym (term);
INSERT INTO search_synonym (group_id, term) VALUES
  (1,'fan'),(1,'pankha'),(1,'पंखा'),
  (2,'bulb'),(2,'बल्ब'),(2,'led'),
  (3,'notebook'),(3,'copy'),(3,'कॉपी'),(3,'नोटबुक'),
  (4,'pen'),(4,'कलम'),(4,'पेन'),(4,'kalam'),
  (5,'hammer'),(5,'hathoda'),(5,'हथौड़ा'),
  (6,'charger'),(6,'चार्जर'),
  (7,'wire'),(7,'तार'),(7,'tar'),(7,'cable');

-- Branch opening state (FR-SHOP-01, docs/01 Q7). 'unknown' when hours were never verified.
CREATE FUNCTION branch_open_state(p_hours jsonb, p_verified boolean, p_override text, p_until timestamptz,
                                  p_tz text, p_at timestamptz DEFAULT now()) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE v_local timestamp; v_key text; slot jsonb;
BEGIN
  IF p_override IS NOT NULL AND (p_until IS NULL OR p_until > p_at) THEN RETURN 'closed'; END IF;
  IF NOT p_verified THEN RETURN 'unknown'; END IF;
  v_local := p_at AT TIME ZONE p_tz;
  v_key := (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[extract(dow FROM v_local)::int + 1];
  FOR slot IN SELECT * FROM jsonb_array_elements(COALESCE(p_hours -> v_key, '[]'::jsonb)) LOOP
    IF v_local::time >= (slot ->> 0)::time AND v_local::time < (slot ->> 1)::time THEN RETURN 'open'; END IF;
  END LOOP;
  RETURN 'closed';
END $$;

-- The single source of the public availability label (BR-01). All clients display this value.
CREATE FUNCTION availability_label(p_base text, p_verified timestamptz, p_ttl int, p_discrepancy boolean,
                                   p_branch_synced timestamptz, p_at timestamptz DEFAULT now()) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_base = 'unavailable'                                              THEN 'temporarily_unavailable'
    WHEN p_discrepancy                                                       THEN 'check_with_shop'
    WHEN p_verified IS NULL OR p_at - p_verified > make_interval(secs => p_ttl) THEN 'check_with_shop'
    WHEN p_branch_synced IS NOT NULL AND p_at - p_branch_synced > interval '24 hours' THEN 'check_with_shop'  -- offline rule
    WHEN p_base = 'in'      THEN 'available'
    WHEN p_base = 'limited' THEN 'limited_stock'
    WHEN p_base = 'out'     THEN 'out_of_stock'
    ELSE 'check_with_shop'
  END
$$;

-- Rebuilds one public listing from the private tables, or removes it if it must not be public.
CREATE FUNCTION refresh_public_listing(p_branch uuid, p_product uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v record; v_sellable numeric; v_thr numeric; v_base text; v_ttl int; v_text text; v_price bigint; v_price_at timestamptz;
BEGIN
  SELECT b.org_id, b.name AS branch_name, o.name AS shop_name, b.address_line, b.area, b.city, b.pincode, b.geo,
         b.phone_public, b.whatsapp_public, b.contact_options, b.timezone, b.hours, b.hours_verified,
         b.closed_override, b.closed_until, b.last_synced_at, b.is_published AS b_pub, b.status AS b_status, o.status AS o_status,
         p.name AS p_name, p.name_hi, p.brand, p.model, p.unit, p.pack_size, p.status AS p_status, p.tracking_mode,
         p.low_stock_threshold AS p_thr, p.price_paise AS p_price, p.price_updated_at AS p_price_at, p.category_id,
         c.restricted, c.ttl_seconds AS cat_ttl, c.name_en AS cat_en, c.name_hi AS cat_hi,
         l.is_published AS l_pub, l.show_price, l.price_paise AS l_price, l.price_updated_at AS l_price_at, l.temporarily_unavailable,
         ib.on_hand, ib.reserved, ib.unsellable, ib.discrepancy, ib.status_override, ib.low_stock_threshold AS b_thr,
         ib.last_verified_at, ib.last_source
    INTO v
    FROM branch b
    JOIN organization o ON o.id = b.org_id
    JOIN product p ON p.org_id = b.org_id AND p.id = p_product
    LEFT JOIN category c ON c.id = p.category_id
    LEFT JOIN merchant_listing l ON l.branch_id = b.id AND l.product_id = p.id
    LEFT JOIN inventory_balance ib ON ib.branch_id = b.id AND ib.product_id = p.id
   WHERE b.id = p_branch;

  IF NOT FOUND OR NOT COALESCE(v.b_pub, false) OR v.b_status <> 'active' OR v.o_status <> 'active'
     OR NOT COALESCE(v.l_pub, false) OR v.p_status <> 'active' OR COALESCE(v.restricted, false) OR v.geo IS NULL THEN
    DELETE FROM public_listing WHERE branch_id = p_branch AND product_id = p_product;
    RETURN;
  END IF;

  v_sellable := COALESCE(v.on_hand, 0) - COALESCE(v.reserved, 0) - COALESCE(v.unsellable, 0);
  v_thr := COALESCE(v.b_thr, v.p_thr, 0);
  v_base := CASE
    WHEN v.temporarily_unavailable THEN 'unavailable'
    WHEN v.tracking_mode = 'status_only' THEN CASE v.status_override WHEN 'in_stock' THEN 'in' WHEN 'out_of_stock' THEN 'out' ELSE 'unknown' END
    WHEN v.on_hand IS NULL THEN 'unknown'
    WHEN v_sellable <= 0 THEN 'out'
    WHEN v_sellable <= v_thr THEN 'limited'
    ELSE 'in' END;
  v_ttl := COALESCE(v.cat_ttl, CASE v.last_source WHEN 'manual' THEN 604800 WHEN 'csv' THEN 259200 WHEN 'api' THEN 259200
                                                  WHEN 'connector' THEN 259200 ELSE 86400 END);   -- D-16
  v_price := CASE WHEN v.show_price THEN COALESCE(v.l_price, v.p_price) END;
  v_price_at := CASE WHEN v.show_price THEN COALESCE(v.l_price_at, v.p_price_at) END;
  v_text := lower(f_unaccent(concat_ws(' ', v.p_name, v.name_hi, v.brand, v.model, v.cat_en, v.cat_hi,
              (SELECT string_agg(value, ' ') FROM product_identifier WHERE org_id = v.org_id AND product_id = p_product
                  AND kind IN ('alias','sku','barcode')))));

  INSERT INTO public_listing AS pl (branch_id, product_id, org_id, shop_name, branch_name, address_line, area, city, pincode, geo,
      phone_public, whatsapp_public, contact_options, timezone, hours, hours_verified, closed_override, closed_until, branch_synced_at,
      category_id, product_name, product_name_hi, brand, model, unit, pack_size, price_paise, price_updated_at,
      base_status, last_verified_at, ttl_seconds, discrepancy, search_text, tsv, updated_at)
  VALUES (p_branch, p_product, v.org_id, v.shop_name, v.branch_name, v.address_line, v.area, v.city, v.pincode, v.geo,
      v.phone_public, v.whatsapp_public, v.contact_options, v.timezone, v.hours, v.hours_verified, v.closed_override, v.closed_until, v.last_synced_at,
      v.category_id, v.p_name, v.name_hi, v.brand, v.model, v.unit, v.pack_size, v_price, v_price_at,
      v_base, v.last_verified_at, v_ttl, COALESCE(v.discrepancy, false), v_text, to_tsvector('simple', v_text), now())
  ON CONFLICT (branch_id, product_id) DO UPDATE SET
      org_id = EXCLUDED.org_id, shop_name = EXCLUDED.shop_name, branch_name = EXCLUDED.branch_name, address_line = EXCLUDED.address_line,
      area = EXCLUDED.area, city = EXCLUDED.city, pincode = EXCLUDED.pincode, geo = EXCLUDED.geo, phone_public = EXCLUDED.phone_public,
      whatsapp_public = EXCLUDED.whatsapp_public, contact_options = EXCLUDED.contact_options, timezone = EXCLUDED.timezone,
      hours = EXCLUDED.hours, hours_verified = EXCLUDED.hours_verified, closed_override = EXCLUDED.closed_override,
      closed_until = EXCLUDED.closed_until, branch_synced_at = EXCLUDED.branch_synced_at, category_id = EXCLUDED.category_id,
      product_name = EXCLUDED.product_name, product_name_hi = EXCLUDED.product_name_hi, brand = EXCLUDED.brand, model = EXCLUDED.model,
      unit = EXCLUDED.unit, pack_size = EXCLUDED.pack_size, price_paise = EXCLUDED.price_paise, price_updated_at = EXCLUDED.price_updated_at,
      base_status = EXCLUDED.base_status, last_verified_at = EXCLUDED.last_verified_at, ttl_seconds = EXCLUDED.ttl_seconds,
      discrepancy = EXCLUDED.discrepancy, search_text = EXCLUDED.search_text, tsv = EXCLUDED.tsv, updated_at = now();
END $$;

-- Branch-level change (open/close, publish, address): refresh every listing of the branch.
CREATE FUNCTION refresh_public_branch(p_branch uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT product_id FROM merchant_listing WHERE branch_id = p_branch
           UNION SELECT product_id FROM public_listing WHERE branch_id = p_branch LOOP
    PERFORM refresh_public_listing(p_branch, r.product_id); n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Query -> tsquery with Hindi/English synonym expansion and prefix matching. NULL when the query has no words.
CREATE FUNCTION build_tsquery(p_q text) RETURNS tsquery LANGUAGE plpgsql STABLE AS $$
DECLARE w text; parts text[] := '{}'; alts text[]; s text;
BEGIN
  FOR w IN SELECT x FROM unnest(regexp_split_to_array(lower(f_unaccent(trim(p_q))), '[\s[:punct:]]+')) x WHERE x <> '' LOOP
    alts := ARRAY[quote_literal(w) || ':*'];
    FOR s IN SELECT DISTINCT t.term FROM search_synonym g JOIN search_synonym t USING (group_id) WHERE g.term = w AND t.term <> w LOOP
      alts := alts || (quote_literal(s) || ':*');
    END LOOP;
    parts := parts || ('(' || array_to_string(alts, ' | ') || ')');
  END LOOP;
  IF cardinality(parts) = 0 THEN RETURN NULL; END IF;
  RETURN to_tsquery('simple', array_to_string(parts, ' & '));
END $$;

-- Public search (FR-SRCH-01..05, FR-SRCH-08). Anonymous; reads only public_listing.
CREATE FUNCTION search_listings(p_q text, p_lat double precision, p_lng double precision, p_radius_m int DEFAULT 5000,
                                p_limit int DEFAULT 30, p_offset int DEFAULT 0, p_at timestamptz DEFAULT now())
RETURNS TABLE (branch_id uuid, product_id uuid, shop_name text, branch_name text, address_line text, product_name text,
               product_name_hi text, brand text, unit text, distance_m int, label text, last_verified_at timestamptz,
               price_paise bigint, open_state text, phone_public text, score double precision)
LANGUAGE sql STABLE AS $$
  WITH q AS (
    SELECT lower(f_unaccent(trim(p_q))) AS txt, build_tsquery(p_q) AS tq,
           ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS pt,
           COALESCE((SELECT enabled FROM feature_flag WHERE key = 'public_degraded'), false) AS degraded
  ), hits AS (
    SELECT l.*, ST_Distance(l.geo, q.pt) AS dist, q.degraded,
           GREATEST(CASE WHEN q.tq IS NULL THEN 0 ELSE ts_rank(l.tsv, q.tq) END, similarity(l.search_text, q.txt)) AS text_score
    FROM public_listing l, q
    WHERE ST_DWithin(l.geo, q.pt, p_radius_m)
      AND ((q.tq IS NOT NULL AND l.tsv @@ q.tq) OR l.search_text ILIKE '%' || q.txt || '%' OR similarity(l.search_text, q.txt) > 0.3)
  ), labelled AS (
    SELECT h.*, CASE WHEN h.degraded THEN 'check_with_shop'
                     ELSE availability_label(h.base_status, h.last_verified_at, h.ttl_seconds, h.discrepancy, h.branch_synced_at, p_at) END AS lbl
    FROM hits h
  )
  SELECT d.branch_id, d.product_id, d.shop_name, d.branch_name, d.address_line, d.product_name, d.product_name_hi, d.brand, d.unit,
         d.dist::int, d.lbl, d.last_verified_at,
         CASE WHEN d.price_paise IS NOT NULL AND d.price_updated_at > p_at - interval '14 days' THEN d.price_paise END,   -- D-10
         branch_open_state(d.hours, d.hours_verified, d.closed_override, d.closed_until, d.timezone, p_at),
         d.phone_public,
         (2 * d.text_score
          + CASE d.lbl WHEN 'available' THEN 1.0 WHEN 'limited_stock' THEN 0.8 WHEN 'check_with_shop' THEN 0.3
                       WHEN 'temporarily_unavailable' THEN 0.05 ELSE 0 END
          + 1.0 / (1 + d.dist / 1000.0))::double precision AS score
  FROM labelled d
  ORDER BY score DESC, d.dist
  LIMIT p_limit OFFSET p_offset
$$;

-- Consumer reports "not available / wrong price / shop closed / wrong info" (FR-RPT). No auto-delisting (Q6).
CREATE TABLE inaccuracy_report (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL,
  product_id  uuid,
  consumer_id uuid NOT NULL REFERENCES app_user(id),
  type        text NOT NULL CHECK (type IN ('not_available','wrong_price','shop_closed','wrong_info')),
  note        text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixed','disputed','dismissed')),
  merchant_note text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id) ON DELETE CASCADE
);
CREATE INDEX inaccuracy_org_idx ON inaccuracy_report (org_id, status, created_at DESC);
CREATE INDEX inaccuracy_consumer_idx ON inaccuracy_report (consumer_id, created_at DESC);
ALTER TABLE inaccuracy_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE inaccuracy_report FORCE ROW LEVEL SECURITY;
CREATE POLICY report_read   ON inaccuracy_report FOR SELECT USING (org_id = current_org_id() OR consumer_id = current_user_id());
CREATE POLICY report_insert ON inaccuracy_report FOR INSERT WITH CHECK (consumer_id = current_user_id());
CREATE POLICY report_update ON inaccuracy_report FOR UPDATE USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

-- Anonymous interest counters (FR-REP-07). Aggregates only; no user identifiers.
CREATE TABLE listing_event_daily (
  day        date NOT NULL,
  org_id     uuid NOT NULL,
  branch_id  uuid NOT NULL,
  product_id uuid NOT NULL,
  views      int NOT NULL DEFAULT 0,
  calls      int NOT NULL DEFAULT 0,
  directions int NOT NULL DEFAULT 0,
  whatsapp   int NOT NULL DEFAULT 0,
  PRIMARY KEY (day, branch_id, product_id)
);
ALTER TABLE listing_event_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_event_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY event_read ON listing_event_daily FOR SELECT USING (org_id = current_org_id());

-- Consumers have no org context, so counting is done by a definer function (the only write path).
CREATE FUNCTION bump_listing_event(p_branch uuid, p_product uuid, p_kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  IF p_kind NOT IN ('views','calls','directions','whatsapp') THEN
    RAISE EXCEPTION 'invalid event kind' USING ERRCODE = '22023', HINT = 'VALIDATION_FAILED'; END IF;
  SELECT org_id INTO v_org FROM public_listing WHERE branch_id = p_branch AND product_id = p_product;
  IF v_org IS NULL THEN RETURN; END IF;
  EXECUTE format('INSERT INTO listing_event_daily (day, org_id, branch_id, product_id, %1$I) VALUES (current_date, $1, $2, $3, 1)
                  ON CONFLICT (day, branch_id, product_id) DO UPDATE SET %1$I = listing_event_daily.%1$I + 1', p_kind)
    USING v_org, p_branch, p_product;
END $$;

CREATE TABLE favourite (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
  product_id  uuid REFERENCES product(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX favourite_uidx ON favourite (consumer_id, branch_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE favourite ENABLE ROW LEVEL SECURITY;
ALTER TABLE favourite FORCE ROW LEVEL SECURITY;
CREATE POLICY favourite_own ON favourite USING (consumer_id = current_user_id()) WITH CHECK (consumer_id = current_user_id());
