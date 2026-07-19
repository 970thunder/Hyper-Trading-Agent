# Hyper Trading Agent

Hyper Trading Agent هو نظام Agent للبحوث المالية التجارية، يوفر المحادثة وبحوث السوق والاختبارات التاريخية وقاعدة المعرفة وحوكمة المؤسسات وضوابط مخاطر التداول.

تتم صيانة هذا المستودع بواسطة `970thunder`.

## الميزات الرئيسية

- واجهة محادثة Agent تدعم الجلسات والأحداث المتدفقة.
- أدوات البحوث المالية وبيانات السوق وإنشاء التقارير والاختبارات التاريخية.
- إعداد مزودي النماذج: SiliconFlow وواجهات OpenAI المتوافقة وOpenRouter وDeepSeek وQwen/DashScope وOllama وغيرها.
- RAG محلي خفيف باستخدام SQLite FTS ومسار PostgreSQL + pgvector للإنتاج.
- المصادقة والمؤسسات وRBAC وإدارة النماذج وقواعد المعرفة وواجهات التدقيق والاستخدام.
- مساحات عمل للبحوث والتداول على مستوى المؤسسة:
  - اتصالات محافظ للقراءة فقط ولقطات مخاطر وسجل التراجع.
  - تنبيهات داخل التطبيق وعبر Webhook وسجلات تسليم دائمة والتحكم في إعادة المحاولة.
  - قوائم مراقبة وملاحظات سوقية مع مراجع وتقويم أرباح وخط زمني للأحداث.
  - معدلات التمويل والفائدة المفتوحة والأساس من OKX/Binance مع المصدر ووقت الجمع.
  - دفتر تداول ورقي بحدود مخاطر محلية وإعادة تشغيل أوامر قابلة للتكرار.
  - أوامر الموصلات الحية محمية بالتفويض والموافقة وفحوصات المخاطر المسبقة ومفتاح الإيقاف والتدقيق.

## التشغيل المحلي

الخلفية:

```powershell
cd agent
copy .env.example .env
python -m cli serve --port 8899
```

الواجهة الأمامية:

```powershell
cd frontend
npm install
npm run dev
```

## SiliconFlow

اضبط `agent/.env`:

```env
LANGCHAIN_PROVIDER=siliconflow
LANGCHAIN_MODEL_NAME=deepseek-ai/DeepSeek-V3.2
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_API_KEY=your-api-key
```

لا تلتزم بمفاتيح API الحقيقية في المستودع.

## Docker

```powershell
copy .env.production.example .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

إنشاء أول Owner:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml exec api python -m src.commercial.bootstrap --email owner@example.com --password "change-this-password" --organization "Hyper Research" --api-key "$env:SILICONFLOW_API_KEY"
```

## واجهات API الرئيسية

- `POST /auth/login` و`POST /auth/logout` و`GET /auth/me`
- `GET/POST /models/providers` و`GET/POST /knowledge-bases`
- `POST /knowledge-bases/{id}/documents` و`/urls` و`/search`
- `GET/POST /portfolio/connections`
- `GET/POST /alerts/rules` و`GET/POST /alerts/channels` و`GET /alerts/deliveries`
- `GET/POST /research/watchlists` و`/research/notes` و`/research/events`
- `GET /market-data/crypto-derivatives`
- `GET/PUT /paper-trading/policy` و`GET/POST /paper-trading/orders`
- `GET /audit-logs` و`GET /usage/model-calls` و`GET /metrics`

## القيود الحالية

- تحتوي المهام طويلة الأمد على مخزن SQLite دائم وعقد طابور Redis/Postgres. ما زال يلزم نقل تنفيذ Agent الكامل وزحف الويب والاختبارات التاريخية الطويلة إلى مسار العامل.
- يدعم RAG تخزين دورة الحياة في PostgreSQL واسترجاع pgvector والبديل المحلي وحالة التضمين ودورة الاستيعاب والاسترجاع الهجين. يبقى rerank القابل للضبط ومجموعات التقييم الرسمية عملا لاحقا.
- لا تزال حماية CSRF وSSO للمؤسسات وفرض الحصص وتعزيز قابلية المراقبة المتقدمة غير مكتملة.
- تعرض بيانات تعريف الأدوات إجراءات الشركات من مزود البيانات وتقويمات جلسات البورصات؛ وما زال سجل إجراءات الشركات الموثوق يحتاج إلى مزود رسمي.
- تطبق جودة بيانات السوق تقاويم التداول XNYS وXHKG وXSHG، وتعرض تعليقات الفجوات واتفاقية مستوى حداثة البيانات. تطبق أدوات التحميل الموحدة أسعار raw فقط، ولا تدعم التعديلات الأمامية أو الخلفية بعد.
- إعادة محاولة تنبيهات Webhook دائمة ويمكن تشغيلها من واجهة العمليات؛ ويحتاج الإنتاج أيضا إلى مجدول مستقل لإعادة المحاولة.

## التحقق

```powershell
.\.venv\Scripts\python.exe -m pytest agent\tests\test_alert_rules_api.py agent\tests\test_research_workspace_api.py agent\tests\test_crypto_derivatives.py agent\tests\test_paper_trading_api.py -q
cd frontend
npm run build
```
