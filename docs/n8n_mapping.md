# n8n Mapping

This repository is the source of truth for the reactivation workflow logic and prompts. n8n should run the workflow, not become the place where the logic is edited.

## Node Order

1. Build AI Context
2. Main Reactivation AI
3. Parse AI Output
4. Enforce Message Quality
5. Format Telegram Review
6. Filter and Format Telegram Final
7. Split Telegram Messages

## File Mapping

| GitHub file | n8n node | Purpose |
| --- | --- | --- |
| `nodes/build_ai_context.js` | Build AI Context Code node | Standalone generated Code node entry from `src/context/*`. Produces the full context object and `reactivation_ai_payload`. |
| `src/context/*` | Source implementation | Modular source files for Build AI Context. Edit these first, then regenerate `nodes/build_ai_context.js`. |
| `prompts/reactivation_system.txt` | Main Reactivation AI system prompt | Strict execution prompt. AI must use only `reactivation_ai_payload`. |
| `prompts/reactivation_user.txt` | Main Reactivation AI user prompt | Template ending with `{{reactivation_ai_payload}}`. |
| `nodes/parse_ai_output.js` | Parse AI Output Code node | Parses AI JSON text into `should_send`, `why`, and `whatsapp_message`. Uses safe fallback on invalid JSON. |
| `prompts/enforce_quality_system.txt` | Enforce Message Quality system prompt | Validates grounded, low-pressure, single-path, non-generic message quality. |
| `prompts/enforce_quality_user.txt` | Enforce Message Quality user prompt | Supplies `whatsapp_message` and `reactivation_ai_payload` to the quality gate. |
| `nodes/format_telegram_message.js` | Format Telegram Review Code node | Builds Telegram review text from project, customer, AI reason, message, and payload summary. |
| `nodes/filter_and_format_telegram_final.js` | Filter and Format Telegram Final Code node | Filters non-sendable items and creates final Telegram-ready text. |
| `nodes/split_telegram_messages.js` | Split Telegram Messages Code node | Splits review text and pure English WhatsApp message. |
| `templates/ai_output_schema.json` | Reference only | Standard JSON shape for main AI and quality AI outputs. |
| `templates/telegram_review_template.txt` | Reference only | Telegram review text shape. |
| `templates/telegram_final_template.txt` | Reference only | Telegram final text shape. |
| `samples/*.json` | Local testing | Valid sample inputs for regression checks. |

## Prompt Pulling

In n8n.cloud, prompt files can be pulled from GitHub raw URLs using HTTP Request nodes. Code node files are maintained here and pasted into n8n manually when changed.

## Build AI Context Regeneration Rule

`nodes/build_ai_context.js` is the n8n-facing standalone file. `src/context/*` is the modular source. If any file in `src/context/` changes, regenerate `nodes/build_ai_context.js` before updating the n8n Code node.
