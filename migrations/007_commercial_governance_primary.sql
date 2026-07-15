-- Records completion of the one-time SQLite-to-PostgreSQL domain handoff.
-- Domain repositories insert their marker only after the complete import succeeds.

BEGIN;

CREATE TABLE IF NOT EXISTS commercial_repository_migrations (
    domain text PRIMARY KEY,
    completed_at timestamptz NOT NULL DEFAULT now(),
    details_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMIT;
