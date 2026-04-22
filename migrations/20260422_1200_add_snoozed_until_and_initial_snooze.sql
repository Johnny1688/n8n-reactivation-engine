-- ================================================
-- Migration: add snoozed_until mechanism to pipeline_state
-- Applied: 2026-04-22 via Supabase Dashboard
-- Purpose: allow individualized pause of customers from activation pool
-- ================================================

-- ------------------------------------------------
-- Step 1: Add column + partial index
-- ------------------------------------------------
ALTER TABLE pipeline_state 
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pipeline_state_snoozed_until 
  ON pipeline_state(snoozed_until) 
  WHERE snoozed_until IS NOT NULL;

COMMENT ON COLUMN pipeline_state.snoozed_until IS 
  'Manual pause for activation. Activation view must filter: WHERE snoozed_until IS NULL OR snoozed_until < NOW(). NULL = not snoozed.';

-- ------------------------------------------------
-- Step 2: Update followup_candidates view to filter snoozed customers
-- Only change: added line `AND (snoozed_until IS NULL OR snoozed_until < now())`
-- ------------------------------------------------
CREATE OR REPLACE VIEW followup_candidates AS
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
   FROM pipeline_state ps
  WHERE (status <> ALL (ARRAY['closed_won'::text, 'closed_lost'::text, 'migrated_to_group'::text]))
    AND (stage <> ALL (ARRAY['closed_won'::text, 'closed_lost'::text]))
    AND last_my_message_time IS NOT NULL
    AND (last_customer_message_time IS NULL OR last_customer_message_time < last_my_message_time)
    AND (follow_up_count IS NULL OR follow_up_count < 6)
    AND (snoozed_until IS NULL OR snoozed_until < now())    -- Added 2026-04-22
    AND (next_follow_up_at IS NOT NULL AND next_follow_up_at <= now()
         OR next_follow_up_at IS NULL AND (stage = 'ready'::text AND last_my_message_time < (now() - '3 days'::interval)
             OR stage = 'quoted'::text AND last_my_message_time < (now() - '5 days'::interval)
             OR stage = 'engaged'::text AND last_my_message_time < (now() - '7 days'::interval)
             OR stage = 'stalled'::text AND last_my_message_time < (now() - '14 days'::interval)
             OR stage = 'outreach'::text AND last_my_message_time < (now() - '21 days'::interval)
             OR (stage <> ALL (ARRAY['ready'::text, 'quoted'::text, 'engaged'::text, 'stalled'::text, 'outreach'::text])) AND last_my_message_time < (now() - '14 days'::interval)))
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

-- ------------------------------------------------
-- Step 3: Initial snooze for 5 customers (individualized dates)
-- ------------------------------------------------
UPDATE pipeline_state
SET snoozed_until = '2026-05-22 00:00:00+00',
    notes = COALESCE(notes || E'\n', '') 
            || '[2026-04-22] Snoozed until 2026-05-22. Customer silent 27 days after price answer (PR007 $1572). Already followed up 5x; give space to avoid over-outreach.',
    updated_at = NOW()
WHERE project_key = 'Krim加拿大6台（26.2.23日）';

UPDATE pipeline_state
SET snoozed_until = '2026-05-22 00:00:00+00',
    notes = COALESCE(notes || E'\n', '') 
            || '[2026-04-22] Snoozed until 2026-05-22. Customer explicitly said "waiting on few things as we are working on expansion, will let you know". Respect their signal.',
    updated_at = NOW()
WHERE project_key = 'HZ加拿大10台（26.3.9日）';

UPDATE pipeline_state
SET snoozed_until = '2026-08-01 00:00:00+00',
    notes = COALESCE(notes || E'\n', '') 
            || '[2026-04-22] Snoozed until 2026-08-01. Customer opens studio in October; shipping plan is late Aug/early Sept. Re-engage 2 months before opening.',
    updated_at = NOW()
WHERE project_key = 'Rocio美国10台AR011（26.3.16日）10月份左右开业';

UPDATE pipeline_state
SET snoozed_until = '2027-10-01 00:00:00+00',
    notes = COALESCE(notes || E'\n', '') 
            || '[2026-04-22] Snoozed until 2027-10-01. Customer: site not ready until 2028. Re-engage ~3 months before their expected ready date.',
    updated_at = NOW()
WHERE project_key = 'Victor美国（25.8.20日）2028年场地才弄好 Hsu';

UPDATE pipeline_state
SET snoozed_until = '2099-01-01 00:00:00+00',
    notes = COALESCE(notes || E'\n', '') 
            || '[2026-04-22] Effectively permanent exclusion. chat_id=null in contacts table, Plugin cannot sync outbound messages. Orphaned/corrupted data. Review and potentially hard-delete later.',
    updated_at = NOW()
WHERE project_key = '未知号码';
