function buildPayloadSummary(payload) {
  if (!payload) return 'Payload: unavailable';

  const decision = payload.decision || {};
  const stopPoint = payload.stop_point || {};
  const constraints = payload.constraints || {};

  return [
    `Trigger: ${decision.best_trigger_type || 'unknown'}`,
    `Goal: ${decision.smallest_reply_goal || stopPoint.smallest_reply_to_trigger || 'unknown'}`,
    `Avoid: ${(constraints.do_not_repeat || []).join(', ') || 'none'}`
  ].join('\n');
}

function formatTelegramReview(input) {
  const projectKey = input.project_key || 'unknown_project';
  const customerName = input.customer_name || 'unknown_customer';
  const why = input.why || '';
  const whatsappMessage = input.whatsapp_message || '';
  const payload = input.reactivation_ai_payload || input.payload || null;

  return [
    `Reactivation Review`,
    `Project: ${projectKey}`,
    `Customer: ${customerName}`,
    ``,
    `Why: ${why || 'n/a'}`,
    ``,
    `WhatsApp message:`,
    whatsappMessage || '(empty)',
    ``,
    buildPayloadSummary(payload)
  ].join('\n');
}

function getInputJsons() {
  if (typeof $input !== 'undefined' && $input.all) return $input.all().map(item => item.json || {});
  if (typeof $json !== 'undefined') return [$json || {}];
  return [];
}

function toN8nItems(items) {
  return items.map(json => ({ json }));
}

function runFormatTelegramMessage(input) {
  return {
    ...(input || {}),
    telegram_review_text: formatTelegramReview(input || {})
  };
}

if (typeof module !== 'undefined') {
  module.exports = { formatTelegramReview, runFormatTelegramMessage };
}

if (typeof $input !== 'undefined' || typeof $json !== 'undefined') {
  return toN8nItems(getInputJsons().map(runFormatTelegramMessage));
}
