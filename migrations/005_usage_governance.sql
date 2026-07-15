-- Organization model-cost governance. SQLite remains the compatibility store
-- for this staged domain; this schema keeps PostgreSQL ready for the next
-- repository migration and provides an auditable production data contract.

BEGIN;

ALTER TABLE model_providers
    ADD COLUMN IF NOT EXISTS input_price_per_million numeric NOT NULL DEFAULT 0;
ALTER TABLE model_providers
    ADD COLUMN IF NOT EXISTS output_price_per_million numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS organization_usage_policies (
    organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    monthly_token_soft_limit bigint NOT NULL DEFAULT 0 CHECK (monthly_token_soft_limit >= 0),
    monthly_token_hard_limit bigint NOT NULL DEFAULT 0 CHECK (monthly_token_hard_limit >= 0),
    monthly_cost_soft_limit numeric NOT NULL DEFAULT 0 CHECK (monthly_cost_soft_limit >= 0),
    monthly_cost_hard_limit numeric NOT NULL DEFAULT 0 CHECK (monthly_cost_hard_limit >= 0),
    updated_by_user_id text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_call_usage_organization_period
    ON model_call_usage(organization_id, created_at DESC);

COMMIT;
