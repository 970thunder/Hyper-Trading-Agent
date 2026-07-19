# Hyper Trading Agent

Hyper Trading Agent は、会話、金融リサーチ、バックテスト、ナレッジベース、組織ガバナンス、取引リスク管理を提供する商用金融リサーチ Agent プラットフォームです。

このリポジトリは `970thunder` により管理されています。

## 主な機能

- セッションとストリーミングイベントを備えた Agent チャット API。
- 金融リサーチツール、市場データ、レポート生成、バックテスト。
- SiliconFlow、OpenAI 互換 API、OpenRouter、DeepSeek、Qwen/DashScope、Ollama などのモデル設定。
- SQLite FTS によるローカル RAG と、本番向け PostgreSQL + pgvector のパス。
- 認証、組織、RBAC、モデル管理、ナレッジベース、監査、利用状況 API。
- 組織単位のリサーチおよび取引ワークスペース：
  - 読み取り専用ポートフォリオ接続、リスクスナップショット、ドローダウン履歴。
  - アプリ内/Webhook アラート、永続的な配信記録、再試行制御。
  - ウォッチリスト、出典付き市場ノート、決算カレンダー、イベントタイムライン。
  - 出典と取得時刻を含む OKX/Binance の資金調達率、建玉、ベーシス指標。
  - ローカルリスク上限と再現可能な注文リプレイを備えたペーパートレーディング。
  - 実注文はマンデート、承認、事前リスクチェック、キルスイッチ、監査により保護。

## ローカル実行

バックエンド：

```powershell
cd agent
copy .env.example .env
python -m cli serve --port 8899
```

フロントエンド：

```powershell
cd frontend
npm install
npm run dev
```

## SiliconFlow

`agent/.env` を設定します。

```env
LANGCHAIN_PROVIDER=siliconflow
LANGCHAIN_MODEL_NAME=deepseek-ai/DeepSeek-V3.2
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_API_KEY=your-api-key
```

実際の API キーはコミットしないでください。

## Docker

```powershell
copy .env.production.example .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

最初の Owner を作成します。

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml exec api python -m src.commercial.bootstrap --email owner@example.com --password "change-this-password" --organization "Hyper Research" --api-key "$env:SILICONFLOW_API_KEY"
```

## 主な API

- `POST /auth/login`、`POST /auth/logout`、`GET /auth/me`
- `GET/POST /models/providers`、`GET/POST /knowledge-bases`
- `POST /knowledge-bases/{id}/documents`、`/urls`、`/search`
- `GET/POST /portfolio/connections`
- `GET/POST /alerts/rules`、`GET/POST /alerts/channels`、`GET /alerts/deliveries`
- `GET/POST /research/watchlists`、`/research/notes`、`/research/events`
- `GET /market-data/crypto-derivatives`
- `GET/PUT /paper-trading/policy`、`GET/POST /paper-trading/orders`
- `GET /audit-logs`、`GET /usage/model-calls`、`GET /metrics`

## 現在の制約

- 長時間ジョブには SQLite の永続ストアと Redis/Postgres キュー契約があります。完全な Agent 実行、Web クロール、長時間バックテストの実行器は、まだ worker パスへ移す必要があります。
- RAG は PostgreSQL ライフサイクルストア、pgvector 検索、ローカルフォールバック、埋め込み状態、取り込みライフサイクル、ハイブリッド検索を提供します。設定可能な rerank と正式な評価データセットは後続作業です。
- CSRF、エンタープライズ SSO、クオータ強制、より深い可観測性強化は未完了です。
- 銘柄メタデータはプロバイダー提供のコーポレートアクションと取引所セッションカレンダーを公開しています。信頼できるコーポレートアクション履歴には、引き続き公式データプロバイダーが必要です。
- 市場データ品質は XNYS、XHKG、XSHG の取引日カレンダーを適用し、ギャップ注釈と鮮度 SLA を公開します。正規化ローダーで実際に適用されるのは raw 価格のみで、前方・後方調整は未対応です。
- Webhook アラートの再試行は永続化され、運用 API から実行できます。本番では独立した再試行スケジューラも必要です。

## 検証

```powershell
.\.venv\Scripts\python.exe -m pytest agent\tests\test_alert_rules_api.py agent\tests\test_research_workspace_api.py agent\tests\test_crypto_derivatives.py agent\tests\test_paper_trading_api.py -q
cd frontend
npm run build
```
