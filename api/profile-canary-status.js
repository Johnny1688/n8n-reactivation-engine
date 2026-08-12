// Read-only, aggregate-only verification for a Customer Profile Generator
// canary. Never returns customer identity, message text, or profile strings.

const { validateProfile } = require('../nodes/profile_validator.js');
const { requireProfileAuth } = require('../src/profile/auth.js');

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,79}$/;

module.exports = async function (req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  }
  if (!requireProfileAuth(req, res)) return;

  const runId = String(req.query.run_id || '').trim();
  if (!RUN_ID_PATTERN.test(runId)) {
    return res.status(400).json({ error: 'Canary run id is invalid', code: 'invalid_canary_run_id' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('profile-canary-status: Supabase environment is not configured');
    return res.status(500).json({ error: 'Server misconfiguration', code: 'missing_env' });
  }
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Accept: 'application/json'
  };

  try {
    const url = `${supabaseUrl}/rest/v1/pipeline_state` +
      `?conversation_summary->extensions->canary_control->>run_id=eq.${encodeURIComponent(runId)}` +
      `&select=conversation_summary,summary_updated_at,last_interaction_time` +
      `&limit=3`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error('profile-canary-status: aggregate query failed, status:', response.status);
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) {
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }

    const slots = [];
    let validProfileCount = 0;
    let markerViolationCount = 0;
    let versionViolationCount = 0;
    let timestampViolationCount = 0;
    let rollbackReadyCount = 0;
    for (const row of rows) {
      const validated = validateProfile(row.conversation_summary);
      if (validated.valid) validProfileCount += 1;
      const profile = validated.profile || {};
      const control = profile.extensions?.canary_control;
      if (!control || control.run_id !== runId || ![1, 2].includes(control.slot)) {
        markerViolationCount += 1;
        continue;
      }
      slots.push(control.slot);
      if (profile.profile_version !== 1 || profile.generation_mode !== 'full') {
        versionViolationCount += 1;
      }
      const timestampsMatch = sameNullableInstant(row.summary_updated_at, control.written_at) &&
        sameNullableInstant(row.last_interaction_time, control.expected_last_interaction_time);
      if (!timestampsMatch) timestampViolationCount += 1;
      if (
        validated.valid &&
        control.prior_summary_state === 'missing_summary' &&
        control.prior_summary_updated_at === null &&
        timestampsMatch
      ) rollbackReadyCount += 1;
    }

    const distinctSlots = new Set(slots);
    const duplicateSlotCount = slots.length - distinctSlots.size;
    const pass = rows.length === 2 && distinctSlots.size === 2 &&
      distinctSlots.has(1) && distinctSlots.has(2) && duplicateSlotCount === 0 &&
      validProfileCount === 2 && markerViolationCount === 0 &&
      versionViolationCount === 0 && timestampViolationCount === 0 &&
      rollbackReadyCount === 2;

    return res.status(200).json({
      aggregate_schema: 'profile_generator_canary_db_v1',
      verdict: pass ? 'CANARY_DB_PASS' : 'CANARY_DB_HOLD',
      row_count: rows.length,
      distinct_slot_count: distinctSlots.size,
      duplicate_slot_count: duplicateSlotCount,
      valid_profile_count: validProfileCount,
      marker_violation_count: markerViolationCount,
      version_violation_count: versionViolationCount,
      timestamp_violation_count: timestampViolationCount,
      rollback_ready_count: rollbackReadyCount
    });
  } catch {
    console.error('profile-canary-status: unexpected failure');
    return res.status(500).json({ error: 'Canary aggregate failed', code: 'db_error' });
  }
};

function normalizeNullableIso(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function sameNullableInstant(left, right) {
  const normalizedLeft = normalizeNullableIso(left);
  const normalizedRight = normalizeNullableIso(right);
  return normalizedLeft !== undefined && normalizedRight !== undefined && normalizedLeft === normalizedRight;
}
