// api/customer-messages.js
// Fetches messages for a customer from public.messages via Supabase REST API.
// Returns formatted text ready for AI prompt injection.
// Uses Node 18+ built-in fetch — no npm dependencies required.

module.exports = async function (req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'method_not_allowed' });
  }

  // ── Parameter validation ──────────────────────────────────
  const projectKey = (req.query.project_key || '').trim();
  if (!projectKey) {
    return res.status(400).json({ error: 'project_key is required', code: 'missing_project_key' });
  }

  const scope = (req.query.scope || '').trim().toLowerCase();
  if (!scope) {
    return res.status(400).json({ error: 'scope is required', code: 'missing_scope' });
  }
  if (scope !== 'all' && scope !== 'since') {
    return res.status(400).json({ error: 'scope must be "all" or "since"', code: 'invalid_scope' });
  }

  let sinceIso = (req.query.since_iso || '').trim();
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
      console.error('customer-messages: pipeline_state check error:', await psRes.text());
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }

    const psRows = await psRes.json();
    if (!psRows.length) {
      return res.status(404).json({
        error: `Customer not found: ${projectKey}`,
        code: 'customer_not_found'
      });
    }

    // ── Fetch messages ──────────────────────────────────────
    let msgUrl = `${SUPABASE_URL}/rest/v1/messages` +
      `?project_key=eq.${encodeURIComponent(projectKey)}` +
      `&select=role,message,message_time` +
      `&order=message_time.asc.nullslast,created_at.asc`;

    if (scope === 'since') {
      msgUrl += `&message_time=gt.${encodeURIComponent(sinceIso)}`;
    }

    const msgRes = await fetch(msgUrl, { headers: supabaseHeaders });
    if (!msgRes.ok) {
      console.error('customer-messages: messages query error:', await msgRes.text());
      return res.status(500).json({ error: 'Database query failed', code: 'db_error' });
    }

    const messages = await msgRes.json();

    // ── Format ──────────────────────────────────────────────
    if (!messages.length) {
      return res.status(200).json({
        project_key: projectKey,
        scope,
        message_count: 0,
        earliest_message_at: null,
        latest_message_at: null,
        formatted_messages: ''
      });
    }

    const lines = messages.map(m => {
      const ts = formatTimestamp(m.message_time);
      const direction = mapDirection(m.role);
      const text = m.message || '';
      return `${ts} | ${direction} | ${text}`;
    });

    return res.status(200).json({
      project_key: projectKey,
      scope,
      message_count: messages.length,
      earliest_message_at: messages[0].message_time || null,
      latest_message_at: messages[messages.length - 1].message_time || null,
      formatted_messages: lines.join('\n')
    });

  } catch (err) {
    console.error('customer-messages error:', err);
    return res.status(500).json({
      error: err.message || 'customer-messages failed',
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
