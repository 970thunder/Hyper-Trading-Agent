-- Commercial Vibe-Trading platform schema for PostgreSQL + pgvector.
-- Apply with:
--   psql "$DATABASE_URL" -f migrations/001_commercial_pgvector.sql

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS organizations (
    id text PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    display_name text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id text REFERENCES users(id) ON DELETE SET NULL,
    action text NOT NULL,
    target_type text NOT NULL DEFAULT '',
    target_id text NOT NULL DEFAULT '',
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_providers (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider text NOT NULL,
    model text NOT NULL,
    base_url text NOT NULL,
    api_key_ciphertext text NOT NULL DEFAULT '',
    api_key_fingerprint text NOT NULL DEFAULT '',
    temperature double precision NOT NULL DEFAULT 0,
    timeout_seconds integer NOT NULL DEFAULT 120,
    max_retries integer NOT NULL DEFAULT 2,
    enabled boolean NOT NULL DEFAULT true,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_call_usage (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider_id text REFERENCES model_providers(id) ON DELETE SET NULL,
    provider text NOT NULL,
    model text NOT NULL,
    prompt_tokens integer NOT NULL DEFAULT 0,
    completion_tokens integer NOT NULL DEFAULT 0,
    total_tokens integer NOT NULL DEFAULT 0,
    latency_ms integer NOT NULL DEFAULT 0,
    estimated_cost numeric NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_bases (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    knowledge_base_id text NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    title text NOT NULL,
    source_uri text NOT NULL,
    source_type text NOT NULL,
    source_hash text NOT NULL,
    status text NOT NULL,
    chunk_count integer NOT NULL DEFAULT 0,
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    knowledge_base_id text NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id text NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL,
    text text NOT NULL,
    embedding vector(1536),
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_vector ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_text_trgm ON knowledge_chunks USING gin (text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_scope ON knowledge_chunks (organization_id, knowledge_base_id, document_id);

CREATE TABLE IF NOT EXISTS knowledge_ingestion_jobs (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    knowledge_base_id text NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id text REFERENCES knowledge_documents(id) ON DELETE SET NULL,
    status text NOT NULL,
    error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_retrieval_logs (
    id text PRIMARY KEY,
    organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id text REFERENCES users(id) ON DELETE SET NULL,
    knowledge_base_id text REFERENCES knowledge_bases(id) ON DELETE SET NULL,
    query text NOT NULL,
    result_count integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
