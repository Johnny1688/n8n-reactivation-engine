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

Produced by the main AI node using:

- `prompts/reactivation_system.txt`
- `prompts/reactivation_user.txt`
- `reactivation_ai_payload`

Output must be JSON only:

```json
{
  "should_send": true,
  "why": "",
  "whatsapp_message": ""
}
```

Notes:

- `should_follow_up_now = false` in the payload does not mean "do not send".
- It means generate an ultra-light optional message.
- `should_send = false` should be rare and used only when there is no valid trigger.

## 3. Parse AI Output

Produced by `nodes/parse_ai_output.js`.

Expected parsed fields:

```json
{
  "should_send": true,
  "why": "",
  "whatsapp_message": ""
}
```

Fallback on invalid JSON:

```json
{
  "should_send": false,
  "why": "invalid_ai_json",
  "whatsapp_message": ""
}
```

## 4. Enforce Message Quality Output

Produced by the quality AI node using:

- `prompts/enforce_quality_system.txt`
- `prompts/enforce_quality_user.txt`
- `whatsapp_message`
- `reactivation_ai_payload`

Output must be JSON only:

```json
{
  "pass": true,
  "quality_reason": "",
  "final_message": ""
}
```

The quality node validates or minimally tightens the message. It must not create a new strategy.

## 5. Telegram Outputs

`nodes/format_telegram_message.js` adds:

- `telegram_review_text`

`nodes/filter_and_format_telegram_final.js` adds:

- `sendable`
- `telegram_final_text`

`nodes/split_telegram_messages.js` adds:

- `telegram_review_message`
- `telegram_english_message`
