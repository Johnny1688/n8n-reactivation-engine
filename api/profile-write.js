// api/profile-write.js
// Validates an AI-generated customer profile and writes it to
// pipeline_state.conversation_summary via Supabase REST API (PATCH).
// Uses Node 18+ built-in fetch — no npm dependencies beyond ajv (from profile_validator).

const { validateProfile } = require('../nodes/profile_validator.js');
const { requireProfileAuth } = require('../src/profile/auth.js');

module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  }
  if (!requireProfileAuth(req, res)) return;

  // ── Parse body ────────────────────────────────────────────
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Request body is not valid JSON', code: 'invalid_json' });
  }

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Request body is not valid JSON', code: 'invalid_json' });
  }

  // ── Parameter validation ──────────────────────────────────
  const projectKey = (body.project_key || '').toString().trim();
  if (!projectKey) {
    return res.status(400).json({ error: 'project_key is required', code: 'missing_project_key' });
  }

  const profile = body.profile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return res.status(400).json({ error: 'profile is required and must be an object', code: 'missing_profile' });
  }

  // ── Schema + business-rule validation ─────────────────────
  const result = validateProfile(profile);
  if (!result.valid) {
    return res.status(400).json({
      error: 'Profile validation failed',
      code: 'invalid_profile',
      details: result.errors
    });
  }

  const requiredExpectations = [
    'expected_summary_updated_at',
    'expected_last_interaction_time',
    'expected_generation_mode',
    'expected_profile_version',
    'expected_source_message_count'
  ];
  if (requiredExpectations.some(key => !Object.prototype.hasOwnProperty.call(body, key))) {
    return res.status(400).json({ error: 'Write expectations are required', code: 'missing_write_expectation' });
  }

  const expectedSummaryUpdatedAt = normalizeNullableIso(body.expected_summary_updated_at);
  const expectedLastInteractionTime = normalizeNullableIso(body.expected_last_interaction_time);
  if (expectedSummaryUpdatedAt === undefined || expectedLastInteractionTime === undefined) {
    return res.status(400).json({ error: 'Write expectation timestamp is invalid', code: 'invalid_write_expectation' });
  }

  if (
    result.profile.generation_mode !== body.expected_generation_mode ||
    result.profile.profile_version !== body.expected_profile_version ||
    result.profile.source_message_count !== body.expected_source_message_count
  ) {
    return res.status(409).json({ error: 'Generated profile does not match source expectations', code: 'profile_expectation_mismatch' });
  }

  // ── Supabase config ───────────────────────────────────────
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('profile-write: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(500).json({ error: 'Server misconfiguration', code: 'missing_env' });
  }

  const supabaseHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  try {
    // ── Verify customer exists ──────────────────────────────
    const checkUrl = `${SUPABASE_URL}/rest/v1/pipeline_state` +
      `?project_key=eq.${encodeURIComponent(projectKey)}` +
      `&select=project_key,summary_updated_at,last_interaction_time` +
      `&limit=2`;

    const checkRes = await fetch(checkUrl, { headers: supabaseHeaders });
    if (!checkRes.ok) {
      console.error('profile-write: pipeline_state check failed, status:', checkRes.status);
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }

    const checkRows = await checkRes.json();
    if (checkRows.length === 0) {
      return res.status(404).json({
        error: 'Customer not found',
        code: 'customer_not_found'
      });
    }
    if (checkRows.length !== 1) {
      return res.status(500).json({ error: 'Customer identity is not unique', code: 'db_integrity_error' });
    }

    const current = checkRows[0];
    if (
      !sameNullableInstant(current.summary_updated_at, expectedSummaryUpdatedAt) ||
      !sameNullableInstant(current.last_interaction_time, expectedLastInteractionTime)
    ) {
      return res.status(409).json({ error: 'Customer context changed before write', code: 'stale_profile_context' });
    }

    // ── Write profile via PATCH ─────────────────────────────
    const now = new Date().toISOString();

    const patchUrl = `${SUPABASE_URL}/rest/v1/pipeline_state` +
      `?project_key=eq.${encodeURIComponent(projectKey)}` +
      buildNullableFilter('summary_updated_at', expectedSummaryUpdatedAt) +
      buildNullableFilter('last_interaction_time', expectedLastInteractionTime) +
      `&select=project_key,conversation_summary,summary_updated_at`;

    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        ...supabaseHeaders,
        'Prefer': 'return=representation,count=exact'
      },
      body: JSON.stringify({
        conversation_summary: result.profile,
        summary_updated_at: now
      })
    });

    if (!patchRes.ok) {
      console.error('profile-write: PATCH failed, status:', patchRes.status);
      return res.status(500).json({ error: 'Database write failed', code: 'db_error' });
    }

    const writtenRows = await patchRes.json();
    if (!Array.isArray(writtenRows) || writtenRows.length === 0) {
      return res.status(409).json({ error: 'Customer context changed before write', code: 'stale_profile_context' });
    }
    if (writtenRows.length !== 1) {
      return res.status(500).json({ error: 'Database write affected an unexpected row count', code: 'db_integrity_error' });
    }

    const writtenProfile = validateProfile(writtenRows[0].conversation_summary);
    if (
      !writtenProfile.valid ||
      writtenProfile.profile.profile_version !== result.profile.profile_version ||
      writtenProfile.profile.source_message_count !== result.profile.source_message_count ||
      !sameNullableInstant(writtenRows[0].summary_updated_at, now)
    ) {
      return res.status(500).json({ error: 'Database write verification failed', code: 'write_verification_failed' });
    }

    return res.status(200).json({
      written: true,
      profile_version: result.profile.profile_version,
      generation_mode: result.profile.generation_mode,
      summary_updated_at: now
    });

  } catch (err) {
    console.error('profile-write: unexpected failure');
    return res.status(500).json({
      error: 'Profile write failed',
      code: 'db_error'
    });
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
