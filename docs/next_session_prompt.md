# Next Session Prompt — Customer Profile System

Paste this as the first message when starting a new Claude conversation.

---

继续 Hesure Pilates 激活系统工作。

2026-04-19 完成的工作(已 commit 到 docs/architecture_roadmap.md):
- Stage 保护 trigger 部署
- followup_candidates + pending_my_reply 视图上线
- 263 个 needs_follow_up 解冻
- 23 个被误降级的 quoted 恢复
- Daily Stage Update 禁用
- Reactivation Engine cron 启用(方案 B,Mon-Sat 中国早 9 点)
- 冒烟测试通过(Ken美国 / Aubin澳大利亚 / Fmg新西兰)

---

今天要设计的新子系统: Customer Profile 分析(AI 分析简要)

## 需求

1. **增量式档案 (Customer Profile)**
   - 第 1 次激活该客户时: 全量 messages → AI 生成 profile v1
   - 第 2 次激活起: profile v_(N-1) + 最近 10-20 条新 messages → 更新 profile
   - profile 存在 pipeline_state.conversation_summary 字段(目前空闲)
   - 版本时间戳存在 summary_updated_at

2. **Reactivation Engine 使用 profile**
   - 激活 prompt 的 context 里包含 profile
   - 让 AI 生成的激活消息更贴合客户实际情况

3. **每周聚合分析**
   - 每周日汇总所有客户的 profile + 周内 stage transitions
   - 输出:高价值机会排名 / 漏单警示 / pattern 识别
   - Telegram 推送周报

## 期望讨论的决策点

- Profile 的 JSON schema 设计(纯文本 vs 结构化)
- AI 模型选择(Haiku 降本 vs Sonnet 质量)
- 触发时机(激活时同步 vs 异步批处理)
- 和现有 build-context API 怎么集成
- 周报的触发和推送方式

请先不要写代码,我们先讨论设计:
1. 数据模型
2. MVP 实现路径(分步)
3. 工作量和风险评估