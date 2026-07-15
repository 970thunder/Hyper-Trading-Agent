-- Align PostgreSQL model usage with the established commercial trace contract.
-- Kept as a forward migration because historical migration checksums are immutable.

BEGIN;

ALTER TABLE model_call_usage
    ADD COLUMN IF NOT EXISTS session_id text NOT NULL DEFAULT '';
ALTER TABLE model_call_usage
    ADD COLUMN IF NOT EXISTS attempt_id text NOT NULL DEFAULT '';
ALTER TABLE model_call_usage
    ADD COLUMN IF NOT EXISTS run_id text NOT NULL DEFAULT '';
ALTER TABLE model_call_usage
    ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
