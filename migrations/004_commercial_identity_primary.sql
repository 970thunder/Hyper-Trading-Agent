-- PostgreSQL indexes required when commercial identity is selected as the
-- production authorization source. The base tables are created by 001/002.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_organization
    ON auth_sessions(user_id, organization_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
    ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_memberships_user
    ON memberships(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_users_email_lower
    ON users(lower(email));

COMMIT;
