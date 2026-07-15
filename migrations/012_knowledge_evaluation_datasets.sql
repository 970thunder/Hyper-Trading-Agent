-- Persist tenant-scoped RAG evaluation datasets, benchmark cases, and runs.
-- A dataset is attached to one knowledge base so expected document/chunk IDs
-- cannot be evaluated across tenants or unrelated collections.

BEGIN;

CREATE TABLE IF NOT EXISTS knowledge_evaluation_datasets (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    knowledge_base_id text NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(knowledge_base_id, name)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_evaluation_datasets_base
    ON knowledge_evaluation_datasets(organization_id, knowledge_base_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_evaluation_cases (
    id text PRIMARY KEY,
    dataset_id text NOT NULL REFERENCES knowledge_evaluation_datasets(id) ON DELETE CASCADE,
    query text NOT NULL,
    expected_document_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    expected_chunk_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_evaluation_cases_dataset
    ON knowledge_evaluation_cases(dataset_id, created_at ASC);

CREATE TABLE IF NOT EXISTS knowledge_evaluation_runs (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    knowledge_base_id text NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    dataset_id text NOT NULL REFERENCES knowledge_evaluation_datasets(id) ON DELETE CASCADE,
    created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    top_k integer NOT NULL CHECK (top_k BETWEEN 1 AND 20),
    config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    results_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_evaluation_runs_dataset
    ON knowledge_evaluation_runs(organization_id, knowledge_base_id, dataset_id, created_at DESC);

COMMIT;
