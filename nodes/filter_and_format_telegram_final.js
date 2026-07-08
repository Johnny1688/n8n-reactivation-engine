// ⚠️ STALE COPY WARNING (2026-07-08, Cowork review):
// This legacy n8n Code node (last updated 2026-04-14) predates the
// 2026-07-02 copy-safety repair. It only checks should_send + non-empty
// message and has NO manual_context_required / hard_no_send / quality
// blocking. Production now uses the Vercel endpoint
// api/filter-and-format-telegram-final.js. Do NOT paste this file into n8n.
function formatTelegramFinal(input) {
  const message = String(input.whatsapp_message || '').trim();
  const shouldSend = input.should_send === true && !!message;

  if (!shouldSend) {
    return {
      sendable: false,
      telegram_final_text: ''
    };
  }

  const customerName = input.customer_name || 'unknown_customer';
  const projectKey = input.project_key || 'unknown_project';

  return {
    sendable: true,
    telegram_final_text: [
      `Ready to send`,
      `Project: ${projectKey}`,
      `Customer: ${customerName}`,
      ``,
      message
    ].join('\n')
  };
}

function getInputJsons() {
  if (typeof $input !== 'undefined' && $input.all) return $input.all().map(item => item.json || {});
  if (typeof $json !== 'undefined') return [$json || {}];
  return [];
}

function toN8nItems(items) {
  return items.map(json => ({ json }));
}

function runFilterAndFormatTelegramFinal(input) {
  return {
    ...(input || {}),
    ...formatTelegramFinal(input || {})
  };
}

if (typeof module !== 'undefined') {
  module.exports = { formatTelegramFinal, runFilterAndFormatTelegramFinal };
}

if (typeof $input !== 'undefined' || typeof $json !== 'undefined') {
  return toN8nItems(getInputJsons().map(runFilterAndFormatTelegramFinal));
}
