# Architecture Roadmap

Last updated: 2026-04-19

## Current Architecture (after 2026-04-19 work)

### Write paths to `pipeline_state`

1. **n8n WhatsApp Incoming Message** workflow
   - Triggered by: Plugin sync (webhook)
   - Writes: stage, status, last_customer_message_time, last_my_message_time,
     last_interaction_time, needs_follow_up, follow_up_priority, updated_at,
     days_since_* fields
   - Protection: Stage Trigger in DB prevents downgrade of quoted/ready/closed_*

2. **Manual (you, via Supabase Dashboard or SQL)**
   - Used for: stage promotions (→ quoted, → ready, → closed_won, → closed_lost), notes

### Read paths from `pipeline_state`

1. **followup_candidates** view (primary production view)
   - Filters: not closed, I sent last, cooldown per stage, follow_up_count < 6
   - Ordering: stage_priority_score (ready → quoted → engaged → stalled → outreach)
   - No LIMIT (caller decides)
   - Bypasses `needs_follow_up` field (uses time + stage logic directly)

2. **today_followups_100** view (backward-compat alias)
   - `SELECT * FROM followup_candidates LIMIT 100`

3. **pending_my_reply** view (your attention list)
   - Customers who messaged you >2 days ago and you haven't replied

### Reactivation Engine (方案 B — no writeback)

- Reads: `followup_candidates LIMIT 50`
- Generates AI activation messages → Telegram
- Does NOT write back to pipeline_state
- Closed-loop by: you manually send on WhatsApp → Plugin sync →
  WhatsApp Incoming updates last_my_message_time → view auto-filters

### DB Triggers

1. **preserve_protected_stages** (deployed 2026-04-19)
   - Fires: BEFORE UPDATE ON pipeline_state
   - Blocks: quoted/ready/closed_* → auto stages (new/outreach/engaged/stalled)
   - Allows: manual overrides, promotions (e.g., quoted → closed_won)

### Workflows Status

| Workflow | Status | Note |
|---|---|---|
| WhatsApp Incoming Message | Active | Core data ingestion |
| Follow-up Engine (Telegram Alert) - V0418 | Pending cron | Reactivation; 35 nodes |
| Daily Stage Update | DISABLED 2026-04-19 | Was source of quoted→stalled corruption |

---

## Known Latent Bugs (monitored, not fixing)

### Bug 1: Unique Pipeline State — `entry.stage = "new"` hardcoded reset

- **Severity:** Would corrupt quoted/ready stages
- **Status:** Mitigated by Stage Trigger (DB layer)
- **Why not fixing:** The node has no access to existing pipeline_state row
  (it only receives webhook messages). Fix would require adding a Supabase
  GET node before this one — architectural change, not worth it.
- **Trigger for revisit:** If Stage Trigger is ever removed or bypassed

### Bug 2: Unique Pipeline State — case 3 `hasFollowedUpAlready` permanent lockout

- **Severity:** Would permanently exclude re-followed customers from activation pool
- **Status:** Dormant. `last_followed_up_at` is always null in current system.
- **Why not fixing:** In 方案 B, Reactivation Engine never writes last_followed_up_at.
  hasFollowedUpAlready is always false, and the buggy branch is never entered.
- **Trigger for revisit:** If we switch to 方案 A (Engine writes back to pipeline_state)

### Follow-up Schedule Update — dormant subsystem

- **Status:** Not dead, just never fires (no candidates pass AI Follow-up Candidates filter)
- **Root cause:** Circular dependency — needs next_follow_up_at seeded, but only
  Follow-up Schedule Update writes it
- **Decision deferred:** Keep as-is for now; revisit in M7

---

## Data Snapshot (2026-04-19 end of day)

### Pipeline counts

- Total customers: 681
- ready:    21 (3%)
- quoted:   41 (7%)
- engaged:  ~300 (44%)
- stalled:  227 (33%)
- outreach: 92  (13%)

### Activation pool

- followup_candidates total: 592 eligible
- followup_candidates LIMIT 50: 18 ready + 32 quoted
- pending_my_reply: 15 (3 ready, 4 engaged, 7 stalled, 1 outreach)

### Estimated cycle

- Initial full-coverage cycle: ~16-17 days at 50/day
- Steady state eligibility: ~32/day

---

## Migration Roadmap (M1-M7)

Not today's work. For future execution.

### M1: Stage protection trigger — DONE 2026-04-19

### M2: `days_since_*` as generated columns
Replace runtime computation with Postgres generated columns.

### M3: Add `system_events` table for observability
Log every webhook, every activation, every stage transition.

### M4: Move stage derivation to Postgres function
Replace n8n JS with `CREATE FUNCTION compute_stage()` + trigger on messages INSERT.

### M5: Move needs_follow_up computation to Postgres function
At this point, Unique Pipeline State node retires.

### M6: Delete dead workflow nodes
- Notion + Sales Analysis chain (8 orphan nodes)
- Google Sheets append (disabled)
- Filter Current Customer (orphan)
- Generate Sales Analysis1 (orphan)
- HTTP Request-Pipeline State1 (orphan)

### M7: Decide Follow-up Schedule Update fate
Either revive (seed next_follow_up_at for all customers) or delete.

---

## Decisions Made Today (2026-04-19)

| Decision | Choice | Rationale |
|---|---|---|
| View design | Stage-first, no LIMIT | Business value priority + flexibility |
| Cooldown tiers | 3/5/7/14/21 days per stage | Matches B2B decision cycles |
| Eviction logic | needs_follow_up untrusted in view | Historic Unique Pipeline State bugs |
| Engine writeback | 方案 B — no writeback | Manual closed loop via WhatsApp |
| Bug fixes | Deferred, monitored | Both bugs protected/dormant |
| Daily Stage Update | DISABLED | Source of quoted→stalled corruption |
| pending_my_reply | New standalone view | Separate from activation pool |

---

## Decisions Made Today (2026-04-21)

| Decision | Choice | Rationale |
|---|---|---|
| Stale next_follow_up_at cleanup | Cleared 174 rows | View OR-condition allowed stale next_follow_up_at to bypass stage cooldowns; root cause was historic batch-set on 4/1 |
| New status value: migrated_to_group | Added to view exclusion list | Customers upgraded from 1-on-1 to 2-person group chat need to be excluded from auto reactivation |
| View permanent fix (OR→AND) | Deferred to next sprint | Stale data cleared = short-term issue resolved; structural refactor deserves dedicated commit window |
| v3 prompt production cron | Deferred to 4/27 | Plugin sync delay (Luis case: 14h) creates risk of duplicate customer outreach if cron runs before sync completes |

---

## Lessons Learned

### 2026-04-19 — Claude Code fabricated n8n node fix

Attempted to use Claude Code (VS Code) to generate a patched version of the
Unique Pipeline State node code. The output completely rewrote the node using
different variable names, stages, and case structure — NOT a modification of
the actual code.

**What happened:**
- Real code uses: `role`, `last_customer_message_time`, `last_my_message_time`,
  stages `new/outreach/engaged/stalled`
- Claude Code generated: `hasTheirMessages`, `last_their_message_at`,
  stages `engaged/warm/cold/no_reply/inbound_new/new`
- If pasted, would have crashed the WhatsApp Incoming workflow entirely

**Root cause:** Complex context (n8n conventions, Chinese stage semantics,
integer role flags) exceeded Claude Code's ability to faithfully modify.
It defaulted to "rewriting based on bug description" rather than reading + editing.

**Prevention for future node edits:**
- Never accept LLM-generated node code without side-by-side diff against real source
- For small (<50 line) edits to n8n nodes: hand-edit directly in n8n UI
- For larger refactors: export workflow JSON, use Claude Code on that JSON
  with explicit "output must match structure exactly, change only these
  specific lines" instructions, then re-import

### 2026-04-21 — Plugin sync delay invalidates real-time activation assumption

Discovered during followup_candidates audit that WhatsApp Plugin sync 
can be delayed by 14+ hours. Customer "Luis Gabriel" was actually 
messaged on 2026-04-20 12:28 but didn't appear in messages table 
until 2026-04-21 02:24 — a 14-hour gap during which the activation 
engine would have considered him "not yet contacted."

What this means:
- pipeline_state.last_my_message_time can be hours-to-days stale
- Daily cron activation reads stale state → may re-activate already-contacted customers
- Real-world impact: B2B customers receive duplicate outreach, damaging trust

Mitigation needed before cron goes live:
- Either: trigger Plugin force-sync before each activation run, then wait for completion
- Or: add a "minimum hours since pipeline_state.updated_at" guard in followup_candidates view
- Or: accept the risk and accept 5-10% duplicate-outreach rate

Decision deferred to 4/27 reactivation sprint.

---

## Open Questions for Future

1. Should outreach customers (92, 21-day cooldown) be part of the main pool
   or a separate flow?
2. Should Follow-up Schedule Update be revived or killed?
3. Do we want a morning digest Telegram message showing pool size +
   pending_my_reply in one place?
4. Plugin auto-sync (setInterval) — still open from 2026-04-19 handoff
5. closed_won / closed_lost — no workflow exists to set these; manual only
6. Plugin sync SLA — what's acceptable max delay before we treat 
   pipeline_state as stale?
7. Should daily activation cron force-trigger Plugin sync first 
   and wait for completion?
8. How to handle "quoted with no message context" customers — 
   manual notes backfill, stage downgrade to stalled, or skip 
   from activation pool entirely?

## Claude.ai Project Sync Protocol

### When to upload files to Project

| Change type | Update Project |
|---|---|
| n8n node JS code changed | YES — update n8n_workflow_nodes.md |
| n8n node config changed (cron / SQL only) | NO (not worth the churn) |
| New workflow added | YES — export JSON, upload |
| Workflow structure changed (new nodes) | YES — re-export JSON |
| Supabase schema / view changed | YES — update SQL docs |
| Prompt changes | YES — update .txt in prompts/ |
| API code changed | YES — update api/*.js |
| architecture_roadmap.md updated | YES |

### Q6: Email channel extension

**Question raised:** 2026-04-19 (clarified)

Google Ads landing page → form → manual first email → email conversation.
Need to extract thread history from Gmail + auto-generate follow-ups.

**Key insight:** This is NOT a new project. It's extending the current 
system with a second data channel. The activation logic (stages, cooldown, 
AI prompts, Telegram review) is 80% reusable.

**Architecture plan:**
- Keep same Project + same Supabase
- Add `channel` field to messages table ('whatsapp' | 'email')
- Add `email` field to contacts table
- New n8n workflow: Gmail Incoming (mirrors WhatsApp Incoming)
- New n8n workflow: Email Reactivation Engine
- Adapt build-context API to handle channel parameter
- Adapt activation prompts for email format (subject + body + tone)

**Key decision deferred:**
- project_key convention for email-only customers (email:xxx vs phone fallback)
- Gmail API sync cadence (15 min? 30 min?)
- Manual send vs auto-send via Gmail API

**Timeline:** ~1 week WhatsApp observation, then 2 weeks email implementation.


