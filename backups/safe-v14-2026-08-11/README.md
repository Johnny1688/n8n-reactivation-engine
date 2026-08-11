# safe-v14 stable recovery backup

Created: 2026-08-11 14:08 Beijing Time (UTC+8)

## Frozen identity

- Workflow: `Follow-up Engine Production CN Repair - 2026-05-22 safe-v14`
- Workflow ID: `kIcpya8hgKOB1LiA`
- State at backup: `Published`
- Node count: `45`
- Schedule: `0 0 6 * * 1-6`
- Production source file: `production-source.sql`
- Production source SHA-256: `191ec953cd3f4894f9cffd3e8f346fe6166c4f6c3e1e4dfc591fe80470a36c8f`
- Reactivation engine base commit: `128059bb633d063b7879882e76f5e69175815101`

## Required review routing

Normal review must keep the three internal Telegram parts:

1. `Send – Telegram Alert1 Native`: full English copy, complete Chinese reference, and review context.
2. `Send – Telegram Alert2 Native`: customer operational label for manual lookup.
3. `Send – Telegram Alert3 Native`: sendable English copy.

Blocked review must remain a single internal safety alert through
`Send Blocked Review Alert`. It must not be treated as customer-sendable copy.

All four Telegram nodes must keep plain text mode, attribution disabled, and
must not contain a literal bot token, Chat ID, or credential-bearing URL.

## Verified behavior at backup

- Engine commit `128059b` was already on `origin/main` and Vercel production.
- Post-fix exact-12: source `12`, create `12`, normal `11`, blocked `1`, normal
  Alert1/2/3 each `11`; the one blocked item was a valid safety hold.
- 2026-08-11 exact-2: create `2`, normal `2`, blocked `0`, Alert1/2/3 each `2`.
- 2026-08-11 tomorrow-list exact-2: create `2`, normal `2`, blocked `0`,
  Alert1/2/3 each `2`.
- WhatsApp send count was `0` in all customer-invisible validation runs.
- The next natural 06:00 scheduled execution remained the final long-running
  production acceptance gate at backup time.

## Recovery procedure

1. Deploy the engine commit recorded above.
2. Open the exact workflow ID and require `45` nodes before editing.
3. Restore only the connected unsuffixed source node
   `Load today_followups_填写数量` from `production-source.sql`.
4. Verify the source SHA-256 before Save/Publish.
5. Verify `Published`, the cron expression, the three normal native Telegram
   nodes, the blocked-review node, and no running/waiting execution.
6. Do not run a manual workflow or send WhatsApp as part of recovery unless a
   separate action-time approval explicitly authorizes it.

## Evidence boundaries

This is a redacted recovery manifest, not a raw n8n export. It intentionally
contains no credentials, bot tokens, Chat IDs, customer rows, execution data,
or raw customer messages. Credential bindings and the full 45-node canvas must
be verified inside n8n at recovery time.
