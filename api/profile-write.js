// api/profile-write.js
// Validates an AI-generated customer profile and writes it to
// pipeline_state.conversation_summary via Supabase REST API (PATCH).
// Uses Node 18+ built-in fetch — no npm dependencies beyond ajv (from profile_validator).

const { validateProfile } = require('../nodes/profile_validator.js');

module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  }

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
      `&select=project_key` +
      `&limit=1`;

    const checkRes = await fetch(checkUrl, { headers: supabaseHeaders });
    if (!checkRes.ok) {
      console.error('profile-write: pipeline_state check error:', await checkRes.text());
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }

    const checkRows = await checkRes.json();
    if (!checkRows.length) {
      return res.status(404).json({
        error: `Customer not found: ${projectKey}`,
        code: 'customer_not_found'
      });
    }

    // ── Write profile via PATCH ─────────────────────────────
    const now = new Date().toISOString();

    const patchUrl = `${SUPABASE_URL}/rest/v1/pipeline_state` +
      `?project_key=eq.${encodeURIComponent(projectKey)}`;

    const patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        ...supabaseHeaders,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        conversation_summary: result.profile,
        summary_updated_at: now
      })
    });

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      console.error('profile-write: PATCH error:', errText);
      return res.status(500).json({ error: 'Database write failed', code: 'db_error' });
    }

    return res.status(200).json({
      project_key: projectKey,
      written: true,
      profile_version: result.profile.profile_version,
      generation_mode: result.profile.generation_mode,
      summary_updated_at: now
    });

  } catch (err) {
    console.error('profile-write error:', err);
    return res.status(500).json({
      error: err.message || 'profile-write failed',
      code: 'db_error'
    });
  }
};
