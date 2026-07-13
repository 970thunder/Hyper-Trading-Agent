# Hyper Trading Agent TODO

## P0 UI System Redesign

Design specification: `docs/superpowers/specs/2026-07-13-ui-system-redesign-design.md`

Implementation plan: `docs/superpowers/plans/2026-07-13-ui-system-redesign.md`

- [x] Audit desktop/mobile layouts in light and dark themes.
- [x] Define semantic light/dark theme, shadow, motion, interaction, and responsive tokens.
- [x] Add shared Button, Field, Panel, Status, Progress, and async-state components.
- [x] Add shared FloatingLayer, Select, Tabs, Dialog, Drawer, and presence transitions.
- [x] Replace the fixed mobile sidebar with a responsive application shell.
- [x] Move model, execution-mode, connector, and action menus to outside-click/Escape-aware floating layers.
- [x] Remove production `transition-all` usage and constrain transitions to intentional properties.
- [x] Productize Knowledge / RAG as a standalone list-detail workspace.
- [x] Split enterprise administration into dedicated management routes.
- [x] Refocus Settings on overview, personal API access, data sources, and IM channels.
- [x] Move model and Swarm Agent create/edit workflows into animated drawers with stable list layouts.
- [ ] Complete the second visual pass for Runtime, Reports, Run Detail, AlphaZoo, Compare, and Correlation.
- [ ] Replace remaining native selects on Runtime, Reports, Run Detail, Compare, and AlphaZoo.
- [ ] Complete desktop/mobile light/dark screenshot regression and Arabic RTL verification.

## P0 Permissions And Enterprise Boundaries

- [x] Require an authenticated commercial session for generic workspace APIs, including sessions and settings.
- [x] Preserve loopback-only compatibility when commercial mode is disabled.
- [x] Protect `/admin/*` with Owner/Admin frontend route guards.
- [x] Protect Agent, Reports, Settings, Knowledge, research, and run-detail routes with a commercial/local-aware workspace guard.
- [x] Restrict global Runtime governance and Swarm Agent mutation APIs to Owner/Admin.
- [x] Hide Runtime governance navigation from Member/Viewer roles.
- [x] Hide or disable Knowledge and member-management actions by role.
- [x] Add frontend and backend role-matrix regression tests.
- [x] Audit Swarm Agent create/update/delete actions.
- [ ] Bind sessions, runs, reports, uploads, and generated artifacts to `organization_id`.
- [ ] Add repository-level cross-organization isolation tests for sessions, runs, reports, and artifacts.
- [ ] Add an organization switcher for users with multiple memberships.
- [ ] Add dedicated localized Unauthorized and Forbidden routes.

## P1 Knowledge / RAG Productization

- [x] Add standalone knowledge-base list/detail navigation.
- [x] Support PDF, Word, Excel, Markdown, TXT, HTML, CSV, and URL ingestion entry points.
- [x] Queue file and URL parsing through the Redis worker in production mode.
- [x] Keep one ingestion job through queued, parsing/fetching, chunking, embedding, indexing, completed, failed, and cancelled stages.
- [x] Show vectorization progress, chunk count, parser, embedding source/dimensions, fallback reason, and failure reason.
- [x] Add document detail drawer with chunk text, metadata, embedding status, and ingestion history.
- [x] Add knowledge-base defaults for chunk size, overlap, retrieval mode, and top-k.
- [x] Make `hybrid`, `vector`, and `keyword` retrieval modes affect the actual search path.
- [x] Use knowledge-base top-k when a request does not provide an explicit limit.
- [x] Support retry before a failed URL/file job has created a document.
- [x] Support reindex, cancel, document deletion, and chunk/FTS/job cleanup.
- [x] Add per-knowledge-base read/write role ACL controls.
- [x] Add search evaluation with stable source citations and scores.
- [ ] Implement pgvector runtime write/search methods; the current production data path still stores chunks and embeddings in SQLite.
- [ ] Migrate knowledge metadata, documents, jobs, chunks, and retrieval logs to PostgreSQL repositories.
- [ ] Add configurable reranking and RAG evaluation datasets.
- [ ] Add object-storage lifecycle for original documents.

## P2 Model, Agent, Audit, And Usage Governance

- [x] Add standalone organization model management with create, update, test, enable, default, and delete actions.
- [x] Use provider/model dropdowns instead of handwritten model identifiers where presets are available.
- [x] Default SiliconFlow fallback to `deepseek-ai/DeepSeek-V3.2`.
- [x] Add standalone Swarm Agent management with localized preset/role names and per-Agent model configuration.
- [x] Add model and Agent deletion confirmation without shifting list-row controls.
- [x] Add standalone users, knowledge governance, runtime, audit, and usage routes.
- [x] Remove organization model, Agent, Knowledge, Runtime, Audit, and Usage API loading from Settings.
- [ ] Add complete audit links for Runtime retry/cancel and every remaining management action.
- [ ] Add provider price tables, organization budgets, soft/hard quotas, and alerting.
- [ ] Add time-series usage and latency charts backed by aggregated usage endpoints.
- [ ] Add secret-manager integration and key rotation workflows.

## P3 Agent Execution And Output

- [x] ReAct and Plan-Execute execution modes.
- [x] HITL approval lifecycle.
- [x] Pause, resume, cancel, and execution snapshots.
- [x] Tool audit and risk levels.
- [x] Separate step trace rows for tools, RAG, skills, and multi-Agent actions.
- [x] Professional output policy, emoji filtering, citation checks, and investment risk disclosure.
- [ ] Add richer step cards with retry count, artifacts, approval links, and persisted refresh recovery for every attempt.
- [ ] Add structured quantitative research report templates and downloadable result bundles.
- [ ] Add persistent memory controls, history retrieval, and memory deletion/retention UI.
- [ ] Add user feedback analytics and cross-evaluation datasets.

## P4 Deployment And Operations

- [x] Docker Compose stack for API, worker, frontend, PostgreSQL/pgvector, and Redis.
- [x] Redis durable worker queue for Agent and RAG jobs.
- [x] Health endpoint and commercial metrics.
- [ ] Make PostgreSQL the primary commercial repository instead of an initialized but partially unused service.
- [ ] Add Alembic migration execution and rollback documentation.
- [ ] Add backup/restore drills for PostgreSQL, uploads/object storage, and encrypted secrets.
- [ ] Add Prometheus/Grafana dashboard examples for jobs, model calls, RAG, audit, and failures.
- [ ] Add production SSO, TLS reverse-proxy, rate limiting, and deployment hardening checks.
