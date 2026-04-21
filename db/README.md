# DB Snapshots

Local snapshots used as restore points before destructive Supabase operations.

## ⚠️ Repository is PUBLIC

This means:
- `db/views/` — SQL view definitions (pure structure, safe to commit)
- `db/backups/` — Customer data JSON (gitignored, NEVER commit)
- `db/.local/` — Anything experimental (gitignored)

If you create new backup files, place them in `db/backups/` or `db/.local/`.
Both are gitignored to prevent accidental customer PII exposure.

## Naming convention

`YYYY-MM-DD-<short-description>.<ext>`

## Why public repo?

n8n cloud workflow loads prompts via `raw.githubusercontent.com/...`,
which requires public visibility. Trade-off: source code public,
data strictly local.
