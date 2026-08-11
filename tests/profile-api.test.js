const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.PROFILE_INTERNAL_API_TOKEN = 'synthetic-profile-token-00000000000000000000';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role';

const profileRoute = require('../api/profile-route.js');
const profileWrite = require('../api/profile-write.js');
const customerMessages = require('../api/customer-messages.js');
const profileCandidates = require('../api/profile-candidates.js');

const tests = [];
const originalFetch = global.fetch;

function test(name, fn) {
  tests.push({ name, fn });
}

function response(body, status = 200, headers = {}) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
    headers: { get(name) { return normalized.get(name.toLowerCase()) || null; } }
  };
}

function queueFetch(...entries) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    assert.ok(entries.length, `unexpected fetch: ${url}`);
    const next = entries.shift();
    return typeof next === 'function' ? next(String(url), options) : next;
  };
  return calls;
}

async function call(handler, { method = 'GET', query = {}, body, token = process.env.PROFILE_INTERNAL_API_TOKEN } = {}) {
  let statusCode = 200;
  let payload;
  const headers = {};
  const req = {
    method,
    query,
    body,
    headers: token == null ? {} : { 'x-profile-internal-token': token }
  };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
    setHeader(name, value) { headers[name.toLowerCase()] = value; }
  };
  await handler(req, res);
  return { statusCode, payload, headers };
}

function validProfile(overrides = {}) {
  return {
    schema_version: 1,
    profile_version: 1,
    generated_at: '2026-08-11T00:00:00.000Z',
    generation_mode: 'full',
    source_message_count: 2,
    identity: {
      customer_type: 'studio_owner', country: 'US', region: '', business_stage: 'exploring',
      decision_role: 'owner', language_preference: 'en'
    },
    commercial: {
      budget_tier: 'unknown', volume_signal: '1-9', target_models: [], material_preference: 'undecided',
      style_preference: [], shipping_term: 'unknown', pricing_sent: false, last_quote_ref: '', competitors_mentioned: []
    },
    timeline: { decision_horizon: 'unclear', urgency_signals: [], last_inbound_at: null, last_outbound_at: null },
    state: {
      current_stage: 'engaged', open_objections: [], verification_status: 'none',
      outstanding_asks: [], outstanding_asks_from_us: []
    },
    intelligence: {
      value_tier: 'C', win_probability: 0.2, key_risks: [], leverage_points: [],
      recommended_next_move: 'Confirm the current equipment project.', sample_request_status: 'none',
      return_exchange_history: { has_history: false, cases: [] }
    },
    narrative: 'Synthetic profile with no customer data.',
    key_quotes: [], extensions: {},
    ...overrides
  };
}

test('profile endpoints require the internal token and disable caching', async () => {
  const result = await call(profileRoute, { query: { project_key: 'PK-SYNTHETIC' }, token: null });
  assert.equal(result.statusCode, 401);
  assert.equal(result.payload.code, 'unauthorized');
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('route rebuilds a profile with a missing summary timestamp', async () => {
  queueFetch(response([{
    project_key: 'PK-SYNTHETIC', stage: 'engaged', conversation_summary: validProfile(),
    summary_updated_at: null, last_interaction_time: '2026-08-10T00:00:00.000Z', message_count: 2
  }]));
  const result = await call(profileRoute, { query: { project_key: 'PK-SYNTHETIC' } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.decision, 'full');
  assert.equal(result.payload.reason, 'missing_summary_timestamp');
});

test('route uses profile_version rather than schema_version for the cap', async () => {
  queueFetch(response([{
    project_key: 'PK-SYNTHETIC', stage: 'engaged', conversation_summary: validProfile({ profile_version: 10 }),
    summary_updated_at: new Date().toISOString(), last_interaction_time: null, message_count: 2
  }]));
  const result = await call(profileRoute, { query: { project_key: 'PK-SYNTHETIC' } });
  assert.equal(result.payload.reason, 'profile_version_cap');
  assert.equal(result.payload.prior_profile_version, 10);
});

test('route selects incremental when at least three new messages exist', async () => {
  const summaryUpdatedAt = '2026-08-01T00:00:00.000Z';
  const calls = queueFetch(
    response([{
      project_key: 'PK-SYNTHETIC', stage: 'engaged', conversation_summary: validProfile(),
      summary_updated_at: summaryUpdatedAt, last_interaction_time: '2026-08-02T00:00:00.000Z', message_count: 5
    }]),
    response(null, 200, { 'content-range': '0-2/3' })
  );
  const result = await call(profileRoute, { query: { project_key: 'PK-SYNTHETIC' } });
  assert.equal(result.payload.decision, 'incremental');
  assert.equal(result.payload.since_iso, summaryUpdatedAt);
  assert.equal(calls[1].options.method, 'HEAD');
});

test('route fails closed when exact count metadata is absent', async () => {
  queueFetch(
    response([{
      project_key: 'PK-SYNTHETIC', stage: 'engaged', conversation_summary: validProfile(),
      summary_updated_at: '2026-08-01T00:00:00.000Z', last_interaction_time: '2026-08-02T00:00:00.000Z'
    }]),
    response(null)
  );
  const result = await call(profileRoute, { query: { project_key: 'PK-SYNTHETIC' } });
  assert.equal(result.statusCode, 500);
  assert.equal(result.payload.code, 'db_error');
});

test('customer messages returns bounded role counts', async () => {
  queueFetch(
    response([{ project_key: 'PK-SYNTHETIC' }]),
    response(null, 200, { 'content-range': '0-1/2' }),
    response([
      { role: 'customer', message: 'Synthetic inbound.', message_time: '2026-08-01T00:00:00.000Z' },
      { role: 'me', message: 'Synthetic outbound.', message_time: '2026-08-02T00:00:00.000Z' }
    ])
  );
  const result = await call(customerMessages, { query: { project_key: 'PK-SYNTHETIC', scope: 'all' } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.role_counts, { customer: 1, me: 1, other: 0 });
  assert.equal(result.payload.message_count, 2);
});

test('customer messages blocks histories above the safe message limit', async () => {
  queueFetch(
    response([{ project_key: 'PK-SYNTHETIC' }]),
    response(null, 200, { 'content-range': '0-999/1001' })
  );
  const result = await call(customerMessages, { query: { project_key: 'PK-SYNTHETIC', scope: 'all' } });
  assert.equal(result.statusCode, 422);
  assert.equal(result.payload.code, 'history_too_large');
});

test('profile write rejects generated output that does not match expectations', async () => {
  const result = await call(profileWrite, {
    method: 'POST',
    body: {
      project_key: 'PK-SYNTHETIC', profile: validProfile(), expected_summary_updated_at: null,
      expected_last_interaction_time: null, expected_generation_mode: 'incremental',
      expected_profile_version: 1, expected_source_message_count: 2
    }
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.payload.code, 'profile_expectation_mismatch');
});

test('profile write uses context CAS and verifies one returned row', async () => {
  const calls = queueFetch(
    response([{ project_key: 'PK-SYNTHETIC', summary_updated_at: null, last_interaction_time: null }]),
    (url, options) => {
      const patch = JSON.parse(options.body);
      return response([{
        project_key: 'PK-SYNTHETIC', conversation_summary: patch.conversation_summary,
        summary_updated_at: patch.summary_updated_at
      }]);
    }
  );
  const result = await call(profileWrite, {
    method: 'POST',
    body: {
      project_key: 'PK-SYNTHETIC', profile: validProfile(), expected_summary_updated_at: null,
      expected_last_interaction_time: null, expected_generation_mode: 'full',
      expected_profile_version: 1, expected_source_message_count: 2
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.written, true);
  assert.match(calls[1].url, /summary_updated_at=is\.null/);
  assert.match(calls[1].url, /last_interaction_time=is\.null/);
});

test('profile write treats a zero-row CAS update as stale context', async () => {
  queueFetch(
    response([{ project_key: 'PK-SYNTHETIC', summary_updated_at: null, last_interaction_time: null }]),
    response([])
  );
  const result = await call(profileWrite, {
    method: 'POST',
    body: {
      project_key: 'PK-SYNTHETIC', profile: validProfile(), expected_summary_updated_at: null,
      expected_last_interaction_time: null, expected_generation_mode: 'full',
      expected_profile_version: 1, expected_source_message_count: 2
    }
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.payload.code, 'stale_profile_context');
});

test('candidate routing prioritizes missing profiles and quoted stages', () => {
  const missing = { profile_reason: 'missing_profile', stage: 'quoted', follow_up_priority: 'high' };
  const stale = { profile_reason: 'stale_30_days', stage: 'ready', follow_up_priority: 'high' };
  assert.ok(profileCandidates.candidateScore(missing) > profileCandidates.candidateScore(stale));
  assert.equal(profileCandidates.profileReason({ conversation_summary: null }), 'missing_profile');
});

test('candidate endpoint verifies canonical messages instead of stale rollup count', async () => {
  const calls = queueFetch(
    response([{
      project_key: 'PK-SYNTHETIC', customer_name: 'Synthetic', stage: 'quoted',
      status: 'open', follow_up_priority: 'high', conversation_summary: null,
      summary_updated_at: null, message_count: 0, last_interaction_time: '2026-08-10T00:00:00.000Z'
    }]),
    response(null, 200, { 'content-range': '0-2/3' })
  );
  const result = await call(profileCandidates, { query: { limit: '1' } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.candidate_count, 1);
  assert.equal(result.payload.candidates[0].actual_message_count, 3);
  assert.equal(calls[1].options.method, 'HEAD');
  assert.ok(!calls[0].url.includes('message_count=gt.0'));
});

test('profile APIs do not expose exception text or customer identity in errors', () => {
  const sources = [
    'api/profile-route.js',
    'api/customer-messages.js',
    'api/profile-write.js'
  ].map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  assert.ok(sources.every(source => !source.includes('error: err.message')));
  assert.ok(sources.every(source => !source.includes('Customer not found: ${projectKey}')));
});

(async () => {
  try {
    for (const entry of tests) {
      await entry.fn();
    }
    console.log(`PASS ${tests.length}/${tests.length}`);
  } finally {
    global.fetch = originalFetch;
  }
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
