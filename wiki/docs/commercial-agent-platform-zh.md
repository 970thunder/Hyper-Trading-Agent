# 商业化金融投研 Agent 运行说明

本文档说明当前商业化 MVP 的功能边界、配置项和启动命令。

## 已实现能力

- Agent 对话、工具注册、SSE 会话、金融数据工具和回测能力沿用原系统。
- SiliconFlow 已加入模型 provider 列表，可通过环境变量或组织模型配置使用。
- 本地轻量 RAG：`/knowledge/*` 使用 SQLite FTS5，适合单机验证。
- 商业化基础 API：邮箱密码注册/登录、组织、RBAC、模型 provider、知识库、审计、模型用量查询。
- 商业知识库 MVP：支持文本、Markdown、CSV、HTML、PDF、Word、Excel、PPTX 等文件解析入库，也支持网页 URL 抓取入库；检索返回固定 citation 字段。
- Docker Compose 生产骨架：`api`、`worker`、`postgres(pgvector)`、`redis`。

## 当前边界

- Runtime 商业存储仍是 SQLite 开发实现，Postgres + pgvector schema 已在 `migrations/001_commercial_pgvector.sql` 中提供，后续需要接入真实 Postgres adapter。
- 商业 RAG 当前是 BM25/FTS 检索，embedding 和 pgvector hybrid search 尚未接入 runtime。
- Worker 进程当前是部署占位，ingestion 和 Agent run 仍同步执行。
- Cookie auth 已支持生产 secure 配置，但 CSRF、邀请成员、SSO、用量限额和完整后台管理仍待补。

## 本地启动

在仓库根目录执行：

```powershell
cd agent
copy .env.example .env
# 在 agent/.env 中配置 SILICONFLOW_API_KEY、LANGCHAIN_PROVIDER=siliconflow、LANGCHAIN_MODEL_NAME
python -m cli serve --port 8899
```

前端开发模式：

```powershell
cd frontend
npm install
npm run dev
```

默认 API 地址为 `http://127.0.0.1:8899`，前端 Vite 会代理 API 请求。

## Docker 启动

复制生产环境变量模板：

```powershell
copy .env.production.example .env.production
```

至少配置：

- `POSTGRES_PASSWORD`
- `API_AUTH_KEY`
- `VIBE_TRADING_SECRET_KEY`
- `SILICONFLOW_API_KEY`

启动：

```powershell
docker compose -f docker-compose.prod.yml up --build
```

初始化第一个 Owner：

```powershell
docker compose -f docker-compose.prod.yml exec api python -m src.commercial.bootstrap --email owner@example.com --password "change-this-password" --organization "Hyper Research" --api-key "$env:SILICONFLOW_API_KEY"
```

## 关键 API

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
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

## 下一阶段开发重点

1. 将 `CommercialStore` 抽象成 repository 接口，并实现 Postgres/pgvector runtime adapter。
2. 接入 OpenAI-compatible embedding provider，知识库 chunk 写入 `vector` 字段。
3. 实现 BM25 + vector hybrid search，保留 rerank 接口。
4. 用 Redis/RQ 或 Celery 承接 ingestion、Agent run、网页抓取和批量回测任务。
5. 补齐成员邀请、RBAC 管理、CSRF、组织用量限额、结构化日志和 Prometheus 指标。
