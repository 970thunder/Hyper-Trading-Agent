-- Durable organization-level alerts emitted when a usage budget threshold is reached.
-- The uniqueness constraint prevents an alert storm during high-volume model calls.

BEGIN;

CREATE TABLE IF NOT EXISTS usage_alert_events (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_start timestamptz NOT NULL,
    alert_type text NOT NULL CHECK (alert_type IN ('token_soft_limit', 'token_hard_limit', 'cost_soft_limit', 'cost_hard_limit')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged')),
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz,
    acknowledged_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(organization_id, period_start, alert_type)
);

CREATE INDEX IF NOT EXISTS idx_usage_alert_events_organization
    ON usage_alert_events(organization_id, status, created_at DESC);

COMMIT;
