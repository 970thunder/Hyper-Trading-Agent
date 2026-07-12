# Hyper Trading Agent TODO

## P0 当前必须完成
- [x] 主题 token 重构
- [x] 设置页导航化重构
- [x] 中英文 i18n 完整性约束
- [x] Agent 专业提示词重写
- [x] emoji 后处理清洗
- [x] RAG 引用输出规范
- [x] 商业登录态可管理模型与数据源设置
- [x] IM 通道配置说明与控制面增强
- [x] 审计与用量面板从占位改为真实数据视图
- [x] 组织级多模型配置 CRUD
- [x] Agent 对话页模型切换入口
- [x] Agent 欢迎页示例标签页化
- [x] Agent 对话页专业化 composer
- [x] 前端可见品牌统一为 Hyper Trading Agent
- [x] Swarm 多 Agent 创建、更新、删除与参数编辑
- [x] Swarm Agent 绑定组织模型配置并透传到运行时
- [x] UI / Interaction Beautification 第一轮：主题色、圆角、Agent 工作台、设置卡片、图表色板、AlphaZoo 顶部卡片统一

## P0 UI / Interaction Beautification
- [x] 主题 token 与 Tailwind accent 映射补齐
- [x] 欢迎页移除蓝青渐变与旧色示例卡
- [x] Agent 头像改为 Hyper Trading token 化样式
- [x] Agent composer 改为更紧凑的专业工具栏
- [x] 模型与连接器菜单保持悬浮，不撑开底部栏
- [x] 工具调用与执行 trace 使用语义 token 状态色
- [x] 会话标题生成规则修正，并对过长标题使用省略号
- [x] 设置页模型 provider 卡片和状态徽标视觉统一
- [x] 首页改为工作台入口，不再是营销式居中 hero
- [x] K 线、验证面板、对比图 fallback 色板迁移到红/青/中性灰体系
- [x] AlphaZoo 因子库卡片移除渐变并统一选中态
- [x] 报告、运行时、RunDetail 警告态改用 warning token
- [x] 新增 UI 审计文档与验收截图清单
- [ ] Settings 全部 section 进一步拆分为复用组件，降低单文件复杂度：已抽取安全与组织成员管理面板，剩余模型、知识库、Agent、审计等 section 组件化
- [ ] AlphaZoo 详情、bench、compare 全量表格和筛选区二次美化
- [x] Reports / Runtime 增加更完整的数据图表和任务操作态：Reports 已补摘要指标、状态分布和收益区间图；Runtime 已补 Alpha bench / compare 后台任务队列、进度、失败、取消与重试操作态
- [ ] Runtime 持久化任务队列二期：将 Agent run、RAG ingestion、网页抓取与长回测统一接入 Redis/Postgres durable job 视图
- [x] 移动端 Agent composer 与设置页截图验收：新增 Playwright CLI 截图脚本，覆盖移动视口 Agent 与 Settings 模型/知识库页面
- [x] 核心页面 Playwright light/dark 截图回归：新增截图回归脚本与验收文档，覆盖核心页面、浅色/深色主题、桌面/移动视口

## P1 Agent 核心能力
- [x] Plan-Execute 执行模式
- [x] HITL 审批节点
- [x] 中断、恢复、取消
- [x] 工具权限与风险等级
- [x] 工具调用审计
- [x] 高风险交易能力默认关闭并要求确认
- [x] Agent 工作区状态快照与恢复

## P2 RAG 与记忆
- [x] pgvector runtime adapter：运行时选择、fallback 原因、bootstrap SQL 与维度配置
- [x] hybrid retrieval
- [x] ingestion job
- [x] citation UI
- [x] persistent memory 策略：敏感内容拦截、召回类型过滤、自动召回开关
- [x] 会话历史检索
- [x] 文件上传导入入口
- [x] URL 抓取入库入口
- [x] PDF / Word / Excel / Markdown / TXT / HTML / CSV 解析入口
- [x] 本地 embedding fallback 向量化
- [x] OpenAI-compatible embedding provider 优先向量化
- [x] 知识库向量化状态与 fallback 原因可观测
- [x] 文档重建索引、失败重试、删除后清理 chunk
- [x] 知识库 ACL 与跨组织隔离测试：搜索、文档、job、重建、删除均拒绝跨组织访问

## P3 输出与展示
- [x] 结构化投研报告模板：中英文 Markdown 模板、关键指标、引用、风险提示与免责声明
- [x] 回测结果压缩展示：关键指标、风险标记、验证状态、净值/交易样本压缩摘要
- [x] 流式输出状态分层：执行 trace 增加规划、工具、输出三层活跃状态与数量提示
- [x] 工具编排可视化：执行 trace 增加多工具调用顺序图，展示节点状态与调用顺序
- [x] 用户反馈闭环：反馈事件存储/API/审计/metrics 与 Agent 回答点赞点踩入口
- [x] 欢迎页示例分类标签页
- [x] 关键控件 hover / active / transition 状态
- [x] 引用来源可展开查看原文片段：Agent 回答挂载 knowledge_search 片段，消息卡片可展开查看来源、相似度与原文
- [x] 长回答自动摘要并保留详细运行记录：最终答案压缩展示，完整原文写入 run artifact，trace 记录压缩元数据

## P4 商业化治理
- [ ] RBAC 完整接入：已补组织成员列表、创建、角色更新、移除 API、设置页成员管理 UI 与 Owner/Viewer 越权测试；剩余更完整访问矩阵验收与独立管理后台
- [x] 成本统计视图
- [x] 安全审计视图
- [x] Agent LLM 用量写入商业用量表
- [x] 模型用量关联 session / attempt / run
- [x] 模型用量关联组织模型 provider
- [x] Prometheus 指标
- [ ] 管理后台
- [x] 交叉测试与评测集：新增商业 Agent 交叉评测 JSON，覆盖 RAG、回测、RBAC、HITL、多模型、审计与输出质量，并用测试校验结构和覆盖面
- [x] API key 轮换与密钥加密迁移说明：新增密钥轮换、模型 provider key 迁移、加密迁移与泄露响应 runbook
- [x] 私有化部署备份与恢复演练：新增 PostgreSQL、文件/对象存储、Docker Compose 恢复演练与验收 runbook
