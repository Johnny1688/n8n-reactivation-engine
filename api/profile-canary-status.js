// Consolidated Customer Profile Generator canary control function. The public
// status endpoint remains the default; Vercel rewrites the rollback endpoint
// with an internal action marker so both endpoint contracts stay isolated.

const { validateProfile } = require('../nodes/profile_validator.js');
const { requireProfileAuth } = require('../src/profile/auth.js');

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,79}$/;
const ROLLBACK_ACTION = 'rollback';

module.exports = async function profileCanaryControl(req, res) {
  const action = String(req.query?.__profile_canary_action || '').trim();
  if (!action) return handleStatus(req, res);
  if (action === ROLLBACK_ACTION) return handleRollback(req, res);
  return res.status(404).json({ error: 'Route not found', code: 'route_not_found' });
};

async function handleStatus(req, res) {
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
}

async function handleRollback(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  }
  if (!requireProfileAuth(req, res)) return;

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Request body is not valid JSON', code: 'invalid_json' });
  }

  const runId = String(body?.canary_run_id || '').trim();
  const slot = Number(body?.canary_slot);
  if (!RUN_ID_PATTERN.test(runId) || ![1, 2].includes(slot)) {
    return res.status(400).json({ error: 'Rollback target is invalid', code: 'invalid_rollback_target' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('profile-canary-rollback: Supabase environment is not configured');
    return res.status(500).json({ error: 'Server misconfiguration', code: 'missing_env' });
  }
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };

  try {
    const checkUrl = `${supabaseUrl}/rest/v1/pipeline_state` +
      `?conversation_summary->extensions->canary_control->>run_id=eq.${encodeURIComponent(runId)}` +
      `&conversation_summary->extensions->canary_control->>slot=eq.${slot}` +
      `&select=project_key,conversation_summary,summary_updated_at,last_interaction_time` +
      `&limit=2`;
    const checkRes = await fetch(checkUrl, { headers });
    if (!checkRes.ok) {
      console.error('profile-canary-rollback: preflight query failed, status:', checkRes.status);
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }
    const rows = await checkRes.json();
    if (!Array.isArray(rows) || rows.length !== 1) {
      return res.status(rows?.length === 0 ? 404 : 500).json({
        error: rows?.length === 0 ? 'Rollback target not found' : 'Rollback target is not unique',
        code: rows?.length === 0 ? 'rollback_target_not_found' : 'db_integrity_error'
      });
    }

    const current = rows[0];
    const projectKey = String(current.project_key || '').trim();
    const validated = validateProfile(current.conversation_summary);
    const control = validated.profile?.extensions?.canary_control;
    if (
      !validated.valid ||
      !projectKey ||
      validated.profile.generation_mode !== 'full' ||
      validated.profile.profile_version !== 1 ||
      !control ||
      control.run_id !== runId ||
      control.slot !== slot ||
      control.prior_summary_state !== 'missing_summary' ||
      control.prior_summary_updated_at !== null ||
      !sameNullableInstant(current.summary_updated_at, control.written_at) ||
      !sameNullableInstant(current.last_interaction_time, control.expected_last_interaction_time)
    ) {
      return res.status(409).json({ error: 'Rollback CAS precondition failed', code: 'rollback_context_conflict' });
    }

    const writtenAt = normalizeNullableIso(control.written_at);
    const expectedLastInteractionTime = normalizeNullableIso(control.expected_last_interaction_time);
    const patchUrl = `${supabaseUrl}/rest/v1/pipeline_state` +
      `?project_key=eq.${encodeURIComponent(projectKey)}` +
      buildNullableFilter('summary_updated_at', writtenAt) +
      buildNullableFilter('last_interaction_time', expectedLastInteractionTime) +
      `&conversation_summary->extensions->canary_control->>run_id=eq.${encodeURIComponent(runId)}` +
      `&conversation_summary->extensions->canary_control->>slot=eq.${slot}` +
      `&select=project_key,conversation_summary,summary_updated_at`;
    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation,count=exact' },
      body: JSON.stringify({ conversation_summary: null, summary_updated_at: null })
    });
    if (!patchRes.ok) {
      console.error('profile-canary-rollback: PATCH failed, status:', patchRes.status);
      return res.status(500).json({ error: 'Database rollback failed', code: 'db_error' });
    }
    const rolledBack = await patchRes.json();
    if (!Array.isArray(rolledBack) || rolledBack.length === 0) {
      return res.status(409).json({ error: 'Rollback CAS precondition failed', code: 'rollback_context_conflict' });
    }
    if (rolledBack.length !== 1) {
      return res.status(500).json({ error: 'Rollback affected an unexpected row count', code: 'db_integrity_error' });
    }
    if (rolledBack[0].conversation_summary !== null || rolledBack[0].summary_updated_at !== null) {
      return res.status(500).json({ error: 'Rollback verification failed', code: 'rollback_verification_failed' });
    }

    return res.status(200).json({ rolled_back: true, canary_slot: slot });
  } catch {
    console.error('profile-canary-rollback: unexpected failure');
    return res.status(500).json({ error: 'Profile rollback failed', code: 'db_error' });
  }
}

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

function buildNullableFilter(column, value) {
  return value == null
    ? `&${column}=is.null`
    : `&${column}=eq.${encodeURIComponent(value)}`;
}
