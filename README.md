# n8n Reactivation Engine

This repository manages the reactivation workflow logic for n8n.

The direction is simple: Codex and GitHub manage the logic, prompts, samples, and contracts. n8n calls or runs those assets.

## Purpose

The workflow creates one low-friction WhatsApp reactivation message from structured context.

The main AI node must not re-analyze the full conversation. It receives only `reactivation_ai_payload` and executes the precomputed strategy.

## Folder Structure

- `src/context/` - modular Build AI Context source logic.
- `nodes/` - n8n Code node files.
- `prompts/` - main reactivation and quality-enforcement prompts.
- `templates/` - AI output schema and Telegram reference templates.
- `samples/` - valid local sample inputs.
- `docs/` - n8n mapping and workflow data contract.

## Reactivation Flow

1. `nodes/build_ai_context.js`
   - Builds context from the input item.
   - Preserves existing business logic.
   - Produces `reactivation_ai_payload`.

2. Main Reactivation AI
   - Uses `prompts/reactivation_system.txt`.
   - Uses `prompts/reactivation_user.txt`.
   - Receives only `reactivation_ai_payload`.
   - Outputs JSON: `should_send`, `why`, `whatsapp_message`.

3. `nodes/parse_ai_output.js`
   - Parses the AI JSON text.
   - Returns a safe fallback on invalid JSON.

4. Enforce Message Quality AI
   - Uses `prompts/enforce_quality_system.txt`.
   - Uses `prompts/enforce_quality_user.txt`.
   - Validates the message against `reactivation_ai_payload`.
   - Does not create a new strategy.

5. Telegram nodes
   - `nodes/format_telegram_message.js`
   - `nodes/filter_and_format_telegram_final.js`
   - `nodes/split_telegram_messages.js`

## Update Workflow

1. Edit files locally.
2. Run checks:

   ```sh
   node --check src/context/buildAIContext.js
   node --check nodes/parse_ai_output.js
   node runSample.js
   ```

3. Commit changes.
4. Push to GitHub.
5. n8n.cloud pulls prompt files through HTTP Request nodes where possible.
6. Code node files in `nodes/` are managed here and pasted into n8n manually when changed.

## Build AI Context Source Rule

`src/context/*` is the modular source of truth.

`nodes/build_ai_context.js` is the standalone n8n-facing generated file.

If `src/context/*` changes, regenerate `nodes/build_ai_context.js` before pasting it into n8n.

## Local Testing

Run the current sample:

```sh
node runSample.js
```

The script reads `samples/marea.json`, runs Build AI Context, and prints the full output.

The output should include:

```json
{
  "reactivation_ai_payload": {
    "timeline": {},
    "last_signal": {},
    "stop_point": {},
    "constraints": {},
    "decision": {}
  }
}
```
