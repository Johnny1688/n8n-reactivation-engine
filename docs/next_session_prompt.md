# Next Session Prompt — Customer Profile 子系统

Paste this as the first message when starting a new Claude conversation.

---

继续 Hesure Pilates Customer Profile 子系统工作。

## 2026-04-20 完成进度 (已全部 commit + push)

### 数据库基础设施
- conversation_summary TEXT → JSONB 迁移完成
- 三个视图重建并归档 (today_followups_100 / _v2 / followup_candidates)
- 5 个 btree 表达式索引上线
- 备份表 _backup_conversation_summary_20260420 (待 2026-04-27 清理)

### Customer Profile 子系统脚手架
- docs/customer_profile_system.md (v1.2) — 设计规范
- schemas/customer_profile.schema.json — JSON Schema Draft 2020-12
- nodes/profile_validator.js — n8n inline 可用的 ajv 校验器 (Draft 2020-12)
- prompts/profile_v1_full_{system,user}.txt — Sonnet 全量生成 prompt
- prompts/profile_update_{system,user}.txt — Haiku 增量更新 prompt

### Vercel API 端点 (全部 live, 浏览器验证通过)
- /api/profile-route — 路由大脑, 决定全量/增量/跳过
- /api/customer-messages — 按 scope 拉消息, 格式化成 AI-ready 字符串
- /api/profile-write — 校验 + 写回 DB (POST only)
- 环境变量 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 已配
- package.json 已加 (ajv ^8.17.1 Draft 2020-12 + ajv-formats ^3.0.1)

### 其他
- workflows/reactivation_engine.json 已归档 (source of truth)
- 弃用 prompts/activation_quality_audit_* 已删除
- runSample.js 升级支持 --batch 模式

## 2026-04-20 端到端连通验证结果
- Fmg新西兰(26.3.29日) 通过 profile-route 返回 decision=full, reason=no_profile
- customer-messages 成功拉出 20 条真实消息, inbound/outbound 标注正确
- profile_validator 本地单元测试 valid=true
- profile-write 已部署, 等待接入 n8n 后端到端测试

## 明天要做的事 (按优先级)

### 优先级 1: 在 n8n.cloud 搭新工作流 "Customer Profile Generator"

目标: 把 Vercel 端点 + prompt + validator 串起来, 对 2 个测试客户
手动触发, 验证能否端到端生成 profile 并写进 DB。

参考节点链 (抄 Reactivation Engine 前半段):
  Cron (禁用) → HTTP GET followup-candidates 视图
  → Loop Over Items
  → HTTP GET /api/profile-route?project_key=X
  → IF decision: full/incremental/skip 三分支
  → (full 或 incremental 路径):
     HTTP GET /api/customer-messages?project_key=X&scope=Y&since_iso=Z
  → Load profile_v1_full 或 profile_update 的 system/user prompt
  → Merge + Build Final Prompt
  → AI Anthropic (Sonnet 4.6 全量 / Haiku 4.5 增量)
  → Parse AI output (JSON)
  → Code node: 用 profile_validator.js 校验
  → HTTP POST /api/profile-write

先只放 2 个测试客户: Fmg新西兰(26.3.29日) 和 Aubin澳大利亚(25.8.28日)

### 优先级 2: 审核生成的 2 份 profile
去 Supabase 看 conversation_summary 字段, 肉眼判断 narrative /
recommended_next_move / sample / return_exchange 字段是否合理。
通过 → 放量 50 个; 不通过 → 调 prompt, 不调代码。

### 优先级 3: 放量到今天的 50 个候选客户
手动触发, 观察失败率 / 耗时 / 成本。

### 优先级 4: 启用 cron (8:30 CN time, 早于 Reactivation Engine 半小时)

## 关键约束 (不要忘)
- Profile 子系统是独立工作流, 不改 Reactivation Engine 任何东西
- Reactivation Engine 现有 Decide Message Scope 节点会自动利用 profile
  的新鲜度, 逻辑已存在
- schema 改动三处同步: docs + schemas + nodes/profile_validator.js 的 SCHEMA 常量
- DB schema 改动先写 migrations/ 再手动在 Supabase 执行
- n8n 工作流改动导出 JSON 到 workflows/

## 没做 / 放弃的事
- 激活 prompt 注入 profile (等 profile 跑稳 1 周再说)
- 周报聚合 (等 profile 全量跑起来再做)
- 自动 cron 调度 (等手动验证通过)
- Reactivation Engine 接入 profile 读取 (等观察期结束)
3. 工作量和风险评估