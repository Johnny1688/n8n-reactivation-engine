// api/customer-messages.js
// Fetches messages for a customer from public.messages via Supabase REST API.
// Returns formatted text ready for AI prompt injection.
// Uses Node 18+ built-in fetch — no npm dependencies required.

const { requireProfileAuth } = require('../src/profile/auth.js');

const MAX_MESSAGES = 1000;
const MAX_FORMATTED_CHARS = 60000;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,79}$/;

module.exports = async function (req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  }
  if (!requireProfileAuth(req, res)) return;

  const isCanaryPost = req.method === 'POST';
  let input = req.query || {};
  if (isCanaryPost) {
    try {
      input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ error: 'Request body is not valid JSON', code: 'invalid_json' });
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return res.status(400).json({ error: 'Request body is not valid JSON', code: 'invalid_json' });
    }
    const runId = String(input.canary_run_id || '').trim();
    const slot = Number(input.canary_slot);
    if (!RUN_ID_PATTERN.test(runId) || ![1, 2].includes(slot)) {
      return res.status(400).json({ error: 'Canary control is invalid', code: 'invalid_canary_control' });
    }
  }

  // ── Parameter validation ──────────────────────────────────
  const projectKey = String(input.project_key || '').trim();
  if (!projectKey) {
    return res.status(400).json({ error: 'project_key is required', code: 'missing_project_key' });
  }

  const scope = String(input.scope || '').trim().toLowerCase();
  if (!scope) {
    return res.status(400).json({ error: 'scope is required', code: 'missing_scope' });
  }
  if (scope !== 'all' && scope !== 'since') {
    return res.status(400).json({ error: 'scope must be "all" or "since"', code: 'invalid_scope' });
  }

  let sinceIso = String(input.since_iso || '').trim();
  if (scope === 'since') {
    if (!sinceIso) {
      return res.status(400).json({ error: 'since_iso is required when scope=since', code: 'missing_since_iso' });
    }
    const d = new Date(sinceIso);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ error: 'since_iso is not a valid ISO date', code: 'invalid_since_iso' });
    }
    sinceIso = d.toISOString();
  }
  const sendOk = payload => res.status(200).json(
    isCanaryPost ? { message_response: payload } : payload
  );

  // ── Supabase config ───────────────────────────────────────
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('customer-messages: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return res.status(500).json({ error: 'Server misconfiguration', code: 'missing_env' });
  }

  const supabaseHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Accept': 'application/json'
  };

  try {
    // ── Verify customer exists in pipeline_state ────────────
    const psUrl = `${SUPABASE_URL}/rest/v1/pipeline_state` +
      `?project_key=eq.${encodeURIComponent(projectKey)}` +
      `&select=project_key` +
      `&limit=1`;

    const psRes = await fetch(psUrl, { headers: supabaseHeaders });
    if (!psRes.ok) {
      console.error('customer-messages: pipeline_state check failed, status:', psRes.status);
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }

    const psRows = await psRes.json();
    if (!psRows.length) {
      return res.status(404).json({
        error: 'Customer not found',
        code: 'customer_not_found'
      });
    }

    // ── Count and bound messages before fetching raw text ───
    let msgUrl = `${SUPABASE_URL}/rest/v1/messages` +
      `?project_key=eq.${encodeURIComponent(projectKey)}` +
      `&select=role,message,message_time` +
      `&order=message_time.asc.nullslast,created_at.asc` +
      `&limit=${MAX_MESSAGES}`;

    if (scope === 'since') {
      msgUrl += `&message_time=gt.${encodeURIComponent(sinceIso)}`;
    }

    let countUrl = `${SUPABASE_URL}/rest/v1/messages` +
      `?project_key=eq.${encodeURIComponent(projectKey)}` +
      `&select=id`;
    if (scope === 'since') {
      countUrl += `&message_time=gt.${encodeURIComponent(sinceIso)}`;
    }

    const countRes = await fetch(countUrl, {
      method: 'HEAD',
      headers: { ...supabaseHeaders, 'Prefer': 'count=exact' }
    });
    if (!countRes.ok) {
      console.error('customer-messages: messages count failed, status:', countRes.status);
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }

    const range = countRes.headers.get('content-range');
    const countMatch = range && range.match(/\/(\d+)$/);
    if (!countMatch) {
      console.error('customer-messages: messages count header missing');
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }

    const exactCount = parseInt(countMatch[1], 10);
    if (exactCount > MAX_MESSAGES) {
      return res.status(422).json({
        error: 'Message history exceeds the safe profile limit',
        code: 'history_too_large',
        message_count: exactCount,
        max_messages: MAX_MESSAGES
      });
    }

    const msgRes = await fetch(msgUrl, { headers: supabaseHeaders });
    if (!msgRes.ok) {
      console.error('customer-messages: messages query failed, status:', msgRes.status);
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }

    const messages = await msgRes.json();

    // ── Format ──────────────────────────────────────────────
    if (!messages.length) {
      return sendOk({
        project_key: projectKey,
        scope,
        message_count: 0,
        role_counts: { customer: 0, me: 0, other: 0 },
        formatted_chars: 0,
        earliest_message_at: null,
        latest_message_at: null,
        formatted_messages: ''
      });
    }

    const roleCounts = { customer: 0, me: 0, other: 0 };
    const lines = messages.map(m => {
      const ts = formatTimestamp(m.message_time);
      const direction = mapDirection(m.role);
      roleCounts[direction === 'inbound' ? 'customer' : direction === 'outbound' ? 'me' : 'other'] += 1;
      const text = m.message || '';
      return `${ts} | ${direction} | ${text}`;
    });

    const formattedMessages = lines.join('\n');
    if (formattedMessages.length > MAX_FORMATTED_CHARS) {
      return res.status(422).json({
        error: 'Message history exceeds the safe prompt limit',
        code: 'history_too_large',
        message_count: messages.length,
        formatted_chars: formattedMessages.length,
        max_formatted_chars: MAX_FORMATTED_CHARS
      });
    }

    return sendOk({
      project_key: projectKey,
      scope,
      message_count: messages.length,
      role_counts: roleCounts,
      formatted_chars: formattedMessages.length,
      earliest_message_at: messages[0].message_time || null,
      latest_message_at: messages[messages.length - 1].message_time || null,
      formatted_messages: formattedMessages
    });

  } catch (err) {
    console.error('customer-messages: unexpected failure');
    return res.status(500).json({
      error: 'Customer message fetch failed',
      code: 'db_error'
    });
  }
};

function formatTimestamp(iso) {
  if (!iso) return '????-??-?? ??:??';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '????-??-?? ??:??';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function mapDirection(role) {
  if (role === 'customer') return 'inbound';
  if (role === 'me' || role === 'assistant' || role === 'agent') return 'outbound';
  return 'other';
}
