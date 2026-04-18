function toSafeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function splitTelegramMessages(input) {
  const messages = Array.isArray(input.telegram_messages) ? input.telegram_messages : [];

  if (messages.length < 3) return null;

  const msg1 = toSafeString(messages[0]);
  const msg2 = toSafeString(messages[1]);
  const msg3 = toSafeString(messages[2]);

  if (!msg1 || !msg2 || !msg3) return null;

  return {
    project_key: toSafeString(input.project_key),
    order_group: toSafeString(input.order_group),
    msg_1_full: msg1,
    msg_2_key: msg2,
    msg_3_en: msg3,
    whatsapp_message: toSafeString(input.whatsapp_message),
    whatsapp_message_cn: toSafeString(input.whatsapp_message_cn),
    analysis_text: toSafeString(input.analysis_text),
    enforce_status: toSafeString(input.enforce_status),
    auto_send_pass: !!input.auto_send_pass
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

if (typeof module !== 'undefined') {
  module.exports = { splitTelegramMessages };
}

if (typeof $input !== 'undefined' || typeof $json !== 'undefined') {
  return toN8nItems(
    getInputJsons()
      .map(splitTelegramMessages)
      .filter(item => item !== null)
  );
}
