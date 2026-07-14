-- Runtime pgvector table for commercial RAG retrieval.
-- Metadata remains compatible with the local SQLite repository during the
-- staged PostgreSQL migration, while production vector writes and searches use
-- this tenant-scoped table immediately.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_vector_chunks (
    chunk_id text PRIMARY KEY,
    organization_id text NOT NULL,
    knowledge_base_id text NOT NULL,
    document_id text NOT NULL,
    title text NOT NULL DEFAULT '',
    source_uri text NOT NULL DEFAULT '',
    text text NOT NULL,
    embedding vector NOT NULL,
    embedding_source text NOT NULL DEFAULT '',
    embedding_dimensions integer NOT NULL,
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_vector_chunks_scope
    ON rag_vector_chunks (organization_id, knowledge_base_id, document_id, updated_at DESC);

-- SiliconFlow BAAI/bge-m3 is the production default and uses 1024 dimensions.
-- Other dimensions remain queryable through a scoped sequential fallback until
-- a dedicated expression index is provisioned for that embedding model.
CREATE INDEX IF NOT EXISTS idx_rag_vector_chunks_embedding_1024
    ON rag_vector_chunks USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
    WHERE embedding_dimensions = 1024;

COMMIT;
