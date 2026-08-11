// Returns a small, internal-only list of customers whose persisted profile
// is missing, stale, or behind the latest interaction.

const { requireProfileAuth } = require('../src/profile/auth.js');

const MAX_LIMIT = 10;
const SCAN_LIMIT = 1000;
const CLOSED_STAGES = new Set(['closed_won', 'closed_lost']);

module.exports = async function (req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  }
  if (!requireProfileAuth(req, res)) return;

  const requestedLimit = Number.parseInt(req.query.limit || '2', 10);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_LIMIT) {
    return res.status(400).json({ error: `limit must be between 1 and ${MAX_LIMIT}`, code: 'invalid_limit' });
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
    `&message_count=gt.0` +
    `&order=last_interaction_time.desc.nullslast` +
    `&limit=${SCAN_LIMIT}`;

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error('profile-candidates: pipeline_state query failed, status:', response.status);
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }

    const rows = await response.json();
    const candidates = rows
      .filter(row => !CLOSED_STAGES.has(String(row.stage || '').toLowerCase()))
      .map(row => ({ ...row, profile_reason: profileReason(row) }))
      .filter(row => row.profile_reason)
      .sort((left, right) => candidateScore(right) - candidateScore(left))
      .slice(0, requestedLimit)
      .map(row => ({
        project_key: row.project_key,
        customer_name: row.customer_name || '',
        stage: row.stage || '',
        status: row.status || '',
        profile_reason: row.profile_reason
      }));

    return res.status(200).json({
      requested_limit: requestedLimit,
      candidate_count: candidates.length,
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
