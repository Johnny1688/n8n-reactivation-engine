# Workflow Contract

This contract defines the data passed between the n8n nodes.

## 1. Build AI Context Output

Produced by `nodes/build_ai_context.js`.

It returns the original input plus derived fields. Downstream nodes should rely on these fields:

- `project_key`
- `customer_name`
- `messages`
- `last_exchange`
- `timeline`
- `customer_last_message_type`
- `stop_point_analysis`
- `forbidden_repeat_zone`
- `reactivation_decision_basis`
- `reactivation_v6_core`
- `reactivation_ai_payload`

The main AI node should receive only `reactivation_ai_payload`.

### Reactivation AI Payload

```json
{
  "timeline": {
    "last_customer_message_time": "",
    "last_my_message_time": "",
    "who_should_reply_next": "",
    "days_since_last_customer_message": "",
    "days_since_last_my_message": "",
    "conversation_status": ""
  },
  "last_signal": {
    "last_customer_message": "",
    "last_customer_message_type": ""
  },
  "stop_point": {
    "where_it_stopped": "",
    "why_it_stopped_there": "",
    "what_my_last_push_was": "",
    "what_customer_did_not_answer": "",
    "did_my_last_push_fail": false,
    "smallest_reply_to_trigger": ""
  },
  "constraints": {
    "already_asked_questions": [],
    "already_sent_topics": [],
    "already_used_angles": [],
    "do_not_repeat": []
  },
  "decision": {
    "should_follow_up_now": false,
    "best_trigger_type": "",
    "best_trigger_reason": "",
    "must_avoid": [],
    "smallest_reply_goal": ""
  }
}
```

The AI must not receive or re-analyze the full conversation.

## 2. Main Reactivation AI Output

Produced by the main AI (Generator) node using:

- `prompts/reactivation_system.txt`
- `prompts/reactivation_user.txt`
- `reactivation_ai_payload`
- `conversation_core`
- `conversation`
- `customer_name`
- `project_key`

Output must be JSON only:

```json
{
  "whatsapp_message": ""
}
```

Notes:

- The Generator outputs only `whatsapp_message`. No `should_send`, no `why`, no visible analysis.
- The Generator never decides whether to send. That decision belongs to the Enforce node.
- Default behavior is to produce a message. Empty output is reserved for cases where the entire input is unusable or corrupt.
- Lighter messages (not empty) are produced when input signals `hard_no_send`, `has_not_now_signal`, not-my-turn, or low-priority states. The Enforce node makes the final empty/non-empty decision.
- `should_send` and `why` are legacy fields. The Generator no longer produces them. `nodes/parse_ai_output.js` handles their absence gracefully.

## 3. Parse AI Output

Produced by `nodes/parse_ai_output.js`.

Expected parsed fields:

```json
{
  "whatsapp_message": ""
}
```

Legacy fields `should_send` and `why` are extracted if present (older outputs) and default to `should_send: false`, `why: ''` when absent.

Fallback on invalid JSON:

```json
{
  "should_send": false,
  "why": "invalid_ai_json",
  "whatsapp_message": ""
}
```

## 4. Enforce Message Quality Output

Produced by the quality AI (Enforce) node using:

- `prompts/enforce_quality_system.txt`
- `prompts/enforce_quality_user.txt`
- candidate `whatsapp_message` (resolved from `ai_parsed.whatsapp_message || _en || ''`)
- `reactivation_ai_payload`
- `conversation_core`
- `conversation`
- `customer_name`
- `project_key`
- send-state flags: `hard_no_send`, `has_not_now_signal`, `is_my_turn_to_reply`, `should_reactivate_now`

Output must be JSON only:

```json
{
  "whatsapp_message": ""
}
```

The Enforce node validates or rewrites the candidate message. It is the single source of truth for the final outbound message. It chooses one of:

- **PASS** — candidate is valid, output unchanged
- **REWRITE** — candidate is fixable, output improved (default action)
- **GENERIC FALLBACK** — no usable history, use generic safe message
- **EMPTY** — `hard_no_send = true` only

`has_not_now_signal = true` and `is_my_turn_to_reply = false` trigger lighter rewrites, never empty. `hard_no_send = true` is the only flag that produces empty output.

## 5. Telegram Outputs

`nodes/format_telegram_message.js` adds:

- `telegram_review_text`

`api/filter-and-format-telegram-final.js` adds:

- `sendable` / `auto_send_pass`
- `telegram_final_text`
- Overwrites `whatsapp_message`, `whatsapp_text`, and `_en` with the post-Enforce final message. After this node, `_en` is the validated message — no pre-Enforce candidate text can leak downstream.

`nodes/split_telegram_messages.js` adds:

- `telegram_review_message`
- `telegram_english_message`
