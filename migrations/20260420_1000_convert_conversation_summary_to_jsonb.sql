-- Migration: Convert conversation_summary from TEXT to JSONB
-- Date: 2026-04-20
-- Author: Johnny
-- Context: Customer Profile subsystem (docs/customer_profile_system.md) stores
--          structured JSON profiles in pipeline_state.conversation_summary.
--          Current type is TEXT with default ''::text. Must be JSONB to support
--          GIN indexes and direct JSON path queries.
--
-- Steps:
--   Backup non-empty rows to _backup_conversation_summary_20260420
--   1. DROP dependent views in dependency order:
--      today_followups_100 → today_followups_100_v2 → followup_candidates
--   2. Drop the ''::text default (empty string is not valid jsonb)
--   3. Normalize empty strings → NULL
--      (so §4 trigger logic "IF summary_updated_at IS NULL" works correctly)
--   4. ALTER TYPE to jsonb, casting any existing non-empty text values
--   5. Recreate followup_candidates view (original definition, verbatim)
--   6. Recreate today_followups_100_v2 view (original definition, verbatim)
--   7. Recreate today_followups_100 view (wrapper around followup_candidates)
--   All wrapped in BEGIN/COMMIT — any failure auto-rolls back, data untouched,
--   views restored (DROP VIEW inside transaction is also rolled back).
--
-- ============================================================================
-- PRE-CHECK (run BEFORE this migration, in a separate SQL Editor tab)
-- ============================================================================
--
-- Option 1 (recommended — try this first):
--   Attempts an inline cast. If ANY row has invalid JSON, the entire query
--   will abort with a cast error — that means you have bad data to clean.
--   If it returns rows, those rows will block the ALTER.
--   If it returns 0 rows, you're clear.
--
--   SELECT id, project_key, LEFT(conversation_summary, 200) AS sample
--   FROM pipeline_state
--   WHERE conversation_summary IS NOT NULL
--     AND conversation_summary != ''
--     AND NOT (
--       jsonb_typeof(
--         (CASE WHEN conversation_summary ~ '^\s*[\{\[]'
--               THEN conversation_summary
--               ELSE NULL END)::jsonb
--       ) IS NOT NULL
--     );
--
-- Option 2 (if Option 1 aborts with a cast error):
--   Step A — count how many non-empty rows exist (baseline):
--
--     SELECT count(*) AS non_empty_rows
--     FROM pipeline_state
--     WHERE conversation_summary IS NOT NULL
--       AND conversation_summary != '';
--
--   Step B — find rows that DON'T start with { or [ (obvious non-JSON):
--
--     SELECT id, project_key, LEFT(conversation_summary, 200) AS sample
--     FROM pipeline_state
--     WHERE conversation_summary IS NOT NULL
--       AND conversation_summary != ''
--       AND conversation_summary !~ '^\s*[\{\[]';
--
--   Step C — for rows that DO start with { or [, try casting one-by-one:
--     (Run in a DO block so individual failures don't abort the session)
--
--     DO $$
--     DECLARE
--       r RECORD;
--     BEGIN
--       FOR r IN
--         SELECT id, project_key, conversation_summary
--         FROM pipeline_state
--         WHERE conversation_summary IS NOT NULL
--           AND conversation_summary != ''
--           AND conversation_summary ~ '^\s*[\{\[]'
--       LOOP
--         BEGIN
--           PERFORM r.conversation_summary::jsonb;
--         EXCEPTION WHEN OTHERS THEN
--           RAISE NOTICE 'INVALID JSON — id=%, project_key=%, sample=%',
--             r.id, r.project_key, LEFT(r.conversation_summary, 200);
--         END;
--       END LOOP;
--     END $$;
--
--   Any row reported by Step B or Step C must be NULLed before running
--   this migration:
--     UPDATE pipeline_state SET conversation_summary = NULL WHERE id IN (...);
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- If anything fails inside the BEGIN block (ALTER, DROP VIEW, CREATE VIEW):
--   → Automatic rollback, no manual action needed. Data is untouched.
--   → DROP VIEW is also rolled back — views are restored to their prior state.
--
-- If ALTER succeeds but problems are discovered later:
--   1. Restore from backup:
--        UPDATE pipeline_state ps
--        SET conversation_summary = bk.conversation_summary::jsonb
--        FROM _backup_conversation_summary_20260420 bk
--        WHERE ps.id = bk.id;
--      (only needed if you NULLed rows you shouldn't have)
--
--   2. Revert column type entirely:
--        ALTER TABLE pipeline_state
--          ALTER COLUMN conversation_summary TYPE text
--          USING conversation_summary::text;
--        ALTER TABLE pipeline_state
--          ALTER COLUMN conversation_summary SET DEFAULT ''::text;
--
--     ⚠️  WARNING: jsonb → text revert serializes JSON to compact form
--     (no whitespace, sorted keys). Original text formatting cannot be
--     recovered. Use the backup table for true text-level restore.
--
-- Backup table _backup_conversation_summary_20260420 should be kept for
-- 7 days, then manually dropped:
--   DROP TABLE IF EXISTS _backup_conversation_summary_20260420;
--
-- ============================================================================
-- LOCK IMPACT
-- ============================================================================
-- ALTER TYPE requires ACCESS EXCLUSIVE lock on the table.
-- DROP VIEW also requires ACCESS EXCLUSIVE lock on the view.
-- ~681 rows as of 2026-04-19 → sub-second lock duration for all operations.
-- No concurrent reads/writes while lock is held.
-- ============================================================================

BEGIN;

-- Backup all non-empty rows (safety net)
CREATE TABLE IF NOT EXISTS _backup_conversation_summary_20260420 AS
SELECT id, project_key, conversation_summary, summary_updated_at
FROM pipeline_state
WHERE conversation_summary IS NOT NULL
  AND conversation_summary != '';

-- Step 1: Drop dependent views in dependency order
-- today_followups_100 depends on followup_candidates, so must be dropped first
DROP VIEW IF EXISTS today_followups_100;
DROP VIEW IF EXISTS today_followups_100_v2;
DROP VIEW IF EXISTS followup_candidates;

-- Step 2: Remove the empty-string default
ALTER TABLE pipeline_state
  ALTER COLUMN conversation_summary DROP DEFAULT;

-- Step 3: Normalize empty strings to NULL
UPDATE pipeline_state
SET conversation_summary = NULL
WHERE conversation_summary = '';

-- Step 4: Convert column type to JSONB
-- If any row fails to cast, the entire transaction rolls back — data & views untouched.
ALTER TABLE pipeline_state
  ALTER COLUMN conversation_summary TYPE jsonb
  USING CASE
    WHEN conversation_summary IS NULL THEN NULL
    ELSE conversation_summary::jsonb
  END;

-- Step 5: Recreate followup_candidates view (verbatim from pg_get_viewdef)
CREATE VIEW followup_candidates AS
 SELECT id,
    project_key,
    customer_name,
    stage,
    status,
    last_customer_message_time,
    last_my_message_time,
    last_interaction_time,
    needs_follow_up,
    follow_up_priority,
    notes,
    updated_at,
    EXTRACT(day FROM now() - last_customer_message_time)::integer AS days_since_last_customer_message,
    EXTRACT(day FROM now() - last_my_message_time)::integer AS days_since_last_my_message,
    intent_score,
    last_followed_up_at,
    conversation_summary,
    summary_updated_at,
    follow_up_count,
    next_follow_up_at,
    follow_up_bucket,
    reactivation_bucket,
    reactivation_at,
    message_count,
        CASE stage
            WHEN 'ready'::text THEN 1
            WHEN 'quoted'::text THEN 2
            WHEN 'engaged'::text THEN 3
            WHEN 'stalled'::text THEN 4
            WHEN 'outreach'::text THEN 5
            ELSE 9
        END AS stage_priority_score
   FROM pipeline_state
  WHERE (status <> ALL (ARRAY['closed_won'::text, 'closed_lost'::text])) AND (stage <> ALL (ARRAY['closed_won'::text, 'closed_lost'::text])) AND last_my_message_time IS NOT NULL AND (last_customer_message_time IS NULL OR last_customer_message_time < last_my_message_time) AND (follow_up_count IS NULL OR follow_up_count < 6) AND (next_follow_up_at IS NOT NULL AND next_follow_up_at <= now() OR next_follow_up_at IS NULL AND (stage = 'ready'::text AND last_my_message_time < (now() - '3 days'::interval) OR stage = 'quoted'::text AND last_my_message_time < (now() - '5 days'::interval) OR stage = 'engaged'::text AND last_my_message_time < (now() - '7 days'::interval) OR stage = 'stalled'::text AND last_my_message_time < (now() - '14 days'::interval) OR stage = 'outreach'::text AND last_my_message_time < (now() - '21 days'::interval) OR (stage <> ALL (ARRAY['ready'::text, 'quoted'::text, 'engaged'::text, 'stalled'::text, 'outreach'::text])) AND last_my_message_time < (now() - '14 days'::interval)))
  ORDER BY (
        CASE stage
            WHEN 'ready'::text THEN 1
            WHEN 'quoted'::text THEN 2
            WHEN 'engaged'::text THEN 3
            WHEN 'stalled'::text THEN 4
            WHEN 'outreach'::text THEN 5
            ELSE 9
        END), (
        CASE follow_up_priority
            WHEN 'high'::text THEN 1
            WHEN 'medium'::text THEN 2
            WHEN 'normal'::text THEN 3
            WHEN 'low'::text THEN 4
            ELSE 5
        END), (EXTRACT(day FROM now() - last_my_message_time)::integer) DESC NULLS LAST;

-- Step 6: Recreate today_followups_100_v2 view (verbatim from pg_get_viewdef)
CREATE VIEW today_followups_100_v2 AS
 SELECT id,
    project_key,
    customer_name,
    stage,
    status,
    last_customer_message_time,
    last_my_message_time,
    last_interaction_time,
    needs_follow_up,
    follow_up_priority,
    notes,
    updated_at,
    EXTRACT(day FROM now() - last_customer_message_time)::integer AS days_since_last_customer_message,
    EXTRACT(day FROM now() - last_my_message_time)::integer AS days_since_last_my_message,
    intent_score,
    last_followed_up_at,
    conversation_summary,
    summary_updated_at,
    follow_up_count,
    next_follow_up_at,
    follow_up_bucket,
    reactivation_bucket,
    reactivation_at,
    message_count,
        CASE stage
            WHEN 'ready'::text THEN 1
            WHEN 'quoted'::text THEN 2
            WHEN 'engaged'::text THEN 3
            WHEN 'stalled'::text THEN 4
            WHEN 'outreach'::text THEN 5
            ELSE 9
        END AS stage_priority_score
   FROM pipeline_state
  WHERE needs_follow_up = true AND (status <> ALL (ARRAY['closed_won'::text, 'closed_lost'::text])) AND (stage <> ALL (ARRAY['closed_won'::text, 'closed_lost'::text])) AND (follow_up_count IS NULL OR follow_up_count < 6) AND last_my_message_time IS NOT NULL AND (last_customer_message_time IS NULL OR last_customer_message_time < last_my_message_time) AND (next_follow_up_at IS NOT NULL AND next_follow_up_at <= now() OR next_follow_up_at IS NULL AND (stage = 'ready'::text AND last_my_message_time < (now() - '3 days'::interval) OR stage = 'quoted'::text AND last_my_message_time < (now() - '5 days'::interval) OR stage = 'engaged'::text AND last_my_message_time < (now() - '7 days'::interval) OR stage = 'stalled'::text AND last_my_message_time < (now() - '14 days'::interval) OR stage = 'outreach'::text AND last_my_message_time < (now() - '21 days'::interval) OR (stage <> ALL (ARRAY['ready'::text, 'quoted'::text, 'engaged'::text, 'stalled'::text, 'outreach'::text])) AND last_my_message_time < (now() - '14 days'::interval)))
  ORDER BY (
        CASE stage
            WHEN 'ready'::text THEN 1
            WHEN 'quoted'::text THEN 2
            WHEN 'engaged'::text THEN 3
            WHEN 'stalled'::text THEN 4
            WHEN 'outreach'::text THEN 5
            ELSE 9
        END), (
        CASE follow_up_priority
            WHEN 'high'::text THEN 1
            WHEN 'medium'::text THEN 2
            WHEN 'normal'::text THEN 3
            WHEN 'low'::text THEN 4
            ELSE 5
        END), (EXTRACT(day FROM now() - last_my_message_time)::integer) DESC NULLS LAST
 LIMIT 100;

-- Step 7: Recreate today_followups_100 view (wrapper around followup_candidates)
CREATE VIEW today_followups_100 AS
 SELECT id,
    project_key,
    customer_name,
    stage,
    status,
    last_customer_message_time,
    last_my_message_time,
    last_interaction_time,
    needs_follow_up,
    follow_up_priority,
    notes,
    updated_at,
    days_since_last_customer_message,
    days_since_last_my_message,
    intent_score,
    last_followed_up_at,
    conversation_summary,
    summary_updated_at,
    follow_up_count,
    next_follow_up_at,
    follow_up_bucket,
    reactivation_bucket,
    reactivation_at,
    message_count,
    stage_priority_score
   FROM followup_candidates
 LIMIT 100;

COMMIT;

-- NOTE: _backup_conversation_summary_20260420 is kept as insurance.
-- Drop it manually after 7 days (2026-04-27):
--   DROP TABLE IF EXISTS _backup_conversation_summary_20260420;
