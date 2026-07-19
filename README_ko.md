# Hyper Trading Agent

Hyper Trading Agent는 대화, 금융 리서치, 백테스트, 지식 베이스, 조직 거버넌스, 거래 리스크 제어를 제공하는 상용 금융 리서치 Agent 플랫폼입니다.

이 저장소는 `970thunder`가 관리합니다.

## 주요 기능

- 세션 및 스트리밍 이벤트를 지원하는 Agent 채팅 API.
- 금융 리서치 도구, 시장 데이터, 보고서 생성 및 백테스트.
- SiliconFlow, OpenAI 호환 API, OpenRouter, DeepSeek, Qwen/DashScope, Ollama 등의 모델 설정.
- SQLite FTS 기반 로컬 RAG 및 운영용 PostgreSQL + pgvector 경로.
- 인증, 조직, RBAC, 모델 관리, 지식 베이스, 감사 및 사용량 API.
- 조직 단위 리서치 및 거래 작업 공간:
  - 읽기 전용 포트폴리오 연결, 리스크 스냅샷, 낙폭 이력.
  - 인앱/Webhook 알림, 영속적 전송 기록 및 재시도 제어.
  - 관심종목, 출처가 있는 시장 메모, 실적 캘린더, 이벤트 타임라인.
  - 출처와 수집 시각을 포함한 OKX/Binance 펀딩비, 미결제약정, 베이시스 지표.
  - 로컬 리스크 한도와 재현 가능한 주문 재생을 지원하는 모의 거래 원장.
  - 실거래 연결기 주문은 권한 위임, 승인, 사전 리스크 검사, 킬 스위치 및 감사로 보호됩니다.

## 로컬 실행

백엔드:

```powershell
cd agent
copy .env.example .env
python -m cli serve --port 8899
```

프런트엔드:

```powershell
cd frontend
npm install
npm run dev
```

## SiliconFlow

`agent/.env`를 설정합니다.

```env
LANGCHAIN_PROVIDER=siliconflow
LANGCHAIN_MODEL_NAME=deepseek-ai/DeepSeek-V3.2
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_API_KEY=your-api-key
```

실제 API 키를 커밋하지 마세요.

## Docker

```powershell
copy .env.production.example .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

첫 Owner를 생성합니다.

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml exec api python -m src.commercial.bootstrap --email owner@example.com --password "change-this-password" --organization "Hyper Research" --api-key "$env:SILICONFLOW_API_KEY"
```

## 주요 API

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST /models/providers`, `GET/POST /knowledge-bases`
- `POST /knowledge-bases/{id}/documents`, `/urls`, `/search`
- `GET/POST /portfolio/connections`
- `GET/POST /alerts/rules`, `GET/POST /alerts/channels`, `GET /alerts/deliveries`
- `GET/POST /research/watchlists`, `/research/notes`, `/research/events`
- `GET /market-data/crypto-derivatives`
- `GET/PUT /paper-trading/policy`, `GET/POST /paper-trading/orders`
- `GET /audit-logs`, `GET /usage/model-calls`, `GET /metrics`

## 현재 제한 사항

- 장시간 작업에는 SQLite 영속 저장소와 Redis/Postgres 큐 계약이 있습니다. 완전한 Agent 실행, 웹 크롤링, 장시간 백테스트 실행기는 아직 worker 경로로 옮겨야 합니다.
- RAG는 PostgreSQL 수명 주기 저장소, pgvector 검색, 로컬 폴백, 임베딩 상태, 수집 수명 주기 및 하이브리드 검색을 지원합니다. 구성 가능한 rerank와 공식 평가 데이터셋은 후속 작업입니다.
- CSRF, 엔터프라이즈 SSO, 쿼터 강제 및 더 깊은 관측성 강화는 아직 완료되지 않았습니다.
- 종목 메타데이터에는 신뢰할 수 있는 기업행동 이력과 거래소 휴장일 캘린더가 더 필요합니다.
- 시장 데이터 품질에는 세션 캘린더, 수정 모드, 갭 주석, 신선도 SLA가 더 필요합니다.
- Webhook 알림 재시도는 영속화되며 운영 API에서 실행할 수 있습니다. 운영 환경에서는 별도의 재시도 스케줄러도 필요합니다.

## 검증

```powershell
.\.venv\Scripts\python.exe -m pytest agent\tests\test_alert_rules_api.py agent\tests\test_research_workspace_api.py agent\tests\test_crypto_derivatives.py agent\tests\test_paper_trading_api.py -q
cd frontend
npm run build
```
