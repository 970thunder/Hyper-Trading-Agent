-- Bring upgraded installations to the complete knowledge-lifecycle contract.
-- Older deployments applied the initial pgvector table definitions before
-- knowledge-base ACL/configuration and ingestion progress fields existed.

BEGIN;

ALTER TABLE knowledge_bases
    ADD COLUMN IF NOT EXISTS config_json jsonb NOT NULL
        DEFAULT '{"chunk_size":1400,"chunk_overlap":180,"retrieval_mode":"hybrid","top_k":8}'::jsonb;
ALTER TABLE knowledge_bases
    ADD COLUMN IF NOT EXISTS access_json jsonb NOT NULL
        DEFAULT '{"read_roles":["owner","admin","member","viewer"],"write_roles":["owner","admin","member"]}'::jsonb;

ALTER TABLE knowledge_ingestion_jobs
    ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0;
ALTER TABLE knowledge_ingestion_jobs
    ADD COLUMN IF NOT EXISTS metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE knowledge_ingestion_jobs
    ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE knowledge_ingestion_jobs
    ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMIT;
