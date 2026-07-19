# Hyper Trading Agent

Hyper Trading Agent 是面向商业金融研究的 Agent 平台，提供对话、市场研究、回测、知识库、组织治理和交易风险控制能力。

本仓库由 `970thunder` 维护。

## 当前能力

- 支持会话和流式事件的 Agent 对话 API。
- 金融研究工具、市场数据、报告生成和回测。
- 支持 SiliconFlow、OpenAI 兼容接口、OpenRouter、DeepSeek、Qwen/DashScope、Ollama 等模型配置。
- 支持轻量本地 RAG（SQLite FTS）以及生产环境 PostgreSQL + pgvector 路径。
- 组织与治理：邮箱密码登录、组织、RBAC、模型管理、知识库、审计和用量接口。
- 组织级研究与交易工作区：
  - 只读组合连接、风险快照和回撤历史。
  - 站内/Webhook 告警、持久化投递记录和重试控制。
  - 自选列表、带引用的市场笔记、财报日历和事件时间线。
  - 带来源与采集时间的 OKX/Binance 资金费率、持仓量和基差指标。
  - 带本地风险限额和可复现回放的纸面交易账本。
  - 真实连接器订单受授权书、审批、预交易风控、熔断和行动审计保护。

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
LANGCHAIN_MODEL_NAME=deepseek-ai/DeepSeek-V3.2
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_API_KEY=your-api-key
```

不要将真实密钥提交到仓库。

## Docker 启动

```powershell
copy .env.production.example .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

首次初始化 Owner：

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml exec api python -m src.commercial.bootstrap --email owner@example.com --password "change-this-password" --organization "Hyper Research" --api-key "$env:SILICONFLOW_API_KEY"
```

## 主要 API

- `POST /auth/login`、`POST /auth/logout`、`GET /auth/me`
- `GET/POST /models/providers`、`GET/POST /knowledge-bases`
- `POST /knowledge-bases/{id}/documents`、`/urls` 和 `/search`
- `GET/POST /portfolio/connections`
- `GET/POST /alerts/rules`、`GET/POST /alerts/channels`、`GET /alerts/deliveries`
- `GET/POST /research/watchlists`、`/research/notes`、`/research/events`
- `GET /market-data/crypto-derivatives`
- `GET/PUT /paper-trading/policy`、`GET/POST /paper-trading/orders`
- `GET /audit-logs`、`GET /usage/model-calls`、`GET /metrics`

## 当前边界

- 长任务已具备 SQLite 持久化存储和 Redis/Postgres 队列契约；完整 Agent 运行、网页抓取和长回测执行器仍需迁移到 worker 路径。
- RAG 已支持 PostgreSQL 生命周期存储、pgvector 检索、本地回退、嵌入状态、入库生命周期和混合检索；可配置 rerank 与正式评估数据集仍是后续工作。
- CSRF、企业 SSO、配额治理和更深入的可观测性加固仍待完成。
- 标的元数据已提供服务商公司行为和交易所会话日历；权威公司行为历史仍需接入官方数据源。
- 市场数据质量已对 XNYS、XHKG 和 XSHG 交易日历执行校验，提供缺口标注和新鲜度 SLA，并明确归一化加载器仅实际应用原始价格，前复权和后复权暂不支持。
- Webhook 告警重试已持久化并可由运维接口触发；生产环境还应独立调度重试分发。

## 验证

```powershell
.\.venv\Scripts\python.exe -m pytest agent\tests\test_alert_rules_api.py agent\tests\test_research_workspace_api.py agent\tests\test_crypto_derivatives.py agent\tests\test_paper_trading_api.py -q
cd frontend
npm run build
```
