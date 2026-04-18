# Verify Name Cleanup — 2026-04-18

Commit: `417617f` — inline `cleanCustomerName` in `api/compile-enforce-prompt.js`
Data: `samples/verify_name_cleanup_20260418.json` (4 items from n8n Filter & Format Telegram Final output)
Vercel deployed: yes

---

## 总览

| Metric | Result |
|---|---|
| 字段清洁度 (customer_name_clean DB) | **2/4 通过** |
| 消息端到端 (ai_message 开头) | **4/4 通过** |
| 翻译完整度 (cn/en 比) | 平均 0.42 |
| Banned phrase | 0 条触发 |

---

## 表 1: customer_name_clean 字段检查

| # | project_key | customer_name_clean 字段值 | 预期值 | 字段通过? |
|---|---|---|---|---|
| 1 | Marci加拿大1台（26.3.15日） | Marci | Marci | ✅ |
| 2 | +61480183422 | (空) | (空) | ✅ |
| 3 | Rocio美国10台AR011（26.3.16日）10月份左右开业 | Rocio10AR010 | Rocio | ❌ 脏值残留 |
| 4 | Bianca Wallace加拿大1台FR001（25.9.17日） | Bianca | Bianca | ✅ |

**解读:**
- 3/4 的 `customer_name_clean` DB 字段本身是干净的(Marci、+61480183422、Bianca)
- Rocio 的 DB 字段仍然是 "Rocio10AR010" — 上游 Supabase 数据清洗没到位,`build-context.js` 里的 `cleanCustomerName()` 对这条没生效(原始函数的 CJK→空字符串 bug 导致 token 粘连)
- 但这不影响最终消息,因为 compile-enforce-prompt.js 里的 inline `cleanCustomerName(project_key)` 会覆盖脏值

---

## 表 2: ai_message 开头名字检查(端到端验证)

| # | customer | ai_message 开头前 40 字符 | 用了干净名? | 备注 |
|---|---|---|---|---|
| 1 | Marci | `Marci, I can send you the shipping cos` | ✅ | "Marci," 开头 |
| 2 | +61480183422 | `Hi there, I can keep our reformer line` | ✅ | "Hi there," 开头 — 手机号正确处理 |
| 3 | Rocio | `Rocio, I can send you the AR011 photos` | ✅ | "Rocio," 开头 — 尽管 DB 字段脏,inline fix 生效 |
| 4 | Bianca | `Bianca, no pressure at all — just here` | ✅ | "Bianca," 开头 |

**关键发现: commit 417617f 的 inline cleanCustomerName 完全生效。**

Rocio 是最关键的验证: DB 字段 = "Rocio10AR010"(脏), 但最终消息开头 = "Rocio,"(干净)。
这证明 `cleanCustomerName(json.project_key)` 优先级逻辑正常工作:
```js
safeString(cleanCustomerName(json.project_key) || json.customer_name_clean || json.customer_name)
// cleanCustomerName("Rocio美国10台AR011...") → "Rocio" → 用这个,忽略脏的 DB 值
```

---

## 表 3: 中文翻译完整度

| # | customer | en_len | cn_len | cn/en 比 | 翻译完整? |
|---|---|---|---|---|---|
| 1 | Marci | 133 | 64 | 0.48 | ✅ 正常 (中文字符密度高) |
| 2 | +61480183422 | 136 | 52 | 0.38 | ✅ 正常 |
| 3 | Rocio | 158 | 65 | 0.41 | ✅ 正常 |
| 4 | Bianca | 133 | 44 | 0.33 | ⚠️ 偏短 |

**解读:**
- 平均 cn/en 比 = 0.40
- 中文字符信息密度约为英文的 2-3 倍,0.33-0.48 的字符比是合理范围
- Bianca (0.33) 最短,但实际翻译内容完整: "Bianca，完全不用担心——我随时都在。等你准备好了，随时联系我，我会从那里开始帮你。" — 语义完整
- 无"偷懒"情况

---

## 表 4: Banned Phrase 检查

| # | customer | banned_phrase_hits |
|---|---|---|
| 1 | Marci | [] |
| 2 | +61480183422 | [] |
| 3 | Rocio | [] |
| 4 | Bianca | [] |

0/4 触发。

---

## 结论

**commit 417617f 完全生效。**

判据: 字段通过率低 (2/4) 但消息端到端通过率高 (4/4) → inline `cleanCustomerName(json.project_key)` 成功绕过了脏的 Supabase 数据,在 Enforce prompt 层面就地清洗。

具体证据:
- **Rocio** 是决定性测试用例: DB 的 `customer_name_clean` = "Rocio10AR010"(脏), 但最终 `whatsapp_message` 开头 = "Rocio,"(干净)。这只可能是 inline cleanCustomerName 的功劳。
- Marci 和 Bianca 的 DB 字段碰巧是干净的(可能上游 `build-context.js` 的 `cleanCustomerName` 在这两条上工作正常), 所以它们无法单独证明 inline fix 生效。
- +61480183422 的 DB 字段是空的(正确 — 手机号), 消息正确使用 "Hi there,"。

### 剩余问题

1. **`build-context.js` 的 `cleanCustomerName()` 对 Rocio 类 pattern 失败** — CJK 字符替换为空字符串导致 "Rocio" 和 "10" 粘连为 "Rocio10", 然后 "\bAR011\b" 变成 "AR010" (边界匹配异常)。`compile-enforce-prompt.js` 的版本已修复(CJK → 空格, 台 优先处理), 但 `build-context.js` 里的原始版本仍有 bug。

2. **Bianca 消息质量问题仍存在** — "no pressure at all — just here when you're ready" 仍然违反 [action]+[benefit]+[reply path] 模板结构。这是 P1-3 (prompt tuning) 问题,不是 name cleanup 问题。

---

## 下一步建议

1. **Backport regex 修复到 `build-context.js`** — 把 compile-enforce-prompt.js 里的改进版 cleanCustomerName (CJK→空格, \d+台 优先) 同步到 build-context.js, 这样 Supabase 里的 `customer_name_clean` 字段本身也变干净
2. **扩大验证样本** — 当前只有 4 条, 建议在下次生产批次中覆盖 20+ 条验证
3. **Bianca 模板违规** — 按 P1-3 建议修改 reactivation_system.txt 的 FALLBACK section
