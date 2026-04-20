-- Baseline: Existing views on pipeline_state (archive record)
-- Date: 2026-04-20
-- Author: Johnny
-- Context: This file records the verbatim view definitions as they existed
--          in the database on 2026-04-20, extracted via pg_get_viewdef().
--          It serves as a version-controlled archive of DB view state.
--
-- Running this file is safe and idempotent (CREATE OR REPLACE).
-- Prerequisite: conversation_summary must already be JSONB. If still TEXT,
--   these statements will succeed but the column type in the view output
--   will reflect whatever the current column type is.
--
-- After running migration 20260420_1000 (TEXT→JSONB), re-run this file
--   to confirm views still resolve correctly.

-- ============================================================================
-- View 1: followup_candidates
-- ============================================================================
-- Purpose: Primary production view for Reactivation Engine.
--   Filters non-closed customers where I sent last, respects cooldown per
--   stage, caps follow_up_count < 6.
--   Orders by stage priority → follow_up_priority → days since last message.

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

-- ============================================================================
-- View 2: today_followups_100_v2
-- ============================================================================
-- Purpose: Backward-compat alias for followup_candidates with LIMIT 100.
--   Same logic as followup_candidates plus needs_follow_up = true filter.

CREATE OR REPLACE VIEW today_followups_100_v2 AS
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

-- ============================================================================
-- View 3: today_followups_100
-- ============================================================================
-- Purpose: Backward-compat wrapper around followup_candidates with LIMIT 100.
--   No additional filters — pure pass-through.

CREATE OR REPLACE VIEW today_followups_100 AS
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
