function stripCodeFence(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function pickText(input) {
  if (!input) return '';
  if (typeof input === 'string') return input;
  if (typeof input.ai_output_text === 'string') return input.ai_output_text;
  if (typeof input.ai_output === 'string') return input.ai_output;
  if (typeof input.text === 'string') return input.text;
  if (typeof input.output === 'string') return input.output;
  if (typeof input.content === 'string') return input.content;
  if (input.message && typeof input.message.content === 'string') return input.message.content;
  return '';
}

function normalizeParsed(parsed) {
  return {
    should_send: parsed.should_send === true,
    why: typeof parsed.why === 'string' ? parsed.why : '',
    whatsapp_message: typeof parsed.whatsapp_message === 'string' ? parsed.whatsapp_message.trim() : ''
  };
}

function parseAIOutput(input) {
  if (
    input &&
    typeof input === 'object' &&
    Object.prototype.hasOwnProperty.call(input, 'should_send') &&
    Object.prototype.hasOwnProperty.call(input, 'whatsapp_message')
  ) {
    return normalizeParsed(input);
  }

  const rawText = stripCodeFence(pickText(input));

  try {
    return normalizeParsed(JSON.parse(rawText));
  } catch (error) {
    return {
      should_send: false,
      why: 'invalid_ai_json',
      whatsapp_message: ''
    };
  }
}

function getInputJsons() {
  if (typeof $input !== 'undefined' && $input.all) return $input.all().map(item => item.json || {});
  if (typeof $json !== 'undefined') return [$json || {}];
  return [];
}

function toN8nItems(items) {
  return items.map(json => ({ json }));
}

function runParseAIOutput(input) {
  return {
    ...(input || {}),
    ...parseAIOutput(input || {})
  };
}

if (typeof module !== 'undefined') {
  module.exports = { parseAIOutput, runParseAIOutput };
}

if (typeof $input !== 'undefined' || typeof $json !== 'undefined') {
  return toN8nItems(getInputJsons().map(runParseAIOutput));
}
