# Hyper Trading Agent

Hyper Trading Agent 是一个面向商业化交付的金融投研 Agent 平台，目标是支持企业内部投研、知识库问答、模型配置、回测分析和审计治理。

本仓库是 `970thunder` 维护的独立项目。

## 当前能力

- Agent 对话 API，支持会话和流式事件。
- 金融投研工具、市场数据、报告生成和回测能力。
- 支持 SiliconFlow、OpenAI-compatible、OpenRouter、DeepSeek、Qwen/DashScope、Ollama 等模型配置。
- 本地轻量 RAG：SQLite FTS，适合单机验证。
- 商业化 MVP：
  - 邮箱密码登录
  - 组织与 RBAC 角色
  - 模型 provider 管理
  - 知识库、文件入库、网页入库、检索和引用来源
  - 审计日志和模型调用用量 API
- Docker Compose 生产部署骨架：API、worker、PostgreSQL + pgvector、Redis。

## 本地启动

后端：

```powershell
cd agent
copy .env.example .env
python -m cli serve --port 8899
```

前端：

```powershell
cd frontend
npm install
npm run dev
```

## SiliconFlow 配置

在 `agent/.env` 中配置：

```env
LANGCHAIN_PROVIDER=siliconflow
LANGCHAIN_MODEL_NAME=deepseek-ai/DeepSeek-V4-Flash
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_API_KEY=你的密钥
```

不要把真实密钥提交到仓库。

## Docker 启动

```powershell
copy .env.production.example .env.production
docker compose -f docker-compose.prod.yml up --build
```

首次初始化 Owner：

```powershell
docker compose -f docker-compose.prod.yml exec api python -m src.commercial.bootstrap --email owner@example.com --password "change-this-password" --organization "Hyper Research" --api-key "$env:SILICONFLOW_API_KEY"
```

## 主要 API

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `GET /models/providers`
- `POST /models/providers`
- `GET /knowledge-bases`
- `POST /knowledge-bases`
- `POST /knowledge-bases/{id}/documents`
- `POST /knowledge-bases/{id}/urls`
- `POST /knowledge-bases/{id}/search`
- `GET /audit-logs`
- `GET /usage/model-calls`
- `GET /metrics`

## 当前边界

- 商业运行时存储仍是 SQLite MVP；PostgreSQL + pgvector schema 已提供，runtime adapter 待实现。
- RAG 当前是 FTS/BM25 风格检索；embedding、向量检索、hybrid ranking 和 rerank 待实现。
- worker 当前是部署占位；长任务队列待接入 Redis/RQ 或 Celery。
- 成员邀请、CSRF、SSO、管理员后台、限额治理和完整可观测性仍待完善。

## 验证

```powershell
python -m pytest agent\tests\test_commercial_store.py -q
cd frontend
npm run build
```
