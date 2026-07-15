-- Indexes used by PostgreSQL-primary workspace ownership checks.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_workspace_sessions_organization_created
    ON workspace_sessions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_runs_organization_created
    ON workspace_runs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_artifacts_organization_updated
    ON workspace_artifacts(organization_id, artifact_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_organization_created
    ON uploaded_files(organization_id, created_at DESC);

COMMIT;
