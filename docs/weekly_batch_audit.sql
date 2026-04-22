-- ================================================
-- Weekly Batch Audit — run after each batch to verify system health
-- 
-- Usage: replace 'YYYY-MM-DD' with the batch_date to audit.
-- First run: 2026-04-27 (first batch after snooze + name-fix deployment)
-- ================================================

-- Parameter (manually edit this row before running)
-- 2026-04-27

-- ================================================
-- A. Name bug fix verification
-- ================================================
-- Target after 2026-04-22 fix: zero 'Still broken' rows
-- 'Cleaned' = cleanCustomerName() worked and wrote a real name
-- 'Empty (phone fallback)' = customer is a raw phone number, correctly returns ''
SELECT 
  CASE 
    WHEN customer_name_clean = project_key THEN '❌ Still broken'
    WHEN customer_name_clean = '' THEN '✅ Empty (phone fallback)'
    WHEN customer_name_clean ~ '[\u4e00-\u9fff]' THEN '⚠️ Still has Chinese'
    WHEN customer_name_clean LIKE '+%' THEN '⚠️ Raw phone'
    ELSE '✅ Cleaned'
  END AS status,
  COUNT(*) AS cnt
FROM activation_messages
WHERE batch_date = '2026-04-27'
GROUP BY status
ORDER BY cnt DESC;

-- ================================================
-- B. Snooze verification — any snoozed customer in batch?
-- ================================================
-- Target: 0 rows. If any rows returned, the view filter is broken
-- OR a newly snoozed customer was set after the batch ran.
SELECT a.project_key, a.customer_name_clean, a.batch_date, 
       p.snoozed_until, p.stage
FROM activation_messages a
JOIN pipeline_state p ON p.project_key = a.project_key
WHERE a.batch_date = '2026-04-27'
  AND p.snoozed_until IS NOT NULL
  AND p.snoozed_until > a.created_at;

-- ================================================
-- C. Batch completeness
-- ================================================
-- Target: cnt = unique_customers (no duplicate project_keys in a batch)
-- Expected cnt: 50 (if LIMIT 50 in cron config)
SELECT 
  batch_date,
  COUNT(*) AS cnt, 
  COUNT(DISTINCT project_key) AS unique_customers,
  MIN(created_at) AS first_at, 
  MAX(created_at) AS last_at,
  EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))/60 AS duration_minutes
FROM activation_messages
WHERE batch_date = '2026-04-27'
GROUP BY batch_date;

-- ================================================
-- D. Pool health after batch
-- ================================================
-- Compare to baseline snapshot in ops/pool_snapshot_*.md
-- Expected: pool_total decreases by ~batch_size, +/- cooldown expirations
SELECT 
  'pool_total' AS metric, 
  COUNT(*)::text AS value
FROM followup_candidates
UNION ALL
SELECT 'snoozed_count', COUNT(*)::text
FROM pipeline_state
WHERE snoozed_until IS NOT NULL AND snoozed_until > NOW()
UNION ALL
SELECT 'pipeline_total', COUNT(*)::text
FROM pipeline_state
WHERE status NOT IN ('closed_won', 'closed_lost', 'migrated_to_group')
UNION ALL
SELECT 
  'stage_' || stage, COUNT(*)::text
FROM followup_candidates
GROUP BY stage
ORDER BY metric;

-- ================================================
-- E. Message quality distribution (SEND / EDIT / SKIP-style)
-- ================================================
-- Proxy: empty ai_message = SKIP; banned_phrase_flagged = quality issue
SELECT 
  CASE
    WHEN ai_message IS NULL OR ai_message = '' THEN 'SKIP (empty)'
    WHEN banned_phrase_flagged THEN 'BANNED PHRASE'
    WHEN LENGTH(ai_message) < 50 THEN 'WARN (too short)'
    WHEN LENGTH(ai_message) > 200 THEN 'WARN (too long)'
    ELSE 'OK'
  END AS quality_bucket,
  COUNT(*) AS cnt,
  ROUND(AVG(LENGTH(ai_message))::numeric, 1) AS avg_chars
FROM activation_messages
WHERE batch_date = '2026-04-27'
GROUP BY quality_bucket
ORDER BY cnt DESC;

-- ================================================
-- F. Post-batch Plugin sync check (run after Johnny sends on WhatsApp)
-- ================================================
-- Target after manual sending: high % SYNCED + PS UPDATED
-- Any ❌ NOT SYNCED + ❌ PS STALE indicates either Johnny didn't send
-- OR Plugin failed to sync those specific conversations.
SELECT 
  a.project_key,
  a.created_at AS batch_generated_at,
  (SELECT MAX(m.message_time) 
   FROM messages m 
   WHERE m.project_key = a.project_key 
     AND m.role = 'me'
     AND m.message_time > a.created_at) AS latest_synced_my_msg,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM messages m 
      WHERE m.project_key = a.project_key 
        AND m.role = 'me'
        AND m.message_time > a.created_at
    ) THEN '✅ SYNCED'
    ELSE '❌ NOT SYNCED'
  END AS sync_status,
  p.last_my_message_time AS ps_last_my_msg_time,
  CASE 
    WHEN p.last_my_message_time > a.created_at THEN '✅ PS UPDATED'
    ELSE '❌ PS STALE'
  END AS pipeline_state_status
FROM activation_messages a
LEFT JOIN pipeline_state p ON p.project_key = a.project_key
WHERE a.batch_date = '2026-04-27'
ORDER BY sync_status, pipeline_state_status, a.project_key;
