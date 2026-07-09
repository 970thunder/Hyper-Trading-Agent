# Hyper Trading Agent

Hyper Trading Agent는 금융 리서치를 위한 상용 Agent 플랫폼입니다. Agent 채팅, 금융 도구, 백테스트, 모델 설정, RAG 지식베이스, 감사 API를 제공합니다.

이 저장소는 `970thunder`가 관리하는 독립 프로젝트입니다.

## Features

- Streaming Agent chat API.
- Financial research tools, reporting, and backtesting.
- Model provider configuration for SiliconFlow, OpenAI-compatible APIs, OpenRouter, DeepSeek, Qwen/DashScope, Ollama, and others.
- Local lightweight RAG with SQLite FTS.
- Commercial MVP with auth, organizations, RBAC, model providers, knowledge bases, audit logs, and usage APIs.
- Docker Compose production skeleton with API, worker, PostgreSQL + pgvector, and Redis.

## Local Run

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

## SiliconFlow

Configure `agent/.env`:

```env
LANGCHAIN_PROVIDER=siliconflow
LANGCHAIN_MODEL_NAME=deepseek-ai/DeepSeek-V4-Flash
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_API_KEY=your-api-key
```

Do not commit real API keys.

## Docker

```powershell
copy .env.production.example .env.production
docker compose -f docker-compose.prod.yml up --build
```

Initialize the first owner:

```powershell
docker compose -f docker-compose.prod.yml exec api python -m src.commercial.bootstrap --email owner@example.com --password "change-this-password" --organization "Hyper Research" --api-key "$env:SILICONFLOW_API_KEY"
```

## Current Limits

- Commercial runtime storage is still SQLite for the MVP.
- PostgreSQL + pgvector schema exists, but the runtime adapter is not complete.
- RAG uses FTS/BM25-style search; embeddings and hybrid retrieval are planned.
- Worker is a deployment placeholder; async jobs are planned.

## Verification

```powershell
python -m pytest agent\tests\test_commercial_store.py -q
cd frontend
npm run build
```
