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

## P1 Agent 核心能力
- [ ] Plan-Execute 执行模式
- [ ] HITL 审批节点
- [ ] 中断、恢复、取消
- [ ] 工具权限与风险等级
- [ ] 工具调用审计
- [ ] 高风险交易能力默认关闭并要求确认
- [ ] Agent 工作区状态快照与恢复

## P2 RAG 与记忆
- [ ] pgvector runtime adapter
- [x] hybrid retrieval
- [ ] ingestion job
- [x] citation UI
- [ ] persistent memory 策略
- [ ] 会话历史检索
- [x] 文件上传导入入口
- [x] URL 抓取入库入口
- [x] PDF / Word / Excel / Markdown / TXT / HTML / CSV 解析入口
- [x] 本地 embedding fallback 向量化
- [x] OpenAI-compatible embedding provider 优先向量化
- [x] 知识库向量化状态与 fallback 原因可观测
- [ ] 文档重建索引、失败重试、删除后清理 chunk
- [ ] 知识库 ACL 与跨组织隔离测试

## P3 输出与展示
- [ ] 结构化投研报告模板
- [ ] 回测结果压缩展示
- [ ] 流式输出状态分层
- [ ] 工具编排可视化
- [ ] 用户反馈闭环
- [x] 欢迎页示例分类标签页
- [x] 关键控件 hover / active / transition 状态
- [ ] 引用来源可展开查看原文片段
- [ ] 长回答自动摘要并保留详细运行记录

## P4 商业化治理
- [ ] RBAC 完整接入
- [x] 成本统计视图
- [x] 安全审计视图
- [x] Agent LLM 用量写入商业用量表
- [x] 模型用量关联 session / attempt / run
- [x] 模型用量关联组织模型 provider
- [ ] Prometheus 指标
- [ ] 管理后台
- [ ] 交叉测试与评测集
- [ ] API key 轮换与密钥加密迁移说明
- [ ] 私有化部署备份与恢复演练
