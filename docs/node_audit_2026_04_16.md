# n8n Workflow Node Audit — 2026-04-16

## Part 1: Code Node Logic Audit

### Node 1 — Build AI Context (`nodes/build_ai_context.js` → `src/context/*`)

- **Purpose:** Clean, deduplicate, and enrich raw customer data into a structured AI-ready payload.
- **Key inputs:** `messages[]`, `project_key`, `customer_name`, raw structured fields.
- **Key outputs:** `conversation`, `conversation_core`, `customer_only_text`, `is_my_turn_to_reply`, `has_not_now_signal`, `has_price_signal`, `has_timing_signal`, `customer_last_message_type`, `timeline`, `stop_point_analysis`, `forbidden_repeat_zone`, `reactivation_ai_payload`, all derived business fields.
- **Key logic:**
  - `is_my_turn_to_reply`: `null` when no messages, `true` when last message role is `customer`, `false` otherwise.
  - `has_not_now_signal`: regex test on `customerOnlyLower || fullTextLower` — uses customer-only text when non-empty (JS truthy fallback).
  - `hard_no_send`: NOT computed here. This node outputs `has_not_now_signal` but not `hard_no_send`.
- **Potential issues:**
  - `is_my_turn_to_reply = null` when `uniqueMessages.length === 0` — downstream consumers (compile-enforce-prompt) coerce via `safeBoolean()`, turning `null` → `false`. Semantic mismatch: "no messages" ≠ "not my turn".
  - `has_not_now_signal` uses `customerOnlyLower || fullTextLower` — when `customerOnlyLower` is empty string (falsy), falls back to full text including seller messages. Potential false positive path.

### Node 1.5 — Build Context API (`api/build-context.js`)

- **Purpose:** Vercel API wrapper around `buildAIContext`. Adds execution guidance layer: `hard_no_send`, `send_state`, `anchor_object`, `allowed_micro_triggers`.
- **Key inputs:** Result from `buildAIContext()`.
- **Key outputs:** Enriched result with `hard_no_send`, `send_state`, `reactivation_ai_payload` (with stop_point, decision, constraints).
- **Key logic:**
  - `detectHardNoSend(result, text)`: first checks `result.has_not_now_signal === true`, then runs its own 18-pattern regex on `buildContextText(result)`.
  - `buildContextText(result)` concatenates: `customer_only_text`, `customer_recent_only_text`, `last_customer_message`, **`last_my_message`**, **`conversation_core`**, **`conversation`**, `project_key`, `product_interest`, `concerns`, `key_signals`.
  - `deriveExecutionGuidance()`: cascading if-else chain (cheaper → catalog → photos → 8vs10 → timing → price → shipping → warranty → payment → model → fallback). Each branch sets `hardNoSend: false` except the top-level `hardNoSend` check.
- **ANOMALY:** `buildContextText` includes seller messages (`last_my_message`, `conversation_core`, `conversation`). Seller's own phrases like "I'll let you know" or "reach out to you" trigger `detectHardNoSend` → false positive `hard_no_send=true`. **Confirmed on Core1Pilates** (see Part 4).

### Node 3 — Parse AI Output (`nodes/parse_ai_output.js`)

- **Purpose:** Extract `whatsapp_message` from Generator AI's raw text output.
- **Key inputs:** AI output text (various field names: `ai_output_text`, `ai_output`, `text`, `output`, `content`).
- **Key outputs:** `should_send` (bool), `why` (string), `whatsapp_message` (string). Spread onto original item.
- **Key logic:** Strips code fences, JSON.parse, normalize. Falls back to `{ should_send: false, why: 'invalid_ai_json', whatsapp_message: '' }`.
- **Potential issues:** None significant. Defensive parsing with clear fallback.

### Node 4 — Format Telegram Message (`nodes/format_telegram_message.js`)

- **Purpose:** Build `_en`, `_cn`, and `telegram_messages[]` from parsed AI output. Filters out invalid items.
- **Key inputs:** `ai_parsed`, `project_key`, `order_group`, various whatsapp message fields.
- **Key outputs:** `_en` (English message), `_cn` (Chinese), `telegram_messages[]`, enriched `ai_parsed`.
- **Key logic:**
  - `_en` resolved via `firstNonEmptyString(data.whatsapp_text, data.whatsapp_message, data.final_message, data.message_text, aiParsed.whatsapp_text, aiParsed.whatsapp_message, ...)` — 9-source waterfall.
  - Filter: drops items where `project_key` empty, `_en` empty, `_en.length < 10`, or `_en === 'undefined'/'null'`.
- **Potential issues:**
  - Filter drops items with empty `_en` BEFORE Enforce can evaluate them. If Generator returns empty (e.g. for `hard_no_send`), the item is silently dropped here, never reaching Enforce.

### Node 5 — Compile Enforce Prompt (`api/compile-enforce-prompt.js`)

- **Purpose:** Build `final_quality_system_prompt` (from file) and `final_quality_user_prompt` (from data) for the Enforce AI node.
- **Key inputs:** All fields from previous nodes. Reads `prompts/enforce_quality_system.txt`.
- **Key outputs:** `final_quality_system_prompt`, `final_quality_user_prompt`.
- **Key logic:**
  - `safeBoolean()` coerces `null`/`undefined` → `false` for `hard_no_send`, `has_not_now_signal`, `is_my_turn_to_reply`, `should_reactivate_now`.
  - TASK section: 4-line instruction (if hard_no_send → EMPTY, validate, rewrite, grounded).
- **Potential issues:**
  - `safeBoolean(json.hard_no_send)` will show `false` when field is missing/undefined. If upstream didn't set it, Enforce sees `false` and will never produce EMPTY.

### Node 7 — Filter and Format Telegram Final (`api/filter-and-format-telegram-final.js`)

- **Purpose:** Take Enforce AI output, extract final message, build Chinese analysis text, format Telegram review messages.
- **Key inputs:** Enforce AI output (`output[0].content[0].text`), all upstream fields.
- **Key outputs:** `_en` (overwritten with Enforce result), `whatsapp_message`, `whatsapp_text`, `enforce_status`, `analysis_text`, `telegram_messages[]`.
- **Key logic:**
  - `getEnforceParsed()`: parses `output[0].content[0].text` as JSON, extracts `whatsapp_message`.
  - `shouldBlock = emptyMessage` (i.e., block only when Enforce returned empty).
  - `_en: finalMessage` — overwrites upstream `_en` with Enforce's output.
  - Risk pattern checks: `hasHighRiskPattern`, `hasTooManyQuestions`, `hasOrRisk`, `hasDecisionRisk`, `hasGenericRisk`, `hasWeakAnchorRisk` — flagged but NOT used for blocking (only `emptyMessage` blocks).
- **Potential issues:**
  - All risk flags are computed but only used for reporting labels. They don't block or trigger rewrites. This is intentional (Enforce AI handles quality) but worth noting.

### Node 8 — Split Telegram Messages (`nodes/split_telegram_messages.js`)

- **Purpose:** Split output into `telegram_review_message` and `telegram_english_message`.
- **Key inputs:** `telegram_review_text`, `telegram_final_text`, `whatsapp_message`.
- **Key outputs:** `telegram_review_message`, `telegram_english_message`.
- **Key logic:** Simple field mapping with fallback (`telegram_review_text || telegram_final_text`).
- **Potential issues:** None significant. Minimal logic.

---

## Part 2: Data Flow Field Tracing

### `customer_name`

- **Node 1** (buildAIContext): passes through `input.customer_name` unchanged.
- **Node 1.5** (build-context API): passes through from result.
- **Node 5** (compile-enforce-prompt): injected into user prompt as `Customer name: [value]`.
- **Node 7** (filter-and-format): re-resolved via `pick(current.customer_name, aiParsed.customer_name, projectKey)`.
- **NOTE:** Never sanitized in JS. NAME SANITIZATION RULE exists only in Generator prompt, not in code.

### `conversation`

- **Node 1** (buildAIContext): built from `recentMessages.slice(-10)` as `role: message` lines.
- **Node 5** (compile-enforce-prompt): injected into user prompt under `REAL CONVERSATION` section.
- **Node 7** (filter-and-format): not directly used (uses `dated_history_summary` or `conversation_core` for analysis text).
- **NOTE:** `conversation_core` (last 20 messages) is a separate field. Both passed to Enforce.

### `hard_no_send`

- **Node 1** (buildAIContext): NOT set here. `has_not_now_signal` is set instead.
- **Node 1.5** (build-context API): `detectHardNoSend(result, text)` → `guidance.hardNoSend` → written to `hard_no_send` field + embedded in `reactivation_ai_payload.stop_point.hard_no_send` + `reactivation_ai_payload.decision.hard_no_send`.
- **Node 5** (compile-enforce-prompt): `safeBoolean(json.hard_no_send)` → injected into SEND STATE section.
- **Node 6** (Enforce AI): reads SEND STATE, applies EMPTY POLICY.
- **Node 7** (filter-and-format): does NOT re-check `hard_no_send`. Relies entirely on Enforce output being empty.

### `_en`

- **Node 4** (format_telegram_message): first set here from 9-source waterfall of message fields. Items with empty `_en` are DROPPED.
- **Node 5** (compile-enforce-prompt): injected into user prompt as `English candidate`.
- **Node 7** (filter-and-format): **OVERWRITTEN** with `enforceParsed.whatsapp_message` (Enforce output). This is the final `_en`.

### `whatsapp_message`

- **Node 2** (Generator AI): outputs `{ "whatsapp_message": "..." }`.
- **Node 3** (parse_ai_output): extracted from JSON, set as `whatsapp_message` field.
- **Node 4** (format_telegram_message): used as one of the 9 sources for `_en`.
- **Node 5** (compile-enforce-prompt): `aiParsed.whatsapp_message` used as `Parsed candidate`.
- **Node 6** (Enforce AI): outputs `{ "whatsapp_message": "..." }` (final or empty).
- **Node 7** (filter-and-format): `enforceParsed.whatsapp_message` → becomes final `whatsapp_message`, `whatsapp_text`, and `_en`.

---

## Part 3: 50-Customer Data Sampling (production_batch_new_raw.json)

### hard_no_send = true: 3 customers

1. Neha加拿大（3.4日） Bhudia
2. Bianca Wallace加拿大1台FR001（25.9.17日）
3. Core1Pilates - Axcor Pilates

### has_not_now_signal = true: 3 customers

1. Neha加拿大（3.4日） Bhudia
2. Bianca Wallace加拿大1台FR001（25.9.17日）
3. Core1Pilates - Axcor Pilates

(Exact same 3 as hard_no_send — these are 1:1 correlated in this batch.)

### is_my_turn_to_reply = null: 2 customers

1. Yosef美国 J3 Baranes
2. HC菲律宾计划开工作室

(Indicates `uniqueMessages.length === 0` — no valid messages after cleaning.)

### _en = empty string: 0 customers

### _en contains `{{` placeholder: 0 customers

### _en contains Chinese characters: 0 customers

---

## Part 4: hard_no_send Spot Check (3 customers)

### Spot #1 — Neha加拿大（3.4日） Bhudia

- **project_key:** Neha加拿大（3.4日） Bhudia
- **last_customer_message:** "I will however reach out to you as soon as a new client comes in and is interested in your product. Thank you for checking in, I really appreciate it. Have a great day!"
- **last_my_message:** "Thanks for letting me know, I appreciate the transparency. No worries at all — that happens quite often, especially when clients are comparing different options. If you have any upcoming clients, even at an early stage, feel free to share the requirements with me. I can help you quickly narrow down..."
- **has_not_now_signal:** true
- **is_my_turn_to_reply:** false
- **customer_last_message_type:** polite_close
- **Verdict:** ✅ CORRECT. Customer explicitly said they will "reach out... as soon as a new client comes in" — clear deferral.

### Spot #2 — Bianca Wallace加拿大1台FR001（25.9.17日）

- **project_key:** Bianca Wallace加拿大1台FR001（25.9.17日）
- **last_customer_message:** "I'm not looking for equipment right now, but I'll let you know if/when I am again."
- **last_my_message:** "I'll stay in touch from time to time with any new models or updates, just in case it's helpful for you in the future. Whenever you're ready again, feel free to reach out anytime"
- **has_not_now_signal:** true
- **is_my_turn_to_reply:** false
- **customer_last_message_type:** not_now
- **Verdict:** ✅ CORRECT. Customer explicitly said "not looking for equipment right now" — textbook hard_no_send.

### Spot #3 — Core1Pilates - Axcor Pilates

- **project_key:** Core1Pilates - Axcor Pilates
- **last_customer_message:** "I will open it tonight"
- **last_my_message:** "Great to hear that, Rick."
- **has_not_now_signal:** true
- **is_my_turn_to_reply:** false
- **customer_last_message_type:** unknown
- **Verdict:** ⚠️ FALSE POSITIVE. Customer said "I will open it tonight" (referring to a delivery). Customer never said "not now" or deferred.
  - **Root cause:** `detectHardNoSend()` in `api/build-context.js` uses `buildContextText()` which concatenates ALL text including seller messages. Seller's own messages contain: "I'll get back to you as soon as I receive the updated information", "I'll let you know right away", "the delivery team will reach out to you directly" — these match the not-now regex patterns (`i'll let you know`, `will reach out`, `get back to you`).
  - **Customer-only text does NOT match** any not-now pattern (confirmed via regex test).
  - **Bug location:** `buildContextText()` in `api/build-context.js` lines 30-41 — includes `last_my_message`, `conversation_core`, `conversation` (all contain seller text).
