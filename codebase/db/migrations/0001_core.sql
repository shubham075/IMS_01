-- 0001_core: extensions, app role, helpers, outbox, idempotency, audit, feature flags.
-- Conventions (docs: Backend_System_Design.md B5): uuid PKs, timestamptz UTC, money = bigint paise,
-- quantity = numeric(14,3), text+CHECK instead of enums (easy to extend), tenant tables carry org_id + RLS.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Application role: NOT a superuser, NOT owner, so row-level security always applies to it.
-- Dev password only; production sets its own secret through infra.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'idea01_app') THEN
    CREATE ROLE idea01_app LOGIN PASSWORD 'idea01_app_dev' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO idea01_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO idea01_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO idea01_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO idea01_app;

-- Request context set by the API per transaction: set_config('app.org_id', ..., true)
CREATE FUNCTION current_org_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

CREATE FUNCTION current_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation'; END $$;

-- unaccent() is STABLE; indexes need an IMMUTABLE wrapper.
CREATE FUNCTION f_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT public.unaccent('public.unaccent', $1) $$;

-- Enables tenant isolation on a table that has an org_id column.
CREATE FUNCTION enable_tenant_rls(p_table regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())', p_table);
END $$;

-- Transactional outbox: written in the same transaction as the change; a worker publishes it.
CREATE TABLE outbox (
  id           bigserial PRIMARY KEY,
  org_id       uuid,
  topic        text        NOT NULL,           -- e.g. inventory.balance_changed
  payload      jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts     int         NOT NULL DEFAULT 0,
  last_error   text,
  dead         boolean     NOT NULL DEFAULT false   -- moved to dead-letter after N attempts
);
CREATE INDEX outbox_pending_idx ON outbox (id) WHERE processed_at IS NULL AND NOT dead;

-- HTTP idempotency (Idempotency-Key header): same key + same payload replays the stored response.
CREATE TABLE idempotency_key (
  scope         text        NOT NULL,          -- actor + route
  key           text        NOT NULL,
  request_hash  text        NOT NULL,
  status_code   int,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (scope, key)
);
CREATE INDEX idempotency_expiry_idx ON idempotency_key (expires_at);

-- Audit trail: append-only. FR-AUD.
CREATE TABLE audit_event (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid,
  actor_user_id uuid,
  actor_kind    text        NOT NULL DEFAULT 'user' CHECK (actor_kind IN ('user','system','support','api_key')),
  action        text        NOT NULL,          -- e.g. role.changed, import.undone, publication.changed
  target_type   text,
  target_id     text,
  meta          jsonb       NOT NULL DEFAULT '{}',   -- never secrets or unnecessary personal data
  ip            inet,
  device_id     uuid,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_at_idx ON audit_event (org_id, at DESC);
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read   ON audit_event FOR SELECT USING (org_id = current_org_id());
CREATE POLICY audit_insert ON audit_event FOR INSERT WITH CHECK (org_id IS NULL OR org_id = current_org_id());

-- Feature flags / kill switches (e.g. public_degraded, category switches). FR-ADM-06.
CREATE TABLE feature_flag (
  key        text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  rules      jsonb   NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO feature_flag (key, enabled) VALUES ('public_degraded', false), ('reservations', false);
