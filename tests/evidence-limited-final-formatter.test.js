const assert = require('node:assert/strict');
const buildContext = require('../api/build-context');
const filterFinal = require('../api/filter-and-format-telegram-final');

async function callHandler(handler, body) {
  let statusCode = 200;
  let payload;
  const req = { method: 'POST', body };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    }
  };

  await handler(req, res);
  assert.equal(statusCode, 200);
  return payload;
}

function message(role, text, day) {
  return {
    role,
    message: text,
    message_time: `2026-05-${String(day).padStart(2, '0')}T12:00:00.000Z`
  };
}

function emptyEnforceOutput() {
  return [{ content: [{ text: JSON.stringify({ whatsapp_message: '', whatsapp_message_cn: '' }) }] }];
}

async function formatBuiltContext(input) {
  const context = await callHandler(buildContext, input);
  const formatted = await callHandler(filterFinal, {
    ...context,
    output: emptyEnforceOutput()
  });
  return { context, result: formatted[0] };
}

(async () => {
  let checks = 0;
  const check = (condition, messageText) => {
    checks += 1;
    assert.ok(condition, messageText);
  };

  const sellerOnly = await formatBuiltContext({
    project_key: 'PK-SYNTHETIC-SELLER-ONLY',
    customer_name: 'Alex',
    stage: 'outreach',
    messages: [
      message('me', 'I can send the AR011 specifications for your 6-unit studio.', 1),
      message('me', 'The AR011 quote includes commercial springs and delivery options.', 2)
    ]
  });
  check(sellerOnly.context.runtime_conversation_summary?.source === 'seller_history_runtime', 'seller-only runtime summary');
  check(sellerOnly.result.auto_send_pass === true, 'seller-only recovery should reach internal review');
  check(sellerOnly.result.telegram_messages.length === 3, 'seller-only review package should have three parts');
  check(sellerOnly.result.used_evidence_limited_recovery === true, 'seller-only recovery marker');
  check(/AR011/i.test(sellerOnly.result.whatsapp_message), 'seller-only copy must retain a concrete anchor');
  check(!/any update|just checking/i.test(sellerOnly.result.whatsapp_message), 'seller-only copy must not be generic');

  const noHistory = await formatBuiltContext({
    project_key: 'PK-SYNTHETIC-NO-HISTORY',
    customer_name: 'Alex',
    stage: 'engaged',
    messages: []
  });
  check(noHistory.context.send_state === 'rewrite_needed', 'zero-history context must be explicitly authorized');
  check(noHistory.result.auto_send_pass === true, 'zero-history permission check should reach internal review');
  check(noHistory.result.telegram_messages.length === 3, 'zero-history review package should have three parts');
  check(noHistory.result.used_evidence_limited_recovery === true, 'zero-history recovery marker');
  check(/currently working on a Pilates Reformer project/i.test(noHistory.result.whatsapp_message), 'permission-check copy');
  check(/普拉提 Reformer 项目/.test(noHistory.result.whatsapp_message_cn), 'complete Chinese reference');

  const weakIdentity = await formatBuiltContext({
    project_key: '+15551234567',
    customer_name: '+15551234567',
    stage: 'engaged',
    messages: []
  });
  check(weakIdentity.result.auto_send_pass === false, 'weak identity must stay blocked');
  check(weakIdentity.result.telegram_messages.length === 0, 'weak identity must not create a review package');

  const oneSellerMessage = await formatBuiltContext({
    project_key: 'PK-SYNTHETIC-ONE-SELLER',
    customer_name: 'Alex',
    stage: 'outreach',
    messages: [message('me', 'I can send AR011 pricing for 6 units.', 1)]
  });
  check(oneSellerMessage.result.auto_send_pass === false, 'one seller message is insufficient');

  const roleAnomaly = await formatBuiltContext({
    project_key: 'PK-SYNTHETIC-ROLE-ANOMALY',
    customer_name: 'Alex',
    stage: 'outreach',
    messages: [
      message('me', 'How much is the AR011?', 1),
      message('me', 'Can I see the delivery quote?', 2)
    ]
  });
  check(roleAnomaly.result.auto_send_pass === false, 'seller-only role anomaly must stay blocked');
  check(roleAnomaly.result.manual_hold_reasons.includes('seller_history_role_anomaly'), 'role anomaly reason preserved');

  const hardNoSend = await formatBuiltContext({
    project_key: 'PK-SYNTHETIC-NO-SEND',
    customer_name: 'Alex',
    stage: 'engaged',
    messages: [
      message('customer', 'Please do not contact me again.', 1),
      message('me', 'Understood.', 2)
    ]
  });
  check(hardNoSend.result.auto_send_pass === false, 'hard-no-send must stay blocked');
  check(hardNoSend.result.telegram_messages.length === 0, 'hard-no-send must not create a review package');
  check(hardNoSend.result.used_evidence_limited_recovery === false, 'hard-no-send must not generate recovery copy');

  const spoofedPermissionCheck = await callHandler(filterFinal, {
    project_key: 'PK-SYNTHETIC-SPOOFED-PERMISSION',
    customer_name: 'Alex',
    stage: 'engaged',
    send_state: 'rewrite_needed',
    primary_reply_anchor: 'pilates_equipment_project_status',
    allowed_micro_triggers: ['confirm_current_pilates_project_here'],
    reactivation_decision_basis: { best_trigger_reason: 'no_history_permission_check_only' },
    runtime_conversation_summary: {
      source: 'seller_history_runtime',
      message_count: 2,
      customer_message_count: 0,
      seller_message_count: 2
    },
    output: emptyEnforceOutput()
  });
  check(spoofedPermissionCheck[0].auto_send_pass === false, 'permission-check marker cannot bypass contradictory runtime evidence');

  console.log(`PASS ${checks}/${checks}`);
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
