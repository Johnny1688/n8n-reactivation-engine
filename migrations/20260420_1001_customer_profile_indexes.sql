-- Migration: Add GIN indexes for Customer Profile queries
-- Date: 2026-04-20
-- Author: Johnny
-- Context: Customer Profile subsystem (docs/customer_profile_system.md §2)
--          requires 5 indexes on pipeline_state.conversation_summary (JSONB)
--          to support downstream SQL filtering and weekly report aggregation.
--
-- Prerequisite: conversation_summary must already be JSONB.
--   Run 20260420_1000_convert_conversation_summary_to_jsonb.sql first.
--
-- Index purposes:
--   1. idx_profile_value_tier       — filter/sort by customer value tier (A/B/C)
--                                     for weekly report "top opportunities" query
--   2. idx_profile_decision_horizon — filter by buying timeline for urgency ranking
--   3. idx_profile_country          — geographic segmentation and regional reporting
--   4. idx_profile_sample_status    — find all customers with active sample requests
--   5. idx_profile_has_return_history — safety gate: identify customers with
--                                       return/exchange history for activation skip logic
--
-- Lock impact:
--   CREATE INDEX (without CONCURRENTLY) takes a SHARE lock — blocks writes,
--   allows reads. On ~681 rows this completes in milliseconds.
--   Using IF NOT EXISTS for idempotent re-runs.

CREATE INDEX IF NOT EXISTS idx_profile_value_tier
  ON pipeline_state ((conversation_summary->'intelligence'->>'value_tier'));

CREATE INDEX IF NOT EXISTS idx_profile_decision_horizon
  ON pipeline_state ((conversation_summary->'timeline'->>'decision_horizon'));

CREATE INDEX IF NOT EXISTS idx_profile_country
  ON pipeline_state ((conversation_summary->'identity'->>'country'));

CREATE INDEX IF NOT EXISTS idx_profile_sample_status
  ON pipeline_state ((conversation_summary->'intelligence'->>'sample_request_status'));

CREATE INDEX IF NOT EXISTS idx_profile_has_return_history
  ON pipeline_state ((conversation_summary->'intelligence'->'return_exchange_history'->>'has_history'));
