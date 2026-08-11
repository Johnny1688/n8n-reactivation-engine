// api/profile-route.js
// Profile route decision endpoint.
// Reads pipeline_state via Supabase REST API and decides: full / incremental / skip.
// Uses Node 18+ built-in fetch — no npm dependencies required.

const { requireProfileAuth } = require('../src/profile/auth.js');

module.exports = async function (req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  }
  if (!requireProfileAuth(req, res)) return;

  const projectKey = (req.query.project_key || '').trim();
  if (!projectKey) {
    return res.status(400).json({ error: 'project_key is required', code: 'missing_project_key' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('profile-route: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(500).json({ error: 'Server misconfiguration', code: 'missing_env' });
  }

  const supabaseHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Accept': 'application/json'
  };

  try {
    // ── Step 2: query pipeline_state ──────────────────────────
    const psUrl = `${SUPABASE_URL}/rest/v1/pipeline_state` +
      `?project_key=eq.${encodeURIComponent(projectKey)}` +
      `&select=project_key,customer_name,stage,status,conversation_summary,summary_updated_at,message_count,last_interaction_time,last_customer_message_time` +
      `&limit=1`;

    const psRes = await fetch(psUrl, { headers: supabaseHeaders });
    if (!psRes.ok) {
      console.error('profile-route: pipeline_state query failed, status:', psRes.status);
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }

    const rows = await psRes.json();
    if (!rows.length) {
      return res.status(404).json({
        error: 'Customer not found',
        code: 'customer_not_found'
      });
    }

    const row = rows[0];
    const todayISO = new Date().toISOString();

    // ── Parse conversation_summary ────────────────────────────
    let summary = row.conversation_summary;
    let invalidProfile = false;

    // JSONB column → normally arrives as object.
    // Guard: if it arrives as string (legacy / edge case), try to parse.
    if (typeof summary === 'string') {
      try {
        summary = JSON.parse(summary);
      } catch {
        summary = null;
        invalidProfile = true;
      }
    }

    const hasProfile =
      summary != null &&
      typeof summary === 'object' &&
      !Array.isArray(summary) &&
      Object.keys(summary).length > 0;

    // If the raw value was non-null but we ended up with no usable profile,
    // and it wasn't already flagged by a parse error, check for empty string.
    if (
      !hasProfile &&
      !invalidProfile &&
      row.conversation_summary != null &&
      typeof row.conversation_summary === 'string' &&
      row.conversation_summary.trim().length > 0
    ) {
      invalidProfile = true;
    }

    const base = {
      project_key: row.project_key,
      customer_name: row.customer_name || '',
      current_stage: row.stage || '',
      message_count: row.message_count || 0,
      today_iso: todayISO,
      expected_summary_updated_at: row.summary_updated_at || null,
      expected_last_interaction_time: row.last_interaction_time || null
    };

    // ── Step 3: safety gate — open return / exchange case ─────
    if (hasProfile) {
      const cases = summary.intelligence?.return_exchange_history?.cases;
      if (
        Array.isArray(cases) &&
        cases.some(c => c.status === 'open' || c.status === 'disputed')
      ) {
        return res.status(200).json({
          ...base,
          decision: 'skip',
          reason: 'open_return_case',
          scope: 'none',
          existing_profile: summary,
          prior_profile_version: summary.schema_version ?? null,
          prior_source_message_count: summary.source_message_count ?? null
        });
      }
    }

    // ── Step 4a: no profile ───────────────────────────────────
    if (!hasProfile) {
      return res.status(200).json({
        ...base,
        decision: 'full',
        reason: invalidProfile ? 'invalid_existing_profile' : 'no_profile',
        scope: 'all',
        existing_profile: null,
        prior_profile_version: null,
        prior_source_message_count: null
      });
    }

    // From here hasProfile === true
    const profileVersion = summary.profile_version ?? 0;
    const sourceMessageCount = summary.source_message_count ?? 0;
    const summaryUpdatedAt = row.summary_updated_at;

    // ── Step 4b: version cap ──────────────────────────────────
    if (profileVersion >= 10) {
      return res.status(200).json({
        ...base,
        decision: 'full',
        reason: 'profile_version_cap',
        scope: 'all',
        existing_profile: null,
        prior_profile_version: profileVersion,
        prior_source_message_count: sourceMessageCount
      });
    }

    // ── Step 4c: missing, invalid, or stale summary clock ──────
    if (!summaryUpdatedAt) {
      return res.status(200).json({
        ...base,
        decision: 'full',
        reason: 'missing_summary_timestamp',
        scope: 'all',
        existing_profile: null,
        prior_profile_version: profileVersion,
        prior_source_message_count: sourceMessageCount
      });
    }

    const summaryTime = new Date(summaryUpdatedAt);
    if (Number.isNaN(summaryTime.getTime())) {
      return res.status(200).json({
        ...base,
        decision: 'full',
        reason: 'invalid_summary_timestamp',
        scope: 'all',
        existing_profile: null,
        prior_profile_version: profileVersion,
        prior_source_message_count: sourceMessageCount
      });
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (summaryTime < thirtyDaysAgo) {
      return res.status(200).json({
        ...base,
        decision: 'full',
        reason: 'stale_30_days',
        scope: 'all',
        existing_profile: null,
        prior_profile_version: profileVersion,
        prior_source_message_count: sourceMessageCount
      });
    }

    // ── Step 4d: new interactions since last update ───────────
    if (row.last_interaction_time && Number.isNaN(new Date(row.last_interaction_time).getTime())) {
      return res.status(200).json({
        ...base,
        decision: 'full',
        reason: 'invalid_last_interaction_time',
        scope: 'all',
        existing_profile: null,
        prior_profile_version: profileVersion,
        prior_source_message_count: sourceMessageCount
      });
    }

    if (
      row.last_interaction_time &&
      new Date(row.last_interaction_time) > new Date(summaryUpdatedAt)
    ) {
      // Count new messages via Supabase REST (HEAD + Prefer: count=exact)
      const msgUrl = `${SUPABASE_URL}/rest/v1/messages` +
        `?project_key=eq.${encodeURIComponent(projectKey)}` +
        `&message_time=gt.${encodeURIComponent(summaryUpdatedAt)}` +
        `&select=id`;

      const msgRes = await fetch(msgUrl, {
        method: 'HEAD',
        headers: { ...supabaseHeaders, 'Prefer': 'count=exact' }
      });

      if (!msgRes.ok) {
        console.error('profile-route: messages count error, status:', msgRes.status);
        return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
      }

      const range = msgRes.headers.get('content-range');
      const countMatch = range && range.match(/\/(\d+)$/);
      if (!countMatch) {
        console.error('profile-route: messages count header missing');
        return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
      }
      const newMessages = parseInt(countMatch[1], 10);

      if (newMessages >= 3) {
        return res.status(200).json({
          ...base,
          decision: 'incremental',
          reason: 'enough_new_messages',
          scope: 'since',
          since_iso: summaryUpdatedAt,
          existing_profile: summary,
          prior_profile_version: profileVersion,
          prior_source_message_count: sourceMessageCount
        });
      }

      // < 3 new messages
      return res.status(200).json({
        ...base,
        decision: 'skip',
        reason: 'fresh_enough',
        scope: 'none',
        existing_profile: summary,
        prior_profile_version: profileVersion,
        prior_source_message_count: sourceMessageCount
      });
    }

    // ── Step 4e: default — fresh enough ───────────────────────
    return res.status(200).json({
      ...base,
      decision: 'skip',
      reason: 'fresh_enough',
      scope: 'none',
      existing_profile: summary,
      prior_profile_version: profileVersion,
      prior_source_message_count: sourceMessageCount
    });

  } catch (err) {
    console.error('profile-route: unexpected failure');
    return res.status(500).json({
      error: 'Profile route failed',
      code: 'db_error'
    });
  }
};
