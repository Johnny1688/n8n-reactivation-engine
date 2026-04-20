# schemas/

JSON Schema 真相源。所有结构化数据的 schema 定义存放在这里。

## 文件清单

| 文件 | 用途 |
|---|---|
| `customer_profile.schema.json` | Customer Profile 结构定义，匹配 spec §2 (v1.2) |

## 修改流程 (三处同步)

改 schema 时必须按以下顺序更新，三处保持一致：

1. **`docs/customer_profile_system.md`** — spec 是真相源，先改这里
2. **`schemas/customer_profile.schema.json`** — 同步改 JSON Schema
3. **`nodes/profile_validator.js`** 里的 `SCHEMA` 常量 — 同步改嵌入副本

三处不一致会导致 validator 和 spec 漂移，AI 输出可能通过校验但不符合规范。

## 校验方式

改完后在 n8n Code 节点测试：

```javascript
// 粘贴 nodes/profile_validator.js 内容后：
const result = validateProfile($json.ai_output);
if (!result.valid) {
  throw new Error('Profile validation failed: ' + result.errors.join('; '));
}
return [{ json: result.profile }];
```

用一条真实 AI 输出作为输入，确认 validator 行为符合预期。
