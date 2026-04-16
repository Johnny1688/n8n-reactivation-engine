# n8n Mapping

This repository is the source of truth for the reactivation workflow logic and prompts. n8n should run the workflow, not become the place where the logic is edited.

## Node Order

1. Build AI Context
2. Main Reactivation AI (Generator)
3. Parse AI Output
4. Format Telegram Message
5. Enforce Message Quality
6. Filter and Format Telegram Final
7. Split Telegram Messages

## File Mapping

| GitHub file | n8n node | Purpose |
| --- | --- | --- |
| `nodes/build_ai_context.js` | Build AI Context Code node | Standalone generated Code node entry from `src/context/*`. Produces the full context object and `reactivation_ai_payload`. |
| `src/context/*` | Source implementation | Modular source files for Build AI Context. Edit these first, then regenerate `nodes/build_ai_context.js`. |
| `prompts/reactivation_system.txt` | Main Reactivation AI (Generator) system prompt | Light author prompt. Outputs only `{ "whatsapp_message": "" }`. Hidden internal reasoning. No visible analysis. |
| `prompts/reactivation_user.txt` | Main Reactivation AI (Generator) user prompt | Data injector. Passes `reactivation_ai_payload`, `conversation_core`, `conversation`, `customer_name`, `project_key`. |
| `nodes/parse_ai_output.js` | Parse AI Output Code node | Parses Generator JSON into `whatsapp_message`. Extracts legacy `should_send` and `why` if present. Uses safe fallback on invalid JSON. |
| `nodes/format_telegram_message.js` | Format Telegram Message Code node | Builds `_en`, `_cn`, `telegram_messages` from the Generator's parsed output for review. |
| `prompts/enforce_quality_system.txt` | Enforce Message Quality system prompt | Strict gatekeeper. PASS / REWRITE / GENERIC FALLBACK / EMPTY. EMPTY is triggered only by `hard_no_send = true`. |
| `prompts/enforce_quality_user.txt` | Enforce Message Quality user prompt | Data injector for the gatekeeper. Supplies candidate message, customer identity, send-state flags, anchor, conversation, and payload. |
| `api/compile-enforce-prompt.js` | Enforce prompt compiler | Builds the Enforce user prompt from the JSON item. Pure data assembler — all policy lives in the system prompt. Candidate resolution: `ai_parsed.whatsapp_message || _en || ''`. |
| `api/filter-and-format-telegram-final.js` | Filter and Format Telegram Final Code node | Reads Enforce output as the single source of truth. Overwrites `whatsapp_message`, `whatsapp_text`, and `_en` with the post-Enforce final message. Rebuilds `telegram_messages`. |
| `nodes/split_telegram_messages.js` | Split Telegram Messages Code node | Splits review text and pure English WhatsApp message. |
| `templates/ai_output_schema.json` | Reference only | Standard JSON shape for Generator and Enforce outputs: `{ "whatsapp_message": "" }`. |
| `templates/telegram_review_template.txt` | Reference only | Telegram review text shape. |
| `templates/telegram_final_template.txt` | Reference only | Telegram final text shape. |
| `samples/*.json` | Local testing | Valid sample inputs for regression checks. |

## Send Chain Single Source of Truth

After `api/filter-and-format-telegram-final.js`, the post-Enforce message is propagated to all three downstream fields:

- `whatsapp_message` ← Enforce output
- `whatsapp_text` ← Enforce output
- `_en` ← Enforce output (overwrites Generator's pre-Enforce value)

This guarantees that any downstream consumer reading any of these fields gets the validated message, not the raw Generator candidate.

## Prompt Pulling

In n8n.cloud, prompt files can be pulled from GitHub raw URLs using HTTP Request nodes. Code node files are maintained here and pasted into n8n manually when changed.

## Build AI Context Regeneration Rule

`nodes/build_ai_context.js` is the n8n-facing standalone file. `src/context/*` is the modular source. If any file in `src/context/` changes, regenerate `nodes/build_ai_context.js` before updating the n8n Code node.