# Repository Guidelines

This repository manages the n8n reactivation workflow logic, prompts, samples, and documentation.

## Structure

- `src/context/` contains modular JavaScript implementation for Build AI Context.
- `nodes/` contains n8n Code node entry files that call or mirror repo-managed logic.
- `prompts/` contains AI prompt text pulled into n8n or pasted into AI nodes.
- `templates/` contains reference output schemas and Telegram text templates.
- `samples/` contains valid JSON inputs for local tests.
- `docs/` explains the n8n mapping and workflow data contract.

## Editing Rules

- Keep behavior stable unless a file-specific task explicitly asks for a logic change.
- Prefer small, focused changes.
- Do not reformat unrelated files.
- Keep prompt wording compact and strict.
- Keep `reactivation_ai_payload` as the only input to the main reactivation AI node.
- Do not add secrets or production customer data to samples.

## Verification

- Run `node --check` on changed JavaScript files.
- Validate changed JSON files with `JSON.parse`.
- Run `node runSample.js` after changes to Build AI Context or shared context modules.
