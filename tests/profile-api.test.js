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
const profileCanaryRollback = require('../api/profile-canary-rollback.js');
const profileCanaryStatus = require('../api/profile-canary-status.js');
const { validateProfile } = require('../nodes/profile_validator.js');

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

test('profile validator requires key_quotes to be present and empty', () => {
  const nonEmpty = validateProfile(validProfile({
    key_quotes: [{ date: '2026-08-11', quote: 'Synthetic quote.' }]
  }));
  assert.equal(nonEmpty.valid, false);
  assert.ok(nonEmpty.errors.some(error => error.includes('/key_quotes')));

  const missing = validProfile();
  delete missing.key_quotes;
  const missingResult = validateProfile(missing);
  assert.equal(missingResult.valid, false);
});

test('profile validator rejects private identifiers without echoing them', () => {
  const privateValue = 'person@example.test';
  const result = validateProfile(validProfile({ narrative: `Contact ${privateValue}` }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error === 'forbidden private data at $.narrative'));
  assert.ok(result.errors.every(error => !error.includes(privateValue)));
});

test('profile validator scans extensions and allows ordinary commercial evidence', () => {
  const blocked = validateProfile(validProfile({
    extensions: { internal_note: 'WhatsApp: +1 202 555 0100' }
  }));
  assert.equal(blocked.valid, false);
  assert.ok(blocked.errors.some(error => error === 'forbidden private data at $.extensions.internal_note'));

  const safe = validateProfile(validProfile({
    narrative: '客户计划在 2026-08-30 前确认 10-29 台，并询问 bank transfer 流程。'
  }));
  assert.equal(safe.valid, true);
});

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

test('missing-only canary write enforces null prestate and adds server control marker', async () => {
  const runId = 'profile-generator-canary-2026-08-12-v2';
  const calls = queueFetch(
    response([]),
    response([{
      project_key: 'PK-SYNTHETIC', conversation_summary: null,
      summary_updated_at: null, last_interaction_time: null
    }]),
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
      expected_profile_version: 1, expected_source_message_count: 2,
      canary_mode: 'missing_only', canary_run_id: runId, canary_slot: 1,
      expected_prior_summary_state: 'missing_summary'
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.canary_slot, 1);
  assert.match(calls[2].url, /conversation_summary=is\.null/);
  const written = JSON.parse(calls[2].options.body).conversation_summary;
  assert.deepEqual(written.extensions.canary_control.run_id, runId);
  assert.equal(written.extensions.canary_control.slot, 1);
  assert.equal(written.extensions.canary_control.prior_summary_state, 'missing_summary');
});

test('canary write rejects a non-null rollback prestate before PATCH', async () => {
  queueFetch(
    response([]),
    response([{
      project_key: 'PK-SYNTHETIC', conversation_summary: validProfile(),
      summary_updated_at: null, last_interaction_time: null
    }])
  );
  const result = await call(profileWrite, {
    method: 'POST',
    body: {
      project_key: 'PK-SYNTHETIC', profile: validProfile(), expected_summary_updated_at: null,
      expected_last_interaction_time: null, expected_generation_mode: 'full',
      expected_profile_version: 1, expected_source_message_count: 2,
      canary_mode: 'missing_only', canary_run_id: 'profile-generator-canary-2026-08-12-v2', canary_slot: 1,
      expected_prior_summary_state: 'missing_summary'
    }
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.payload.code, 'canary_prestate_conflict');
});

test('canary slot two requires exactly one prior slot-one marker', () => {
  const runId = 'profile-generator-canary-2026-08-12-v2';
  assert.equal(profileWrite.validCanaryProgress([], { runId, slot: 2 }), false);
  assert.equal(profileWrite.validCanaryProgress([{
    conversation_summary: { extensions: { canary_control: { run_id: runId, slot: 1 } } }
  }], { runId, slot: 2 }), true);
  assert.equal(profileWrite.validCanaryProgress([{
    conversation_summary: { extensions: { canary_control: { run_id: runId, slot: 2 } } }
  }], { runId, slot: 2 }), false);
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
  assert.equal(result.payload.selection_checked_count, 1);
  assert.equal(result.payload.selection_hold_count, 0);
  assert.equal(result.payload.candidates[0].actual_message_count, 3);
  assert.equal(calls[1].options.method, 'HEAD');
  assert.ok(!calls[0].url.includes('message_count=gt.0'));
});

test('candidate endpoint isolates one count failure and continues to a valid customer', async () => {
  const calls = queueFetch(
    response([
      {
        project_key: 'PK-HOLD', customer_name: 'Held', stage: 'quoted',
        status: 'open', follow_up_priority: 'high', conversation_summary: null,
        summary_updated_at: null, message_count: 0, last_interaction_time: '2026-08-11T00:00:00.000Z'
      },
      {
        project_key: 'PK-SYNTHETIC', customer_name: 'Synthetic', stage: 'quoted',
        status: 'open', follow_up_priority: 'high', conversation_summary: null,
        summary_updated_at: null, message_count: 0, last_interaction_time: '2026-08-10T00:00:00.000Z'
      }
    ]),
    response(null, 503),
    response(null, 200, { 'content-range': '0-1/2' })
  );
  const result = await call(profileCandidates, { query: { limit: '1' } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.candidate_count, 1);
  assert.equal(result.payload.selection_checked_count, 2);
  assert.equal(result.payload.selection_hold_count, 1);
  assert.equal(result.payload.candidates[0].project_key, 'PK-SYNTHETIC');
  assert.equal(calls.length, 3);
});

test('candidate endpoint stops after the bounded selection error ceiling', async () => {
  queueFetch(
    response([1, 2, 3].map(index => ({
      project_key: `PK-HOLD-${index}`, customer_name: 'Held', stage: 'quoted',
      status: 'open', follow_up_priority: 'high', conversation_summary: null,
      summary_updated_at: null, message_count: 0, last_interaction_time: `2026-08-${12 - index}T00:00:00.000Z`
    }))),
    response(null, 503),
    response(null, 503),
    response(null, 503)
  );
  const result = await call(profileCandidates, { query: { limit: '1' } });
  assert.equal(result.statusCode, 500);
  assert.equal(result.payload.code, 'selection_error_ceiling');
});

test('missing-only canary candidate load blocks a consumed run before selection', async () => {
  const calls = queueFetch(response([{ project_key: 'PK-REDACTED' }]));
  const result = await call(profileCandidates, {
    query: {
      limit: '2', mode: 'canary_missing_only',
      run_id: 'profile-generator-canary-2026-08-12-v2'
    }
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.payload.code, 'canary_run_already_consumed');
  assert.equal(calls.length, 1);
});

test('missing-only canary candidate load excludes stale existing profiles', async () => {
  const calls = queueFetch(
    response([]),
    response([
      {
        project_key: 'PK-MISSING-1', stage: 'quoted', status: 'open', follow_up_priority: 'high',
        conversation_summary: null, summary_updated_at: null, last_interaction_time: '2026-08-11T00:00:00.000Z'
      },
      {
        project_key: 'PK-STALE', stage: 'ready', status: 'open', follow_up_priority: 'high',
        conversation_summary: validProfile(), summary_updated_at: '2026-01-01T00:00:00.000Z',
        last_interaction_time: '2026-08-12T00:00:00.000Z'
      },
      {
        project_key: 'PK-MISSING-2', stage: 'engaged', status: 'open', follow_up_priority: 'normal',
        conversation_summary: null, summary_updated_at: null, last_interaction_time: '2026-08-10T00:00:00.000Z'
      }
    ]),
    response(null, 200, { 'content-range': '0-1/2' }),
    response(null, 200, { 'content-range': '0-2/3' })
  );
  const result = await call(profileCandidates, {
    query: {
      limit: '2', mode: 'canary_missing_only',
      run_id: 'profile-generator-canary-2026-08-12-v2'
    }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.mode, 'canary_missing_only');
  assert.equal(result.payload.candidate_count, 2);
  assert.ok(result.payload.candidates.every(candidate => candidate.profile_reason === 'missing_profile'));
  assert.equal(calls.length, 4);
});

test('canary rollback restores only the server-proven null prestate with CAS', async () => {
  const runId = 'profile-generator-canary-2026-08-12-v2';
  const writtenAt = '2026-08-12T03:00:00.000Z';
  const controlled = validProfile({
    extensions: {
      canary_control: {
        run_id: runId, slot: 1, prior_summary_state: 'missing_summary',
        prior_summary_updated_at: null, expected_last_interaction_time: null,
        written_at: writtenAt
      }
    }
  });
  const calls = queueFetch(
    response([{
      project_key: 'PK-SYNTHETIC', conversation_summary: controlled,
      summary_updated_at: writtenAt, last_interaction_time: null
    }]),
    response([{
      project_key: 'PK-SYNTHETIC', conversation_summary: null, summary_updated_at: null
    }])
  );
  const result = await call(profileCanaryRollback, {
    method: 'POST',
    body: { canary_run_id: runId, canary_slot: 1 }
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, { rolled_back: true, canary_slot: 1 });
  assert.match(calls[1].url, /summary_updated_at=eq\./);
  assert.match(calls[1].url, /canary_control->>run_id=eq\./);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    conversation_summary: null, summary_updated_at: null
  });
});

test('canary status returns aggregate-only PASS for two valid controlled rows', async () => {
  const runId = 'profile-generator-canary-2026-08-12-v2';
  const controlled = slot => validProfile({
    extensions: {
      canary_control: {
        run_id: runId, slot, prior_summary_state: 'missing_summary',
        prior_summary_updated_at: null, expected_last_interaction_time: null,
        written_at: `2026-08-12T03:00:0${slot}.000Z`
      }
    }
  });
  queueFetch(response([1, 2].map(slot => ({
    conversation_summary: controlled(slot),
    summary_updated_at: `2026-08-12T03:00:0${slot}.000Z`,
    last_interaction_time: null
  }))));
  const result = await call(profileCanaryStatus, {
    query: { run_id: runId }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.verdict, 'CANARY_DB_PASS');
  assert.equal(result.payload.row_count, 2);
  assert.equal(result.payload.distinct_slot_count, 2);
  assert.equal(result.payload.duplicate_slot_count, 0);
  assert.equal(result.payload.rollback_ready_count, 2);
  assert.ok(!Object.prototype.hasOwnProperty.call(result.payload, 'project_key'));
  assert.ok(!JSON.stringify(result.payload).includes('narrative'));
});

test('canary status fails closed on a duplicate slot', async () => {
  const runId = 'profile-generator-canary-2026-08-12-v2';
  const controlled = validProfile({
    extensions: {
      canary_control: {
        run_id: runId, slot: 1, prior_summary_state: 'missing_summary',
        prior_summary_updated_at: null, expected_last_interaction_time: null,
        written_at: '2026-08-12T03:00:01.000Z'
      }
    }
  });
  queueFetch(response([1, 2].map(() => ({
    conversation_summary: controlled,
    summary_updated_at: '2026-08-12T03:00:01.000Z',
    last_interaction_time: null
  }))));
  const result = await call(profileCanaryStatus, { query: { run_id: runId } });
  assert.equal(result.payload.verdict, 'CANARY_DB_HOLD');
  assert.equal(result.payload.duplicate_slot_count, 1);
});

test('profile APIs do not expose exception text or customer identity in errors', () => {
  const sources = [
    'api/profile-route.js',
    'api/customer-messages.js',
    'api/profile-write.js',
    'api/profile-canary-rollback.js',
    'api/profile-canary-status.js'
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
