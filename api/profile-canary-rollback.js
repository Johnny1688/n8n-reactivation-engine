// Explicit, authenticated rollback for the two-row missing-summary canary.
// This endpoint is never called by the workflow. An action-time approval is
// required before invocation. It restores only the server-proven null prestate.

const { validateProfile } = require('../nodes/profile_validator.js');
const { requireProfileAuth } = require('../src/profile/auth.js');

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,79}$/;

module.exports = async function (req, res) {
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

function buildNullableFilter(column, value) {
  return value == null
    ? `&${column}=is.null`
    : `&${column}=eq.${encodeURIComponent(value)}`;
}
