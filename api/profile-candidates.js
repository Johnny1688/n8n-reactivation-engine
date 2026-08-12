// Returns a small, internal-only list of customers whose persisted profile
// is missing, stale, or behind the latest interaction.

const { requireProfileAuth } = require('../src/profile/auth.js');

const MAX_LIMIT = 50;
const SCAN_LIMIT = 1000;
const MAX_SELECTION_HOLDS = 3;
const CLOSED_STAGES = new Set(['closed_won', 'closed_lost']);
const CANARY_MODE = 'canary_missing_only';
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,79}$/;

module.exports = async function (req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  }
  if (!requireProfileAuth(req, res)) return;

  const requestedLimit = Number.parseInt(req.query.limit || '2', 10);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_LIMIT) {
    return res.status(400).json({ error: `limit must be between 1 and ${MAX_LIMIT}`, code: 'invalid_limit' });
  }

  const mode = String(req.query.mode || '').trim();
  const runId = String(req.query.run_id || '').trim();
  if (mode && mode !== CANARY_MODE) {
    return res.status(400).json({ error: 'Unsupported candidate mode', code: 'invalid_mode' });
  }
  if (mode === CANARY_MODE && (requestedLimit !== 2 || !RUN_ID_PATTERN.test(runId))) {
    return res.status(400).json({ error: 'Canary request is invalid', code: 'invalid_canary_request' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('profile-candidates: Supabase environment is not configured');
    return res.status(500).json({ error: 'Server misconfiguration', code: 'missing_env' });
  }

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Accept: 'application/json'
  };
  const url = `${SUPABASE_URL}/rest/v1/pipeline_state` +
    `?select=project_key,customer_name,stage,status,follow_up_priority,conversation_summary,summary_updated_at,message_count,last_interaction_time` +
    `&order=last_interaction_time.desc.nullslast` +
    `&limit=${SCAN_LIMIT}`;

  try {
    if (mode === CANARY_MODE) {
      // A fixed canary run id is at-most-once for candidate data egress. Once
      // any row carries the server-owned marker, another candidate load fails
      // closed before new customer histories can be fetched.
      const markerUrl = `${SUPABASE_URL}/rest/v1/pipeline_state` +
        `?conversation_summary->extensions->canary_control->>run_id=eq.${encodeURIComponent(runId)}` +
        `&select=project_key` +
        `&limit=1`;
      const markerResponse = await fetch(markerUrl, { headers });
      if (!markerResponse.ok) {
        console.error('profile-candidates: canary marker query failed, status:', markerResponse.status);
        return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
      }
      const markerRows = await markerResponse.json();
      if (Array.isArray(markerRows) && markerRows.length > 0) {
        return res.status(409).json({ error: 'Canary run is already consumed', code: 'canary_run_already_consumed' });
      }
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error('profile-candidates: pipeline_state query failed, status:', response.status);
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }

    const rows = await response.json();
    const ranked = rows
      .filter(row => !CLOSED_STAGES.has(String(row.stage || '').toLowerCase()))
      .map(row => ({ ...row, profile_reason: profileReason(row) }))
      .filter(row => row.profile_reason)
      .filter(row => mode !== CANARY_MODE || row.profile_reason === 'missing_profile')
      .sort((left, right) => candidateScore(right) - candidateScore(left));

    // pipeline_state.message_count is a rollup and may be stale. Verify the
    // canonical messages table before returning a candidate instead of using
    // that rollup as a selection gate.
    const candidates = [];
    const seen = new Set();
    let selectionHoldCount = 0;
    let selectionCheckedCount = 0;
    for (const row of ranked) {
      const projectKey = String(row.project_key || '').trim();
      if (!projectKey || seen.has(projectKey)) continue;
      seen.add(projectKey);

      const countUrl = `${SUPABASE_URL}/rest/v1/messages` +
        `?project_key=eq.${encodeURIComponent(projectKey)}` +
        `&select=id`;
      const countResponse = await fetch(countUrl, {
        method: 'HEAD',
        headers: { ...headers, Prefer: 'count=exact' }
      });
      selectionCheckedCount += 1;
      if (!countResponse.ok) {
        console.error('profile-candidates: message count failed, status:', countResponse.status);
        selectionHoldCount += 1;
        if (selectionHoldCount >= MAX_SELECTION_HOLDS) {
          return res.status(500).json({ error: 'Candidate selection error ceiling reached', code: 'selection_error_ceiling' });
        }
        continue;
      }
      const range = countResponse.headers.get('content-range');
      const match = range && range.match(/\/(\d+)$/);
      if (!match) {
        console.error('profile-candidates: message count header missing');
        selectionHoldCount += 1;
        if (selectionHoldCount >= MAX_SELECTION_HOLDS) {
          return res.status(500).json({ error: 'Candidate selection error ceiling reached', code: 'selection_error_ceiling' });
        }
        continue;
      }
      const actualMessageCount = Number.parseInt(match[1], 10);
      if (actualMessageCount === 0) continue;

      candidates.push({
        project_key: row.project_key,
        customer_name: row.customer_name || '',
        stage: row.stage || '',
        status: row.status || '',
        profile_reason: row.profile_reason,
        actual_message_count: actualMessageCount
      });
      if (candidates.length === requestedLimit) break;
    }

    return res.status(200).json({
      requested_limit: requestedLimit,
      mode: mode || 'standard',
      candidate_count: candidates.length,
      selection_checked_count: selectionCheckedCount,
      selection_hold_count: selectionHoldCount,
      candidates
    });
  } catch (error) {
    console.error('profile-candidates: request failed');
    return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
  }
};

function profileReason(row) {
  const summary = parseSummary(row.conversation_summary);
  if (!summary) return 'missing_profile';
  if (!row.summary_updated_at) return 'missing_summary_timestamp';

  const summaryTime = new Date(row.summary_updated_at);
  if (Number.isNaN(summaryTime.getTime())) return 'invalid_summary_timestamp';
  if (Date.now() - summaryTime.getTime() > 30 * 24 * 60 * 60 * 1000) return 'stale_30_days';
  if ((summary.profile_version || 0) >= 10) return 'profile_version_cap';

  const interactionTime = row.last_interaction_time ? new Date(row.last_interaction_time) : null;
  if (interactionTime && !Number.isNaN(interactionTime.getTime()) && interactionTime > summaryTime) {
    return 'new_interactions';
  }
  return null;
}

function candidateScore(row) {
  const reasonScore = {
    missing_profile: 50,
    missing_summary_timestamp: 40,
    invalid_summary_timestamp: 40,
    stale_30_days: 30,
    profile_version_cap: 20,
    new_interactions: 10
  }[row.profile_reason] || 0;
  const stageScore = {
    ready: 6,
    quoted: 5,
    engaged: 4,
    stalled: 3,
    outreach: 2,
    new: 1
  }[String(row.stage || '').toLowerCase()] || 0;
  const priorityScore = { high: 3, medium: 2, normal: 1, low: 0 }
    [String(row.follow_up_priority || '').toLowerCase()] || 0;
  return reasonScore * 100 + stageScore * 10 + priorityScore;
}

function parseSummary(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length
    ? value
    : null;
}

module.exports.profileReason = profileReason;
module.exports.candidateScore = candidateScore;
