# Production Batch Report - 2026-04-16

## Summary

| Metric | Count |
|---|---|
| Total customers | 50 |
| PASS (output + no placeholder + 16-35 words) | 46 |
| EMPTY | 0 |
| WITH_PLACEHOLDER (has `{{`) | 0 |
| NO_AI_OUTPUT | 0 |
| Other anomalies | 4 |

Other anomalies breakdown:
- 3 × `hard_no_send=true` but message was generated (pre-refactor AI output; under new Enforce prompt these would return EMPTY)
- 1 × Chinese-language response instead of English (MCD菲律宾), word count = 3 (English tokenizer miscount on Chinese text)

## Customer State Distribution

| Flag | Count |
|---|---|
| `is_my_turn_to_reply=true` | 8 |
| `is_my_turn_to_reply=false` | 40 |
| `is_my_turn_to_reply=null` | 2 |
| `has_not_now_signal=true` | 3 |
| `hard_no_send=true` | 3 |

Note: all 3 `has_not_now_signal=true` cases overlap with `hard_no_send=true`.

## Empty Cases

No EMPTY outputs in this batch.

Under the new Enforce prompt, these 3 cases SHOULD produce EMPTY (hard_no_send=true) but currently have messages because the AI output is pre-refactor:

| Customer | is_my_turn | has_not_now | hard_no_send | Current output |
|---|---|---|---|---|
| Bianca Wallace加拿大1台FR001 | false | true | true | Bianca, I can keep you updated with new models whenever you're ready again so you can explore options at your convenience — want me to send that here? |
| Core1Pilates - Axcor Pilates | false | true | true | Rick, I can keep your feedback request ready in one message so you can easily refer back to it later — want me to send that here? |
| Neha加拿大 Bhudia | false | true | true | Neha, I can keep the details for AR011 ready so you can easily present it to your next client — want me to send that here? |

## With Placeholder Cases

None. No `{{...}}` patterns found in any output.

## Word Count Distribution

| Range | Count |
|---|---|
| <16 words | 1 |
| 16-30 words | 47 |
| 31-35 words | 2 |
| >35 words | 0 |

Average word count: 24.9

Under-16 case: MCD菲律宾 (Chinese-language response, English word count = 3)
Over-30 cases: Alan美国 Ochoa (32 words), Sarang美国 Park (31 words)

## Potential Concerns

### 1. `hard_no_send=true` with non-empty output (3 cases)

Bianca Wallace, Core1Pilates (Rick), Neha Bhudia — all have `hard_no_send=true` but the pre-refactor AI still generated messages. Under the new locked EMPTY POLICY these would correctly return `""`. This is expected for pre-refactor data; verify after next live run.

### 2. Chinese characters in customer name used as-is in message (8 cases)

The `customer_name` field contains the full `project_key` (with Chinese country names, dates, quantity) and the AI used it verbatim as the greeting name:

- `Gladys-Skinline菲律宾` → "Gladys-Skinline菲律宾, I can..."
- `HC菲律宾计划开工作室` → "HC菲律宾计划开工作室, I can..."
- `Jovie菲律宾1台工作室` → "Jovie菲律宾1台工作室, I can..."
- `Momz加拿大工作室` → "Momz加拿大工作室, I can..."
- `Nicholasa菲律宾` → "Nicholasa菲律宾, I can..."
- `Meet新西兰` → "Meet新西兰, I can..."
- `Mj菲律宾` → "Mj菲律宾, I can..."
- `pk澳大利亚（26.4.10日）` → "pk澳大利亚（26.4.10日）, I can..."

Root cause: `buildAIContext` passes `customer_name` as-is from input. The upstream data has `customer_name = project_key` for these customers. This is a data quality issue, not a prompt issue.

### 3. Phone number as customer name (13 cases)

13 customers have phone numbers as `project_key` and no real name. The AI used the phone number as the greeting:

- `+16304659913, I can line up the new model options...`
- `+18732009910` — worst case: no name at all, output starts with "Hi, I can simplify my last message..."

### 4. Generic/vague anchor — no concrete history object (4 cases)

These messages use vague actions like "simplify our last point" or "quickly catch up" instead of a concrete anchor from real history:

| Customer | Message |
|---|---|
| Julia美国 Gil | "Julia, I can simplify my last point about the 6 MG001 units so you can quickly see what's next..." |
| +18732009910 | "Hi, I can simplify my last message for you so you can quickly see the key point..." |
| Ro加拿大10台 | "Ro加拿大10台, I can simplify our last interaction so you can quickly catch up..." |
| Yosef美国 J3 Baranes | "Yosef, I can simplify our last point so you can quickly see what we discussed..." |

### 5. Chinese-language response (1 case)

MCD菲律宾 received a fully Chinese response instead of English:
> "MCD菲律宾（25.12.2日），我可以重新发送我们的全目录给您，这样您可以快速选择合适的普拉提设备 — 想让我发过来吗？"

This suggests the AI detected Chinese context and switched language. The prompt does not explicitly require English output.
