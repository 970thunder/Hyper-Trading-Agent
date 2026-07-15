-- PostgreSQL lexical retrieval index for the production knowledge lifecycle.
-- Embeddings remain in rag_vector_chunks because providers can use different
-- dimensions; knowledge_chunks is the durable metadata and lexical source.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_lexical_simple
    ON knowledge_chunks USING gin (to_tsvector('simple', text));

COMMIT;
