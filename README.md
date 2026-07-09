# Hyper Trading Agent

Hyper Trading Agent is a commercial-oriented financial research agent platform. It combines agent chat, market research tools, backtesting, model provider configuration, and a RAG knowledge base for private financial research workflows.

This repository is maintained as an independent project under `970thunder`.

## Current Capabilities

- Agent chat API with streaming session events.
- Financial research tools, market data integrations, report generation, and backtesting.
- SiliconFlow, OpenAI-compatible, OpenRouter, DeepSeek, Qwen/DashScope, Ollama, and other provider configuration surfaces.
- Local lightweight RAG using SQLite FTS for single-machine usage.
- Commercial platform MVP:
  - email/password auth
  - organizations and RBAC roles
  - model provider management
  - knowledge bases, documents, URL ingestion, search, and citations
  - audit logs and model usage API surfaces
- Production deployment skeleton with Docker Compose, PostgreSQL + pgvector schema, Redis, API, and worker services.

## Architecture

```mermaid
flowchart LR
  UI["Frontend UI"] --> API["FastAPI API"]
  API --> Agent["Agent Runtime"]
  API --> Auth["Commercial Auth / RBAC"]
  API --> KB["Knowledge Base API"]
  Agent --> Tools["Research Tools"]
  Agent --> Models["LLM Providers"]
  KB --> LocalRAG["SQLite FTS MVP"]
  KB -. next .-> PG["Postgres + pgvector"]
  API --> Audit["Audit / Usage Logs"]
  Worker["Worker Process"] -. next .-> Jobs["Async Jobs"]
```

## Local Setup

Backend:

```powershell
cd agent
copy .env.example .env
python -m cli serve --port 8899
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open the frontend dev URL shown by Vite. The frontend proxies API traffic to the local backend.

## Model Configuration

For SiliconFlow, configure `agent/.env`:

```env
LANGCHAIN_PROVIDER=siliconflow
LANGCHAIN_MODEL_NAME=deepseek-ai/DeepSeek-V4-Flash
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_API_KEY=your-api-key
```

Do not commit real API keys. Use local `.env` files or production secrets.

## Docker Deployment

Create production env:

```powershell
copy .env.production.example .env.production
```

Set at least:

- `POSTGRES_PASSWORD`
- `API_AUTH_KEY`
- `VIBE_TRADING_SECRET_KEY`
- `SILICONFLOW_API_KEY`

Start:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

Initialize the first organization owner:

```powershell
$sfKey = (Select-String -Path .env.production -Pattern '^SILICONFLOW_API_KEY=').Line.Split('=',2)[1]
docker compose --env-file .env.production -f docker-compose.prod.yml exec api python -m src.commercial.bootstrap --email owner@example.com --password "change-this-password" --organization "Hyper Research" --api-key "$sfKey"
```

Stop:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

For local HTTP access, set `VIBE_TRADING_COOKIE_SECURE=false` in `.env.production`. Use `true` only behind HTTPS/TLS. If host port `8899` is occupied, set `API_PORT=8898` or another free port.

Docker Desktop may present browser requests to the container as the bridge gateway address instead of `127.0.0.1`. For local-only Docker usage, keep `API_BIND=127.0.0.1` and `VIBE_TRADING_TRUST_DOCKER_LOOPBACK=1` so the bundled frontend can call protected API routes without a manual API key.

## Commercial API Surface

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /organizations/current`
- `GET /models/providers`
- `POST /models/providers`
- `POST /models/providers/{id}/test`
- `GET /knowledge-bases`
- `POST /knowledge-bases`
- `POST /knowledge-bases/{id}/documents`
- `POST /knowledge-bases/{id}/urls`
- `POST /knowledge-bases/{id}/search`
- `GET /audit-logs`
- `GET /usage/model-calls`
- `GET /metrics`

## Current Limits

- Runtime commercial storage is still SQLite for the MVP. The PostgreSQL + pgvector schema exists under `migrations/`, but the runtime adapter still needs to be implemented.
- RAG currently uses FTS/BM25-style search. Embedding generation, vector search, hybrid ranking, and rerank are planned next.
- Worker service is a deployment placeholder. Long-running ingestion, web crawling, backtests, and agent runs still need a real queue.
- CSRF protection, member invitation, SSO, full admin console, quota enforcement, and advanced observability are still pending.

## Verification

```powershell
python -m pytest agent\tests\test_commercial_store.py -q
cd frontend
npm run build
```

## Roadmap

1. Implement Postgres/pgvector runtime repository.
2. Add embedding provider abstraction and hybrid retrieval.
3. Move ingestion and long-running agent tasks to Redis-backed jobs.
4. Add complete organization member management and RBAC UI.
5. Add cost quota, structured audit, metrics, and production hardening.
