-- 0002_identity: users, devices, sessions, OTP, organisations, branches, roles, memberships, invitations, API keys.
-- FRD: FR-IAM, FR-ORG. Tenancy: every org-owned table has org_id + RLS.

CREATE TABLE app_user (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('merchant','consumer','staff')),
  phone_e164       text UNIQUE,
  email            text,
  display_name     text,
  locale           text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','hi')),
  password_hash    text,                       -- argon2id; null when OTP-only
  mfa_secret_enc   text,                       -- encrypted by the app, never plaintext
  age_confirmed_at timestamptz,                -- FR-IAM-14 (18+)
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  last_active_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX app_user_email_uidx ON app_user (lower(email)) WHERE email IS NOT NULL;
CREATE TRIGGER app_user_updated BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE device (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('ios','android','web')),
  push_token   text,
  app_version  text,
  label        text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
CREATE INDEX device_user_idx ON device (user_id);

-- Refresh-token sessions with rotation + reuse detection (family_id). docs/01 I6.
CREATE TABLE session (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  device_id    uuid REFERENCES device(id) ON DELETE SET NULL,
  org_id       uuid,                           -- active org for this session (one org per token)
  family_id    uuid NOT NULL,
  refresh_hash text NOT NULL UNIQUE,
  rotated_from uuid REFERENCES session(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  revoked_reason text
);
CREATE INDEX session_user_idx ON session (user_id);
CREATE INDEX session_family_idx ON session (family_id);

CREATE TABLE otp_challenge (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target      text NOT NULL,                   -- phone or email
  channel     text NOT NULL CHECK (channel IN ('sms','whatsapp','voice','email')),
  purpose     text NOT NULL CHECK (purpose IN ('login','signup','step_up','new_device','recovery')),
  code_hash   text NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  consumed_at timestamptz
);
CREATE INDEX otp_target_idx ON otp_challenge (target, created_at DESC);

CREATE TABLE organization (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  legal_name  text,
  category    text,                            -- business category
  gstin       text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  contact_phone text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','read_only','suspended','closing','closed')),
  closing_at  timestamptz,                     -- 30-day cooling-off (FR-ORG-08)
  settings    jsonb NOT NULL DEFAULT '{"backdate_days":30,"publish_imports":"review"}',
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER organization_updated BEFORE UPDATE ON organization FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE branch (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name           text NOT NULL,
  address_line   text,
  area           text,
  city           text,
  state          text,
  pincode        text CHECK (pincode IS NULL OR pincode ~ '^[0-9]{6}$'),
  geo            geography(Point, 4326),       -- map pin; required before publishing (FR-ORG-02)
  timezone       text NOT NULL DEFAULT 'Asia/Kolkata',
  hours          jsonb NOT NULL DEFAULT '{}',  -- {"mon":[["09:00","21:00"]], ..., "holidays":[...]}
  hours_verified boolean NOT NULL DEFAULT false,
  phone_public   text,
  whatsapp_public text,
  contact_options text[] NOT NULL DEFAULT '{call}',
  is_published   boolean NOT NULL DEFAULT false,
  closed_override text CHECK (closed_override IN ('closed_today','temporarily_closed')),
  closed_until   timestamptz,
  last_synced_at timestamptz,                  -- last successful mobile/sync contact (offline rule, FR-OFF-06)
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  CHECK (NOT is_published OR geo IS NOT NULL)
);
CREATE INDEX branch_geo_idx ON branch USING gist (geo);
CREATE INDEX branch_org_idx ON branch (org_id);
CREATE TRIGGER branch_updated BEFORE UPDATE ON branch FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Roles and permissions (FRD §3.2). Branch scoping is in membership_branch.
CREATE TABLE role (
  code        text PRIMARY KEY,
  description text NOT NULL
);
CREATE TABLE permission (code text PRIMARY KEY, description text NOT NULL);
CREATE TABLE role_permission (
  role_code       text NOT NULL REFERENCES role(code),
  permission_code text NOT NULL REFERENCES permission(code),
  PRIMARY KEY (role_code, permission_code)
);

INSERT INTO role VALUES
  ('owner','Organisation owner'), ('org_admin','Organisation admin'), ('branch_manager','Branch manager'),
  ('inventory_operator','Inventory operator'), ('sales_operator','Sales operator'), ('auditor','Read-only auditor');
INSERT INTO permission VALUES
  ('billing.manage','Billing and plan'), ('org.manage','Org settings, close org'), ('org.export','Export org data'),
  ('branch.manage','Create/edit branches'), ('staff.manage','Invite/remove staff, assign roles'),
  ('apikey.manage','API keys and integrations'), ('catalogue.write','Create/edit products'),
  ('stock.write','Receipts, adjustments, damage'), ('sale.record','Record sale / customer return'),
  ('count.run','Run stock counts'), ('transfer.manage','Branch transfers'), ('import.run','Imports and undo'),
  ('publication.manage','Publication settings'), ('report.view','All reports'), ('report.stock','Stock reports'),
  ('audit.view','View audit log'), ('review.approve','Approve review-queue items');
INSERT INTO role_permission
  SELECT 'owner', code FROM permission
  UNION ALL SELECT 'org_admin', code FROM permission WHERE code NOT IN ('billing.manage','org.manage')
  UNION ALL SELECT 'branch_manager', unnest(ARRAY['catalogue.write','stock.write','sale.record','count.run','transfer.manage','import.run','publication.manage','report.view','audit.view','review.approve','staff.manage'])
  UNION ALL SELECT 'inventory_operator', unnest(ARRAY['catalogue.write','stock.write','sale.record','count.run','transfer.manage','report.stock'])
  UNION ALL SELECT 'sales_operator', 'sale.record'
  UNION ALL SELECT 'auditor', unnest(ARRAY['report.view','audit.view']);

CREATE TABLE membership (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_code  text NOT NULL REFERENCES role(code),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','removed')),
  pin_hash   text,                             -- shop-device staff PIN (FR-IAM-07)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id),
  UNIQUE (org_id, id)
);
CREATE INDEX membership_user_idx ON membership (user_id);
CREATE TRIGGER membership_updated BEFORE UPDATE ON membership FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Empty scope = all branches.
CREATE TABLE membership_branch (
  org_id        uuid NOT NULL,
  membership_id uuid NOT NULL,
  branch_id     uuid NOT NULL,
  PRIMARY KEY (membership_id, branch_id),
  FOREIGN KEY (org_id, membership_id) REFERENCES membership (org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, branch_id) REFERENCES branch (org_id, id) ON DELETE CASCADE
);

CREATE TABLE invitation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  phone_e164  text NOT NULL,
  role_code   text NOT NULL REFERENCES role(code),
  branch_ids  uuid[] NOT NULL DEFAULT '{}',
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES app_user(id),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_key (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL UNIQUE,           -- shown in UI; the secret is shown once
  secret_hash  text NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{}',
  created_by   uuid REFERENCES app_user(id),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Row-level security. Org-scoped tables use org_id; membership/organisation also let a user see their own.
SELECT enable_tenant_rls('branch');
SELECT enable_tenant_rls('membership_branch');
SELECT enable_tenant_rls('invitation');
SELECT enable_tenant_rls('api_key');

ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_access ON membership
  USING (org_id = current_org_id() OR user_id = current_user_id())
  WITH CHECK (org_id = current_org_id());

ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_access ON organization
  USING (id = current_org_id()
         OR id IN (SELECT org_id FROM membership WHERE user_id = current_user_id())
         OR created_by = current_user_id())
  WITH CHECK (id = current_org_id() OR created_by = current_user_id());
