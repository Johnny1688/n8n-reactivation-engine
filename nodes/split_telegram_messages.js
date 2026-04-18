function splitTelegramMessages(input) {
  const reviewText = input.telegram_review_text || '';
  const finalText = input.telegram_final_text || '';
  const englishMessage = input.whatsapp_message || '';

  return {
    telegram_review_message: reviewText || finalText,
    telegram_english_message: englishMessage
  };
}

function getInputJsons() {
  if (typeof $input !== 'undefined' && $input.all) return $input.all().map(item => item.json || {});
  if (typeof $json !== 'undefined') return [$json || {}];
  return [];
}

function toN8nItems(items) {
  return items.map((json, i) => ({
    json: {
      ...json,
      _delay_before_ms: i * 1000
    }
  }));
}

function runSplitTelegramMessages(input) {
  return {
    ...(input || {}),
    ...splitTelegramMessages(input || {})
  };
}

if (typeof module !== 'undefined') {
  module.exports = { splitTelegramMessages, runSplitTelegramMessages };
}

if (typeof $input !== 'undefined' || typeof $json !== 'undefined') {
  return toN8nItems(getInputJsons().map(runSplitTelegramMessages));
}
