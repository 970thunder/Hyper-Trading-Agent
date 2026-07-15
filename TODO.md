# Hyper Trading Agent TODO

## P0 UI System Redesign

Design specification: `docs/superpowers/specs/2026-07-13-ui-system-redesign-design.md`

Implementation plan: `docs/superpowers/plans/2026-07-13-ui-system-redesign.md`

Comprehensive refinement plan: `docs/superpowers/plans/2026-07-14-comprehensive-ui-refinement.md`

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
- [x] Complete the Runtime second visual pass with queue metrics, search, floating filters, task details, cancellation confirmation, and inline action errors.
- [x] Complete the Reports second visual pass with performance metrics, responsive report rows, richer filters, semantic statuses, and compact actions.
- [x] Complete the Run Detail second visual pass with structured tabs, chart controls, trade ledger, artifacts, collapsible logs, and code inspection.
- [x] Complete the Compare second visual pass with floating run selection, request-race protection, score summary, themed equity overlay, and metric table.
- [x] Complete the Correlation second visual pass with validated asset input, segmented research controls, result states, and themed heatmap output.
- [ ] Finalize the AlphaZoo browse table and benchmark-form visual pass.
- [x] Replace Runtime and Reports native selects with shared floating Select controls.
- [x] Replace the Run Detail symbol selector with the shared floating Select control.
- [x] Replace Compare run selectors with searchable shared floating Select controls.
- [x] Replace all AlphaZoo browse, benchmark, and comparison native selects with shared floating Select controls.
- [ ] Complete desktop/mobile light/dark screenshot regression and Arabic RTL verification after the local commercial API is available.

## P0 Permissions And Enterprise Boundaries

- [x] Require an authenticated commercial session for generic workspace APIs, including sessions and settings.
- [x] Preserve loopback-only compatibility when commercial mode is disabled.
- [x] Protect `/admin/*` with Owner/Admin frontend route guards.
- [x] Protect Agent, Reports, Settings, Knowledge, research, and run-detail routes with a commercial/local-aware workspace guard.
- [x] Restrict global Runtime governance and Swarm Agent mutation APIs to Owner/Admin.
- [x] Hide Runtime governance navigation from Member/Viewer roles.
- [x] Hide or disable Knowledge and member-management actions by role.
- [x] Limit Member knowledge actions to file upload on existing writable bases; reserve source governance, URL ingestion, reindexing, retries, cancellation, and deletion for Owner/Admin.
- [x] Enforce Viewer read-only access for session, Agent, Swarm, research jobs, upload, and feedback mutations at the API boundary.
- [x] Add frontend and backend role-matrix regression tests.
- [x] Audit Swarm Agent create/update/delete actions.
- [x] Add a separate platform-admin identity, bootstrap allowlist, global operations API, and `/platform` console.
- [x] Keep platform administration distinct from organization Owner/Admin roles; allow global user/org suspension and knowledge-base governance.
- [x] Expand the global platform console with tenant-bound runtime jobs, generated artifacts, repository/storage health, and audited maintenance actions.
- [x] Reserve legacy process-wide settings, IM channels, scheduled jobs, and metrics for Platform Admin; permit machine-key access only for `/metrics` monitoring.
- [x] Reserve process-wide live-trading controls and connector status for Platform Admin until broker accounts are tenant-bound.
- [x] Enforce the Viewer read-only boundary for workload-bearing research requests and require Platform Admin for shutdown controls; document the full role matrix.
- [x] Scope persistent Agent memory to the active organization and user in commercial sessions.
- [x] Bind commercial sessions to `organization_id` and deny cross-organization list/read/message/SSE access.
- [x] Bind commercial browser uploads to `organization_id` and reject cross-organization knowledge imports.
- [x] Bind Agent session runs to `organization_id` and deny cross-organization Run list/detail/code access.
- [x] Bind Shadow Account reports, Swarm runs, Alpha background jobs, and Agent run artifacts to `organization_id`.
- [x] Add repository-level cross-organization isolation tests for sessions, runs, reports, Swarm, and Runtime jobs.
- [x] Add an organization switcher for users with multiple memberships.
- [x] Add dedicated localized Unauthorized and Forbidden routes.
- [x] Move commercial identity, organization membership, browser sessions, and platform-admin grants to PostgreSQL primary storage in production Compose.
- [x] Read platform user, organization, summary, and database-health views from PostgreSQL primary storage in production Compose.

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
- [x] Implement pgvector runtime write/search methods with tenant-scoped dual writes and SQLite fallback.
- [x] Migrate knowledge metadata, documents, jobs, chunks, and retrieval logs to PostgreSQL repositories.
- [x] Add configurable reranking.
- [ ] Add RAG evaluation datasets.
- [ ] Add object-storage lifecycle for original documents.

## P2 Model, Agent, Audit, And Usage Governance

- [x] Add standalone organization model management with create, update, test, enable, default, and delete actions.
- [x] Use provider/model dropdowns instead of handwritten model identifiers where presets are available.
- [x] Default SiliconFlow fallback to `deepseek-ai/DeepSeek-V3.2`.
- [x] Add standalone Swarm Agent management with localized preset/role names and per-Agent model configuration.
- [x] Add model and Agent deletion confirmation without shifting list-row controls.
- [x] Add standalone users, knowledge governance, runtime, audit, and usage routes.
- [x] Add platform-wide organization usage and budget status visibility without exposing provider secrets.
- [x] Remove organization model, Agent, Knowledge, Runtime, Audit, and Usage API loading from Settings.
- [x] Add complete audit links for Runtime retry/cancel and every remaining management action.
- [x] Add provider token pricing, organization monthly budgets, and soft/hard quota enforcement.
- [x] Add organization usage alert delivery for soft-limit and hard-limit events, acknowledgement, and audit records.
- [x] Add time-series usage and latency charts backed by aggregated usage endpoints.
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
- [x] Add persistent memory controls, history retrieval, and memory deletion/retention UI.
- [ ] Add user feedback analytics and cross-evaluation datasets.

## P4 Deployment And Operations

- [x] Docker Compose stack for API, worker, frontend, PostgreSQL/pgvector, and Redis.
- [x] Redis durable worker queue for Agent and RAG jobs.
- [x] Health endpoint and commercial metrics.
- [x] Add a rate-limited Nginx server gateway with TLS overlay and secure public endpoint policy.
- [x] Align backup/restore and secret-rotation runbooks with the production Compose services and PostgreSQL credentials.
- [x] Add idempotent server-side schema migration execution for commercial governance tables.
- [x] Track applied SQL migrations with checksums and fail startup when a historical migration drifts.
- [x] Make PostgreSQL the primary repository for commercial identity and authorization in production Compose.
- [x] Migrate commercial governance records (models, usage, alerts, tool policies, feedback, and audit) to PostgreSQL primary storage.
- [x] Migrate knowledge lifecycle metadata, documents, jobs, chunks, and retrieval logs to PostgreSQL primary storage.
- [x] Migrate workspace ownership, sessions, runs, artifacts, and upload metadata to PostgreSQL primary storage.
- [ ] Add Alembic migration execution and rollback documentation.
- [x] Add backup/restore drills for PostgreSQL, uploads/object storage, and encrypted secrets.
- [x] Add Prometheus/Grafana dashboard examples for jobs, model calls, RAG, audit, and failures.
- [x] Add repeatable PowerShell backup and guarded restore scripts for PostgreSQL and application volumes.
- [x] Add a non-destructive production readiness verification script for Docker health, auth, pgvector, and migrations.
- [x] Run a non-destructive Docker backup drill for PostgreSQL and all application volumes.
- [x] Run an isolated restore drill against a disposable staging Docker project.
- [ ] Add production SSO, TLS reverse-proxy, rate limiting, and deployment hardening checks.
