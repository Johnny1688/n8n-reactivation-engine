# workflows/

n8n 工作流的真相源归档。每个文件是从 n8n.cloud 手动导出的完整工作流 JSON。

## 规则

1. **每次在 n8n.cloud 改完工作流，必须导出 JSON 覆盖对应文件并 commit。**
2. 文件命名用 **snake_case 功能名**，不带版本号。版本靠 git 历史追踪，文件名保持稳定。
3. 不要手动编辑 JSON 内容 —— 只从 n8n.cloud 导出覆盖。

## 当前归档清单

| 文件 | n8n 工作流名称 | 说明 |
|---|---|---|
| `reactivation_engine.json` | Follow-up Engine (Telegram Alert) - V0418 | 触发: cron, Mon-Sat 中国早 9:00。功能: 从 followup_candidates 取候选, 生成激活消息, Telegram 推送 |

## 恢复方法

n8n.cloud → Import from File → 选 `workflows/*.json`。
