-- 0006_invitee_access: let an invited person (identified by phone number) see and respond to their own
-- invitations before they belong to the organisation. FRD FR-ORG-04, docs/01 I8.

CREATE FUNCTION current_user_phone() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_phone', true), '') $$;

-- An invitee may read and decline/accept their own pending invitations (policies combine with tenant_isolation by OR).
CREATE POLICY invitee_read ON invitation FOR SELECT
  USING (phone_e164 = current_user_phone());
CREATE POLICY invitee_update ON invitation FOR UPDATE
  USING (phone_e164 = current_user_phone() AND accepted_at IS NULL)
  WITH CHECK (phone_e164 = current_user_phone());

-- ...and may read the name of an organisation that invited them (only while the invitation is open).
CREATE POLICY organization_invitee ON organization FOR SELECT
  USING (id IN (SELECT org_id FROM invitation
                WHERE phone_e164 = current_user_phone() AND accepted_at IS NULL AND expires_at > now()));

-- One open invitation per organisation and phone number.
CREATE UNIQUE INDEX invitation_pending_uidx ON invitation (org_id, phone_e164) WHERE accepted_at IS NULL;

-- Faster refresh-token family revocation and per-user session lookups.
CREATE INDEX session_active_idx ON session (user_id) WHERE revoked_at IS NULL;
