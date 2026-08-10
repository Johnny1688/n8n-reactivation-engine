const assert = require('node:assert/strict');
const buildContextHandler = require('../api/build-context');

const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

async function runBuildContext(body) {
  let statusCode = null;
  let payload = null;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    }
  };

  await buildContextHandler({ body }, response);
  assert.equal(statusCode, 200);
  assert.ok(payload && payload.error !== true);
  return payload;
}

function message(role, text, day) {
  return {
    role,
    message: text,
    message_time: `2026-05-${String(day).padStart(2, '0')}T12:00:00.000Z`
  };
}

test('seller deferral language never creates a customer hard-no-send', async () => {
  const result = await runBuildContext({
    project_key: 'PK-SYNTHETIC-SELLER',
    customer_name: 'Synthetic',
    messages: [
      message('customer', 'How much is the compact model?', 1),
      message('me', "I'll let you know as soon as I receive the updated freight quote.", 2)
    ]
  });

  assert.equal(result.has_not_now_signal, false);
  assert.equal(result.hard_no_send, false);
});

test('later explicit buyer question supersedes an older soft deferral', async () => {
  const result = await runBuildContext({
    project_key: 'PK-SYNTHETIC-REENGAGED',
    customer_name: 'Synthetic',
    messages: [
      message('customer', 'Sorry, I am busy right now. Maybe later.', 1),
      message('me', 'No problem, I will give you some time.', 2),
      message('customer', 'Yes please. How much is one of these?', 3),
      message('me', 'The current price is USD 1,000.', 4)
    ]
  });

  assert.equal(result.last_customer_message, 'Yes please. How much is one of these?');
  assert.equal(result.has_not_now_signal, false);
  assert.equal(result.hard_no_send, false);
});

test('latest customer soft deferral remains blocked', async () => {
  const result = await runBuildContext({
    project_key: 'PK-SYNTHETIC-DEFERRED',
    customer_name: 'Synthetic',
    messages: [
      message('customer', 'Can you send the quote?', 1),
      message('me', 'Yes, I can send it here.', 2),
      message('customer', 'Not happening right now. I will let you know.', 3)
    ]
  });

  assert.equal(result.has_not_now_signal, true);
  assert.equal(result.hard_no_send, true);
  assert.equal(result.send_state, 'no_send');
});

test('explicit opt-out remains sticky after a later positive phrase', async () => {
  const result = await runBuildContext({
    project_key: 'PK-SYNTHETIC-OPTOUT',
    customer_name: 'Synthetic',
    messages: [
      message('customer', 'Please do not contact me again.', 1),
      message('me', 'Understood.', 2),
      message('customer', 'Thanks.', 3)
    ]
  });

  assert.equal(result.hard_no_send, true);
  assert.equal(result.send_state, 'no_send');
});

test('misclassified customer-like text cannot bypass missing customer context', async () => {
  const result = await runBuildContext({
    project_key: 'PK-SYNTHETIC-ROLE-HOLD',
    customer_name: 'Synthetic',
    messages: [
      message('me', 'Not happening right now.', 1),
      message('me', 'Would an alternate payment method help?', 2)
    ]
  });

  assert.equal(result.hard_no_send, false);
  assert.equal(result.send_state, 'manual_context_required');
  assert.ok(result.manual_hold_reasons.includes('missing_customer_context'));
});

(async () => {
  for (const { name, fn } of cases) {
    try {
      await fn();
    } catch (error) {
      console.error(`FAIL: ${name}`);
      throw error;
    }
  }

  console.log(`PASS ${cases.length}/${cases.length}`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
