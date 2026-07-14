-- Commercial governance additions introduced after the initial pgvector schema.
-- This file is intentionally idempotent so it can run before every server boot.

BEGIN;

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS platform_admins (
    user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_user_id text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS workspace_sessions (
    session_id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspace_sessions_organization
    ON workspace_sessions(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_runs (
    run_id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id text NOT NULL DEFAULT '',
    attempt_id text NOT NULL DEFAULT '',
    created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspace_runs_organization
    ON workspace_runs(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_artifacts (
    artifact_type text NOT NULL,
    artifact_id text NOT NULL,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id text NOT NULL DEFAULT '',
    attempt_id text NOT NULL DEFAULT '',
    created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_path text NOT NULL DEFAULT '',
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (artifact_type, artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_artifacts_organization
    ON workspace_artifacts(organization_id, artifact_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS uploaded_files (
    storage_key text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    uploaded_by_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_filename text NOT NULL,
    size_bytes bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_organization
    ON uploaded_files(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tool_policies (
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    tool_name text NOT NULL,
    risk_level text NOT NULL,
    permission_scope text NOT NULL,
    requires_approval boolean NOT NULL DEFAULT false,
    enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, tool_name)
);

COMMIT;
