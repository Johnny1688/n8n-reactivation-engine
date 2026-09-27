// Legacy calls keep their original request and response objects.
const ROUTE_KEY = '__safe_v14_route';
const WRAPPER_PATH = '/api/format-telegram-message';

function reject(res) {
  return res.status(400).json({ error: true, code: 'SAFE_V14_ROUTE_CONFLICT' });
}

module.exports = function (req, res) {
  const query = req.query;
  const hasRoute = query != null && Object.prototype.hasOwnProperty.call(query, ROUTE_KEY);
  let url;
  try {
    url = typeof req.url === 'string' ? new URL(req.url, 'http://gateway.invalid') : null;
  } catch {
    if (hasRoute) return reject(res);
  }
  const rawRoutes = url ? url.searchParams.getAll(ROUTE_KEY) : [];

  if (!hasRoute) {
    if (rawRoutes.length || (url && /^\/api\/safe-v14-.*-20260923$/.test(url.pathname))) {
      return reject(res);
    }
    return getHandler('legacy')(req, res);
  }

  const route = query[ROUTE_KEY];
  if (typeof route !== 'string' || !url || rawRoutes.length > 1 ||
      (rawRoutes.length === 1 && rawRoutes[0] !== route) ||
      (url.pathname !== WRAPPER_PATH && url.pathname !== '/api/' + route)) {
    return reject(res);
  }

  switch (route) {
    case 'safe-v14-format-telegram-message-20260923':
      return getHandler('safe-v14-format-telegram-message-20260923')(req, res);
    case 'safe-v14-filter-and-format-telegram-final-20260923':
      return getHandler('safe-v14-filter-and-format-telegram-final-20260923')(req, res);
    case 'safe-v14-compile-enforce-prompt-20260923':
      return getHandler('safe-v14-compile-enforce-prompt-20260923')(req, res);
    default:
      return reject(res);
  }
};

const handlers = Object.create(null);
function getHandler(id) {
  if (!Object.prototype.hasOwnProperty.call(handlers, id)) {
    const nestedModule = { exports: {} };
    factories[id](nestedModule);
    handlers[id] = nestedModule.exports;
  }
  return handlers[id];
}
const factories = {
  "legacy": function (module) {
// BEGIN_PINNED_HANDLER legacy
function toSafeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function cleanupMessage(value) {
  return toSafeString(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const cleaned = cleanupMessage(value);
    if (cleaned) return cleaned;
  }
  return '';
}

function normalizeMessageValue(value) {
  const cleaned = cleanupMessage(value);
  const lower = cleaned.toLowerCase();

  if (!cleaned) return '';
  if (lower === 'undefined') return '';
  if (lower === 'null') return '';

  return cleaned;
}

function parseJsonSafe(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;

  const text = toSafeString(raw)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeText(value) {
  return cleanupMessage(value).toLowerCase();
}

function isWeakCandidateMessage(message) {
  const text = normalizeText(message);
  if (!text) return false;

  const weakPatterns = [
    'are you still considering',
    'would you like to confirm',
    'just let me know',
    'ready to chat again',
    'are you okay with',
    'know how our prices compare',
    'confirm the price details',
    'would you like to know how our prices compare',
    'would you like to know',
    'are you ready',
    'still interested',
    'any update',
    'following up',
    'checking in',
    'just checking'
  ];

  return weakPatterns.some(pattern => text.includes(pattern));
}

function buildChineseGloss(message) {
  const text = cleanupMessage(message);
  const lower = text.toLowerCase();

  if (!text) return '';

  if (/price|pricing|quote|cost/.test(lower)) {
    if (/resend|send/.test(lower)) return '我可以把之前的价格整理成一条清楚的信息发给你，要我发这里吗？';
    if (/line|lay|put|break|compare|difference/.test(lower)) return '我可以把价格范围整理清楚发给你，要我发这里吗？';
    return '我可以把价格信息简单整理一下，要我发这里吗？';
  }

  if (/catalog|pdf/.test(lower)) {
    return '我可以把目录链接重新发一遍，要我发这里吗？';
  }

  if (/photo|photos|video|videos|picture|pictures/.test(lower)) {
    return '我可以把图片/视频整理成一条信息发给你，要我发这里吗？';
  }

  if (/shipping|ship|delivery|zip|houston/.test(lower)) {
    return '我可以把运输信息整理成一条清楚的信息，要我发这里吗？';
  }

  if (/warranty/.test(lower)) {
    return '我可以把质保信息简单整理一下，要我发这里吗？';
  }

  if (/deposit|payment/.test(lower)) {
    return '我可以把付款信息简单整理一下，要我发这里吗？';
  }

  if (/cheaper|supplier|compare|comparison|difference/.test(lower)) {
    return '我可以把关键差异整理成一条简单信息，要我发这里吗？';
  }

  if (/ar010|ar011|ar012|model|models|reformer|setup|option|shortlist/.test(lower)) {
    return '我可以把相关选项整理成一条简单信息，要我发这里吗？';
  }

  if (/send it|send that|want me to/.test(lower)) {
    return '我可以整理成一条简单信息发给你，要我发这里吗？';
  }

  return '';
}

function getNestedOutputText(source) {
  return firstNonEmptyString(
    source?.output?.[0]?.content?.[0]?.text,
    source?.content?.[0]?.text,
    source?.output_text,
    source?.text,
    source?.message
  );
}

function normalizeAiParsed(data, item) {
  const existingParsed = parseJsonSafe(data.ai_parsed);
  const rawAiText = firstNonEmptyString(
    getNestedOutputText(data),
    getNestedOutputText(item)
  );
  const outputParsed = parseJsonSafe(rawAiText);

  const aiParsed = {
    ...outputParsed,
    ...existingParsed
  };

  const whatsappMessage = normalizeMessageValue(
    firstNonEmptyString(
      aiParsed.whatsapp_message,
      aiParsed.whatsapp_text,
      aiParsed.final_message,
      aiParsed.whatsapp_message_en,
      aiParsed.message_text,
      data.whatsapp_message,
      data.whatsapp_text,
      data.final_message,
      data.message_text
    )
  );

  return {
    ...aiParsed,
    whatsapp_message: whatsappMessage
  };
}

function normalizeInputItems(body) {
  const rawItems = Array.isArray(body) ? body : [body || {}];

  return rawItems.map(item => {
    if (item && typeof item === 'object' && !Array.isArray(item) && item.json) {
      return {
        ...item,
        json: {
          ...item.json,
          output: item.json.output || item.output,
          output_text: item.json.output_text || item.output_text,
          text: item.json.text || item.text,
          message: item.json.message || item.message
        }
      };
    }

    return {
      json: item && typeof item === 'object' && !Array.isArray(item) ? item : {}
    };
  });
}

function formatTelegramMessageItems(items) {
  return items
    .map(item => {
      const data = item.json || {};
      const aiParsed = normalizeAiParsed(data, item);
      const en = normalizeMessageValue(aiParsed.whatsapp_message);

      const projectKey = firstNonEmptyString(
        data.project_key,
        aiParsed.project_key
      );

      const orderGroup = firstNonEmptyString(
        data.order_group,
        projectKey,
        aiParsed.order_group
      );

      const cn = en
        ? firstNonEmptyString(
            data.whatsapp_message_cn,
            data.whatsapp_text_cn,
            data.message_cn,
            aiParsed.whatsapp_message_cn,
            aiParsed.whatsapp_text_cn,
            aiParsed.message_cn
          )
        : '';

      const needsEnforceRewrite = en ? isWeakCandidateMessage(en) : false;

      return {
        json: {
          ...data,
          ai_parsed: aiParsed,
          order_group: orderGroup,
          project_key: projectKey,
          _en: en,
          _cn: cn,
          weak_candidate_message: needsEnforceRewrite ? en : '',
          needs_enforce_rewrite: needsEnforceRewrite
        }
      };
    })
    .filter(item => {
      const data = item.json || {};

      const projectKey = cleanupMessage(data.project_key);
      const orderGroup = cleanupMessage(data.order_group);

      if (!projectKey) return false;
      if (!orderGroup) return false;

      return true;
    })
    .map(item => {
      const data = item.json || {};

      const projectKey = cleanupMessage(data.project_key);
      const orderGroup = cleanupMessage(data.order_group);
      const en = normalizeMessageValue(data._en);
      const cn = en ? cleanupMessage(data._cn) || buildChineseGloss(en) : '';
      const telegramMessages = en
        ? [
            `【${projectKey}】

English:
${en}

中文翻译:
${cn || '（AI未输出中文翻译）'}`,
            en
          ]
        : [];

      return {
        json: {
          ...data,
          order_group: orderGroup,
          project_key: projectKey,
          ai_parsed: {
            ...(data.ai_parsed || {}),
            whatsapp_message: en
          },
          _en: en,
          _cn: cn,
          weak_candidate_message: en ? data.weak_candidate_message || '' : '',
          needs_enforce_rewrite: en ? data.needs_enforce_rewrite === true : false,
          telegram_messages: telegramMessages
        }
      };
    });
}

module.exports = async function (req, res) {
  if (req.method && req.method !== 'POST') {
    return res.status(405).json({
      error: true,
      message: 'Method not allowed'
    });
  }

  try {
    const inputItems = normalizeInputItems(req.body);
    const resultItems = formatTelegramMessageItems(inputItems);
    return res.status(200).json(resultItems);
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err.message || 'format-telegram-message failed'
    });
  }
};

// END_PINNED_HANDLER legacy
  },
  "safe-v14-format-telegram-message-20260923": function (module) {
// BEGIN_PINNED_HANDLER safe-v14-format-telegram-message-20260923
function toSafeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function cleanupMessage(value) {
  return toSafeString(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const cleaned = cleanupMessage(value);
    if (cleaned) return cleaned;
  }
  return '';
}

function normalizeMessageValue(value) {
  const cleaned = cleanupMessage(value);
  const lower = cleaned.toLowerCase();

  if (!cleaned) return '';
  if (lower === 'undefined') return '';
  if (lower === 'null') return '';

  return cleaned;
}

function parseJsonSafe(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;

  const text = toSafeString(raw)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!text) return {};

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeText(value) {
  return cleanupMessage(value).toLowerCase();
}

function isWeakCandidateMessage(message) {
  const text = normalizeText(message);
  if (!text) return false;

  const weakPatterns = [
    'are you still considering',
    'would you like to confirm',
    'just let me know',
    'ready to chat again',
    'are you okay with',
    'know how our prices compare',
    'confirm the price details',
    'would you like to know how our prices compare',
    'would you like to know',
    'are you ready',
    'still interested',
    'any update',
    'following up',
    'checking in',
    'just checking'
  ];

  return weakPatterns.some(pattern => text.includes(pattern));
}

function buildChineseGloss(message) {
  const text = cleanupMessage(message);
  const lower = text.toLowerCase();

  if (!text) return '';

  if (/price|pricing|quote|cost/.test(lower)) {
    if (/resend|send/.test(lower)) return '我可以把之前的价格整理成一条清楚的信息发给你，要我发这里吗？';
    if (/line|lay|put|break|compare|difference/.test(lower)) return '我可以把价格范围整理清楚发给你，要我发这里吗？';
    return '我可以把价格信息简单整理一下，要我发这里吗？';
  }

  if (/catalog|pdf/.test(lower)) {
    return '我可以把目录链接重新发一遍，要我发这里吗？';
  }

  if (/photo|photos|video|videos|picture|pictures/.test(lower)) {
    return '我可以把图片/视频整理成一条信息发给你，要我发这里吗？';
  }

  if (/shipping|ship|delivery|zip|houston/.test(lower)) {
    return '我可以把运输信息整理成一条清楚的信息，要我发这里吗？';
  }

  if (/warranty/.test(lower)) {
    return '我可以把质保信息简单整理一下，要我发这里吗？';
  }

  if (/deposit|payment/.test(lower)) {
    return '我可以把付款信息简单整理一下，要我发这里吗？';
  }

  if (/cheaper|supplier|compare|comparison|difference/.test(lower)) {
    return '我可以把关键差异整理成一条简单信息，要我发这里吗？';
  }

  if (/ar010|ar011|ar012|model|models|reformer|setup|option|shortlist/.test(lower)) {
    return '我可以把相关选项整理成一条简单信息，要我发这里吗？';
  }

  if (/send it|send that|want me to/.test(lower)) {
    return '我可以整理成一条简单信息发给你，要我发这里吗？';
  }

  return '';
}

function boolFlag(value) { return value === true || value === 'true'; }

// Bounded Generator decoder: diagnostics contain fixed codes, never response text.
function parseGeneratorJsonSafe(raw) {
  if (typeof raw !== 'string') return { error: 'GENERATOR_TEXT_TYPE' };
  let text = raw.trim();
  if (!text) return { error: 'GENERATOR_EMPTY_TEXT' };
  if (text.startsWith('```')) {
    const fence = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
    if (!fence) return { error: 'GENERATOR_INVALID_FENCE' };
    text = fence[1].trim();
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: 'GENERATOR_INVALID_JSON' };
  }
}

function getGeneratorParsed(item) {
  const current = item.json || {};
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const code = value => typeof value === 'string'
    ? value.trim().toUpperCase().replace(/[ -]+/g, '_') : '';
  const candidates = [];
  const diagnostics = [];
  const add = value => { if (!diagnostics.includes(value)) diagnostics.push(value); };
  const reasonCodes = [];
  const blockingReasons = new Set([
    'NO_SEND', 'DO_NOT_SEND', 'SEND_STATE_NO_SEND', 'HARD_NO_SEND',
    'NOT_NOW', 'HAS_NOT_NOW_SIGNAL', 'MANUAL_CONTEXT_REQUIRED',
    'SEND_STATE_MANUAL_CONTEXT_REQUIRED', 'MY_TURN_REQUIRES_MANUAL_REPLY',
    'MISSING_CUSTOMER_CONTEXT', 'MISSING_SOURCE_CONTEXT',
    'MISSING_SUMMARY_WITHOUT_CONCRETE_ANCHOR', 'WEAK_IDENTITY_WITHOUT_CONCRETE_ANCHOR',
    'VERY_SHORT_CUSTOMER_CONTEXT_WITHOUT_ANCHOR',
    'ALTERNATE_ACTIVATION_REFUSED_NO_CONCRETE_SIGNAL', 'QUALITY_BLOCKED',
    'BLOCKED', 'HOLD', 'REFUSAL', 'REFUSED', 'REJECTED', 'REJECT'
  ]);
  const recognizedReasons = new Set([
    ...blockingReasons, 'EMPTY_MESSAGE', 'EMPTY_AI_MESSAGE', 'EMPTY_SKIP',
    'MISSING_CHINESE_REFERENCE', 'PASS', 'OK', 'APPROVED'
  ]);
  let reasonUnmapped = false;
  let blockedByGenerator = false;

  function inspectMetadata(value) {
    if (!object(value)) return;
    if (value.should_send === false || value.should_send === 'false') { blockedByGenerator = true; if (!reasonCodes.includes('DO_NOT_SEND')) reasonCodes.push('DO_NOT_SEND'); }
    if (own(value, 'refusal') && value.refusal !== null && value.refusal !== false && value.refusal !== '') add('GENERATOR_REFUSAL');
    if (code(value.type) === 'REFUSAL') add('GENERATOR_REFUSAL');
    if (code(value.finish_reason) === 'CONTENT_FILTER') add('GENERATOR_REFUSAL');
    if (code(value.stop_reason) === 'REFUSAL') add('GENERATOR_REFUSAL');
    if (code(value.stop_reason) === 'MAX_TOKENS') add('GENERATOR_TRUNCATED_OUTPUT');
    if (code(value.stop_reason) === 'PAUSE_TURN') add('GENERATOR_RESPONSE_NOT_COMPLETE');
    if (['LENGTH', 'MAX_TOKENS', 'MAX_OUTPUT_TOKENS'].includes(code(value.finish_reason))) add('GENERATOR_TRUNCATED_OUTPUT');
    if (code(value.status) === 'INCOMPLETE' || value.incomplete_details != null) add('GENERATOR_TRUNCATED_OUTPUT');
    if (['FAILED', 'CANCELLED', 'CANCELED', 'IN_PROGRESS', 'QUEUED'].includes(code(value.status))) add('GENERATOR_RESPONSE_NOT_COMPLETE');
    if (own(value, 'error') && value.error !== null && value.error !== false) add('GENERATOR_PROVIDER_ERROR');
    for (const key of ['hard_no_send', 'has_not_now_signal', 'not_now', 'manual_context_required']) {
      if (boolFlag(value[key])) {
        const reason = code(key);
        if (!reasonCodes.includes(reason)) reasonCodes.push(reason);
        blockedByGenerator = true;
      }
    }
    for (const key of ['send_state', 'generator_status', 'status', 'action']) {
      const reason = code(value[key]);
      if (blockingReasons.has(reason)) {
        if (!reasonCodes.includes(reason)) reasonCodes.push(reason);
        blockedByGenerator = true;
      }
    }
    if (own(value, 'reason') && value.reason != null && value.reason !== '') {
      const reason = code(value.reason);
      if (recognizedReasons.has(reason)) {
        if (!reasonCodes.includes(reason)) reasonCodes.push(reason);
        if (blockingReasons.has(reason)) blockedByGenerator = true;
      } else {
        reasonUnmapped = true;
      }
    }
  }

  function collectContent(content, shape) {
    if (!Array.isArray(content)) { add('GENERATOR_CONTENT_SHAPE'); return; }
    for (const part of content) {
      if (!object(part)) { add('GENERATOR_CONTENT_SHAPE'); continue; }
      inspectMetadata(part);
      if (own(part, 'text')) {
        if (part.type != null && !['TEXT', 'OUTPUT_TEXT'].includes(code(part.type))) add('GENERATOR_CONTENT_TYPE');
        candidates.push({ value: part.text, shape });
      }
    }
  }

  inspectMetadata(current);
  // The merged row can retain upstream draft fields. A chosen Generator envelope
  // is authoritative, even when malformed; never fall back to stale draft data.
  // The known Parse Anthropic node derives a one-text output wrapper from
  // original content[0].text. Inspect its complete original content so this
  // legacy wrapper cannot hide a second text or an explicit refusal block.
  // Live bb53fd Parse canonicalizes the first parsed object with JSON.stringify.
  // Reproduce only that exact, locally verified derivation to recognize its wrapper;
  // the complete original content still goes through the strict decoder below.
  const robustCanonicalText = (() => {
    if (current.ai_output_parse_status !== 'PASS_PARSED_JSON' || !object(current.ai_parsed) ||
        !Array.isArray(current.content) || !object(current.content[0]) || typeof current.content[0].text !== 'string') return null;
    const cleaned = current.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!cleaned) return null;
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (error) {
      const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch (innerError) { return null; }
    }
    if (!object(parsed)) return null;
    const canonical = JSON.stringify(parsed);
    return JSON.stringify(current.ai_parsed) === canonical ? canonical : null;
  })();
  // The same live parser leaves older output untouched on its explicit invalid
  // result. Recognize its exact empty shape so that stale output cannot win.
  const robustInvalidResult = current.ai_output_parse_status === 'HOLD_INVALID_JSON' &&
    object(current.ai_parsed) && Object.keys(current.ai_parsed).length === 2 &&
    current.ai_parsed.whatsapp_message === '' && current.ai_parsed.whatsapp_message_cn === '' &&
    current.whatsapp_message === '' && current.whatsapp_message_cn === '';
  const derivedOutput = Array.isArray(current.content) && Array.isArray(current.output) && current.output.length === 1 &&
    object(current.output[0]) && Object.keys(current.output[0]).length === 1 && Array.isArray(current.output[0].content) && current.output[0].content.length === 1 &&
    object(current.output[0].content[0]) && Object.keys(current.output[0].content[0]).length === 1 &&
    object(current.content[0]) && typeof current.content[0].text === 'string' &&
    (current.output[0].content[0].text === current.content[0].text ||
      (robustCanonicalText !== null && current.output[0].content[0].text === robustCanonicalText));
  if (['PASS_PARSED_JSON', 'HOLD_INVALID_JSON'].includes(current.ai_output_parse_status) && !derivedOutput && !robustInvalidResult) add('GENERATOR_OUTPUT_SHAPE');
  if (derivedOutput || robustInvalidResult) {
    collectContent(current.content, 'content_text');
  } else if (own(current, 'output') && current.output !== undefined) {
    if (!Array.isArray(current.output)) add('GENERATOR_OUTPUT_SHAPE');
    else for (const output of current.output) {
      if (!object(output)) { add('GENERATOR_OUTPUT_SHAPE'); continue; }
      inspectMetadata(output);
      if (own(output, 'content')) collectContent(output.content, 'output_content_text');
      else if (code(output.type) !== 'REASONING') add('GENERATOR_OUTPUT_SHAPE');
    }
  } else if (own(current, 'content') && current.content !== undefined) {
    collectContent(current.content, 'content_text');
  } else if (own(current, 'output_text') && current.output_text !== undefined) {
    candidates.push({ value: current.output_text, shape: 'output_text' });
  } else if (own(current, 'ai_parsed')) {
    candidates.push({ value: current.ai_parsed, shape: 'ai_parsed' });
  } else if (own(current, 'whatsapp_message')) {
    add('GENERATOR_DIRECT_OBJECT_NOT_SUPPORTED');
  }
  if (!candidates.length) add('GENERATOR_MISSING_OUTPUT');
  if (candidates.length > 1) add('GENERATOR_AMBIGUOUS_OUTPUT');

  let parsed;
  if (candidates.length === 1) {
    const candidate = candidates[0];
    const result = candidate.shape === 'ai_parsed' && typeof candidate.value !== 'string' ? { value: candidate.value } : parseGeneratorJsonSafe(candidate.value);
    if (result.error) add(result.error);
    else if (!object(result.value)) add('GENERATOR_OBJECT_REQUIRED');
    else {
      parsed = result.value;
      inspectMetadata(parsed);
      if (!own(parsed, 'whatsapp_message')) add('GENERATOR_MESSAGE_FIELD_MISSING');
      else if (typeof parsed.whatsapp_message !== 'string') add('GENERATOR_MESSAGE_TYPE');
      else if (!normalizeMessageValue(parsed.whatsapp_message) || parsed.whatsapp_message.trim().toLowerCase() === 'unknown') add('GENERATOR_EXPLICIT_EMPTY');
      if (own(parsed, 'whatsapp_message_cn') && typeof parsed.whatsapp_message_cn !== 'string') add('GENERATOR_CHINESE_TYPE');
    }
  }
  const inputBlocked = diagnostics.length > 0 || blockedByGenerator;
  const rootReason = diagnostics.length ? diagnostics[0] : blockedByGenerator ? 'GENERATOR_EXPLICIT_HOLD' : 'PARSED_OK';
  return {
    parsed: !inputBlocked && parsed ? parsed : {},
    whatsapp_message: !inputBlocked && parsed ? parsed.whatsapp_message.trim() : '',
    whatsapp_message_cn: !inputBlocked && parsed && typeof parsed.whatsapp_message_cn === 'string' ? parsed.whatsapp_message_cn.trim() : '',
    parse_status: rootReason,
    source_shape: candidates.length === 1 ? candidates[0].shape : 'unknown',
    diagnostic_codes: diagnostics,
    reason_codes: reasonCodes,
    reason_unmapped: reasonUnmapped,
    blocked_by_generator: blockedByGenerator,
    input_blocked: inputBlocked
  };
}

function normalizeAiParsed(data) {
  const result = getGeneratorParsed({ json: data });
  return {
    ...result.parsed,
    whatsapp_message: result.whatsapp_message,
    whatsapp_message_cn: result.whatsapp_message_cn,
    generator_parse_status: result.parse_status,
    generator_source_shape: result.source_shape,
    generator_diagnostic_codes: result.diagnostic_codes,
    generator_reason_unmapped: result.reason_unmapped,
    generator_input_blocked: result.input_blocked
  };
}

function normalizeInputItems(body) {
  const rawItems = Array.isArray(body) ? body : [body || {}];

  return rawItems.map(item => {
    if (item && typeof item === 'object' && !Array.isArray(item) && item.json) {
      return {
        ...item,
        json: {
          ...item.json,
          output: item.json.output !== undefined ? item.json.output : item.output,
          output_text: item.json.output_text !== undefined ? item.json.output_text : item.output_text,
          text: item.json.text !== undefined ? item.json.text : item.text,
          message: item.json.message !== undefined ? item.json.message : item.message
        }
      };
    }

    return {
      json: item && typeof item === 'object' && !Array.isArray(item) ? item : {}
    };
  });
}

function formatTelegramMessageItems(items) {
  return items
    .map(item => {
      const data = item.json || {};
      const aiParsed = normalizeAiParsed(data, item);
      const en = normalizeMessageValue(aiParsed.whatsapp_message);

      const projectKey = firstNonEmptyString(data.project_key);

      const orderGroup = firstNonEmptyString(
        data.order_group,
        projectKey,
        aiParsed.order_group
      );

      const cn = en ? firstNonEmptyString(aiParsed.whatsapp_message_cn) : '';

      const needsEnforceRewrite = en ? isWeakCandidateMessage(en) : false;

      return {
        json: {
          ...data,
          ai_parsed: aiParsed,
          generator_parse_status: aiParsed.generator_parse_status,
          generator_source_shape: aiParsed.generator_source_shape,
          generator_diagnostic_codes: aiParsed.generator_diagnostic_codes,
          generator_reason_unmapped: aiParsed.generator_reason_unmapped,
          generator_input_blocked: aiParsed.generator_input_blocked,
          ...(aiParsed.generator_input_blocked ? {
            send_state: data.send_state === 'no_send' ? 'no_send' : 'manual_context_required',
            manual_hold_reasons: [
              ...(Array.isArray(data.manual_hold_reasons) ? data.manual_hold_reasons : data.manual_hold_reasons ? [data.manual_hold_reasons] : []),
              aiParsed.generator_parse_status
            ]
          } : {}),
          order_group: orderGroup,
          project_key: projectKey,
          _en: en,
          _cn: cn,
          weak_candidate_message: needsEnforceRewrite ? en : '',
          needs_enforce_rewrite: needsEnforceRewrite
        }
      };
    })
    .filter(item => {
      const data = item.json || {};

      const projectKey = cleanupMessage(data.project_key);
      const orderGroup = cleanupMessage(data.order_group);

      if (!projectKey) return false;
      if (!orderGroup) return false;

      return true;
    })
    .map(item => {
      const data = item.json || {};

      const projectKey = cleanupMessage(data.project_key);
      const orderGroup = cleanupMessage(data.order_group);
      const en = normalizeMessageValue(data._en);
      const cn = en ? cleanupMessage(data._cn) || buildChineseGloss(en) : '';
      const telegramMessages = en
        ? [
            `【${projectKey}】

English:
${en}

中文翻译:
${cn || '（AI未输出中文翻译）'}`,
            en
          ]
        : [];

      return {
        json: {
          ...data,
          order_group: orderGroup,
          project_key: projectKey,
          ai_parsed: {
            ...(data.ai_parsed || {}),
            whatsapp_message: en
          },
          _en: en,
          _cn: cn,
          weak_candidate_message: en ? data.weak_candidate_message || '' : '',
          needs_enforce_rewrite: en ? data.needs_enforce_rewrite === true : false,
          telegram_messages: telegramMessages
        }
      };
    });
}

module.exports = async function (req, res) {
  if (req.method && req.method !== 'POST') {
    return res.status(405).json({
      error: true,
      message: 'Method not allowed'
    });
  }

  try {
    const inputItems = normalizeInputItems(req.body);
    const resultItems = formatTelegramMessageItems(inputItems);
    return res.status(200).json(resultItems);
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err.message || 'format-telegram-message failed'
    });
  }
};

// END_PINNED_HANDLER safe-v14-format-telegram-message-20260923
  },
  "safe-v14-filter-and-format-telegram-final-20260923": function (module) {
// BEGIN_PINNED_HANDLER safe-v14-filter-and-format-telegram-final-20260923

function has(v) {
  return (
    v !== undefined &&
    v !== null &&
    String(v).trim() !== '' &&
    String(v).toLowerCase() !== 'unknown'
  );
}

function pick(...arr) {
  for (const v of arr) {
    if (has(v)) return v;
  }
  return '';
}

function safe(v, d = '—') {
  return has(v) ? String(v).trim() : d;
}

function boolFlag(value) {
  if (value === true) return true;
  if (typeof value === 'string') {
    return ['true', 'yes', '1'].includes(value.trim().toLowerCase());
  }
  return false;
}

function list(v) {
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'unknown';
  if (typeof v === 'string') return v.trim() || 'unknown';
  return 'unknown';
}

function truncate(str, max = 3500) {
  const s = String(str || '').trim();
  return s.length > max ? s.slice(0, max) + '\n\n...(truncated)' : s;
}

// Empty-message fallback gate.
// Do not manufacture a generic re-engagement message here: repeated fallback
// copy is a quality issue and should be held for manual rewrite.
function generateFallbackMessage(customerName, hardNoSend) {
  return '';
}

function generateFallbackMessageCn(customerName, hardNoSend) {
  return '';
}

// Banned phrase detection — hard-coded regex since AI doesn't reliably follow prompt-level bans
const BANNED_PATTERNS = [
  { name: 'simplify_last', regex: /simplify\s+(my|our|the)\s+last\s+(point|message|interaction|chat|reply|exchange|response)/i },
  { name: 'summarize_last', regex: /summarize\s+(my|our|the)\s+last\s+(point|message|interaction)/i },
  { name: 'pick_up_where', regex: /pick\s+up\s+where\s+we\s+left\s+off/i },
  { name: 'catch_up_on', regex: /catch\s+up\s+on\s+(what\s+we|where\s+we|our|the\s+key)/i },
  { name: 'last_point', regex: /\b(my|our|the)\s+last\s+point\b/i },
  { name: 'last_interaction', regex: /\b(my|our|the)\s+last\s+interaction\b/i },
  { name: 'latest_models_vague', regex: /(the\s+latest|our\s+latest)\s+(equipment\s+)?(options|models|updates)(?!\s+(of|for|that|which|such))/i },
  { name: 'new_model_options_vague', regex: /(line\s+up|keep)\s+(the\s+)?new\s+model\s+options/i },
  { name: 'see_whats_available', regex: /see\s+what[''\u2019]?s\s+available/i },
  { name: 'make_informed_choice', regex: /make\s+(an|a)\s+informed\s+choice/i },
  { name: 'at_your_convenience', regex: /at\s+your\s+convenience/i },
  // 2026-04-23: defense against sparse-history fallback drift (4/22 batch 5/50)
  { name: 'circling_back', regex: /circling\s+back/i },
  { name: 'still_considering', regex: /still\s+considering/i },
  // Chinese chars in greeting (before first comma) — name-pollution defense
  { name: 'chinese_in_greeting', regex: /^[^,]*[\u4e00-\u9fff]/ }
];

function detectBannedPhrases(message) {
  if (!message || typeof message !== 'string') return [];
  const hits = [];
  for (const { name, regex } of BANNED_PATTERNS) {
    const match = message.match(regex);
    if (match) hits.push({ name, matched: match[0] });
  }
  return hits;
}

function compressSummary(text, maxLen = 400) {
  if (!text) return '信息不足';

  const cleaned = String(text)
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '信息不足';
  if (cleaned.length <= maxLen) return cleaned;

  const headLen = Math.min(220, Math.floor(maxLen * 0.65));
  const tailLen = Math.min(120, maxLen - headLen - 5);

  const head = cleaned.slice(0, headLen);
  const tail = cleaned.slice(-tailLen);

  return `${head} ... ${tail}`;
}

// Bounded Enforce decoder: diagnostics contain fixed codes, never response text.
function parseJsonSafe(raw) {
  if (typeof raw !== 'string') return { error: 'ENFORCE_TEXT_TYPE' };
  let text = raw.trim();
  if (!text) return { error: 'ENFORCE_EMPTY_TEXT' };
  if (text.startsWith('```')) {
    const fence = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
    if (!fence) return { error: 'ENFORCE_INVALID_FENCE' };
    text = fence[1].trim();
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: 'ENFORCE_INVALID_JSON' };
  }
}

// Explicit Parse1 response contract. No legacy body or Generator fallback.
const enforceContractField = 'safe_v14_enforce_v1';
const enforceResponseFields = [
  "content",
  "output",
  "output_text",
  "ai_parsed",
  "ai_output_parse_status",
  "whatsapp_message",
  "whatsapp_message_cn",
  "should_send",
  "refusal",
  "type",
  "finish_reason",
  "stop_reason",
  "status",
  "incomplete_details",
  "error",
  "hard_no_send",
  "has_not_now_signal",
  "not_now",
  "manual_context_required",
  "send_state",
  "enforce_status",
  "action",
  "reason"
];
const enforceSourceByItem = new WeakMap();
const contractObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const contractOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function selectEnforceContract(outer, inner) {
  const hasOuter = contractObject(outer) && contractOwn(outer, enforceContractField);
  const hasInner = contractObject(inner) && contractOwn(inner, enforceContractField);
  if (!hasOuter && !hasInner) return { error: 'ENFORCE_MISSING_OUTPUT' };
  const outerContract = hasOuter ? outer[enforceContractField] : undefined;
  const innerContract = hasInner ? inner[enforceContractField] : undefined;
  if (hasOuter && hasInner && JSON.stringify(outerContract) !== JSON.stringify(innerContract)) {
    return { error: 'ENFORCE_OUTPUT_SHAPE' };
  }
  const selected = hasOuter ? outerContract : innerContract;
  if (!contractObject(selected) || Object.keys(selected).length !== 3 ||
      !['schema_version', 'producer', 'response'].every(key => contractOwn(selected, key)) ||
      selected.schema_version !== 1 || selected.producer !== 'Parse Anthropic Output1' ||
      !contractObject(selected.response)) return { error: 'ENFORCE_OUTPUT_SHAPE' };
  const response = selected.response;
  if (Object.keys(response).some(key => !enforceResponseFields.includes(key)) ||
      !['ai_parsed', 'ai_output_parse_status', 'whatsapp_message', 'whatsapp_message_cn'].every(key => contractOwn(response, key)) ||
      !contractObject(response.ai_parsed) ||
      !['PASS_PARSED_JSON', 'HOLD_INVALID_JSON'].includes(response.ai_output_parse_status) ||
      typeof response.whatsapp_message !== 'string' || typeof response.whatsapp_message_cn !== 'string') {
    return { error: 'ENFORCE_OUTPUT_SHAPE' };
  }
  return { response };
}

function getEnforceParsed(item) {
  const source = enforceSourceByItem.get(item) || { error: 'ENFORCE_MISSING_OUTPUT' };
  if (source.error) return {
    whatsapp_message: '', whatsapp_message_cn: '', parse_status: source.error,
    source_shape: 'unknown', diagnostic_codes: [source.error], reason_codes: [],
    reason_unmapped: false, blocked_by_enforce: false, input_blocked: true
  };
  const current = source.response;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const code = value => typeof value === 'string'
    ? value.trim().toUpperCase().replace(/[ -]+/g, '_') : '';
  const candidates = [];
  const diagnostics = [];
  const add = value => { if (!diagnostics.includes(value)) diagnostics.push(value); };
  const reasonCodes = [];
  const blockingReasons = new Set([
    'NO_SEND', 'DO_NOT_SEND', 'SEND_STATE_NO_SEND', 'HARD_NO_SEND',
    'NOT_NOW', 'HAS_NOT_NOW_SIGNAL', 'MANUAL_CONTEXT_REQUIRED',
    'SEND_STATE_MANUAL_CONTEXT_REQUIRED', 'MY_TURN_REQUIRES_MANUAL_REPLY',
    'MISSING_CUSTOMER_CONTEXT', 'MISSING_SOURCE_CONTEXT',
    'MISSING_SUMMARY_WITHOUT_CONCRETE_ANCHOR', 'WEAK_IDENTITY_WITHOUT_CONCRETE_ANCHOR',
    'VERY_SHORT_CUSTOMER_CONTEXT_WITHOUT_ANCHOR',
    'ALTERNATE_ACTIVATION_REFUSED_NO_CONCRETE_SIGNAL', 'QUALITY_BLOCKED',
    'BLOCKED', 'HOLD', 'REFUSAL', 'REFUSED', 'REJECTED', 'REJECT'
  ]);
  const recognizedReasons = new Set([
    ...blockingReasons, 'EMPTY_MESSAGE', 'EMPTY_AI_MESSAGE', 'EMPTY_SKIP',
    'MISSING_CHINESE_REFERENCE', 'PASS', 'OK', 'APPROVED'
  ]);
  let reasonUnmapped = false;
  let blockedByEnforce = false;

  function inspectMetadata(value) {
    if (!object(value)) return;
    if (value.should_send === false || value.should_send === 'false') { blockedByEnforce = true; if (!reasonCodes.includes('DO_NOT_SEND')) reasonCodes.push('DO_NOT_SEND'); }
    if (own(value, 'refusal') && value.refusal !== null && value.refusal !== false && value.refusal !== '') add('ENFORCE_REFUSAL');
    if (code(value.type) === 'REFUSAL') add('ENFORCE_REFUSAL');
    if (code(value.finish_reason) === 'CONTENT_FILTER') add('ENFORCE_REFUSAL');
    if (code(value.stop_reason) === 'REFUSAL') add('ENFORCE_REFUSAL');
    if (code(value.stop_reason) === 'MAX_TOKENS') add('ENFORCE_TRUNCATED_OUTPUT');
    if (code(value.stop_reason) === 'PAUSE_TURN') add('ENFORCE_RESPONSE_NOT_COMPLETE');
    if (['LENGTH', 'MAX_TOKENS', 'MAX_OUTPUT_TOKENS'].includes(code(value.finish_reason))) add('ENFORCE_TRUNCATED_OUTPUT');
    if (code(value.status) === 'INCOMPLETE' || value.incomplete_details != null) add('ENFORCE_TRUNCATED_OUTPUT');
    if (['FAILED', 'CANCELLED', 'CANCELED', 'IN_PROGRESS', 'QUEUED'].includes(code(value.status))) add('ENFORCE_RESPONSE_NOT_COMPLETE');
    if (own(value, 'error') && value.error !== null && value.error !== false) add('ENFORCE_PROVIDER_ERROR');
    for (const key of ['hard_no_send', 'has_not_now_signal', 'not_now', 'manual_context_required']) {
      if (boolFlag(value[key])) {
        const reason = code(key);
        if (!reasonCodes.includes(reason)) reasonCodes.push(reason);
        blockedByEnforce = true;
      }
    }
    for (const key of ['send_state', 'enforce_status', 'status', 'action']) {
      const reason = code(value[key]);
      if (blockingReasons.has(reason)) {
        if (!reasonCodes.includes(reason)) reasonCodes.push(reason);
        blockedByEnforce = true;
      }
    }
    if (own(value, 'reason') && value.reason != null && value.reason !== '') {
      const reason = code(value.reason);
      if (recognizedReasons.has(reason)) {
        if (!reasonCodes.includes(reason)) reasonCodes.push(reason);
        if (blockingReasons.has(reason)) blockedByEnforce = true;
      } else {
        reasonUnmapped = true;
      }
    }
  }

  function collectContent(content, shape) {
    if (!Array.isArray(content)) { add('ENFORCE_CONTENT_SHAPE'); return; }
    for (const part of content) {
      if (!object(part)) { add('ENFORCE_CONTENT_SHAPE'); continue; }
      inspectMetadata(part);
      if (own(part, 'text')) {
        if (part.type != null && !['TEXT', 'OUTPUT_TEXT'].includes(code(part.type))) add('ENFORCE_CONTENT_TYPE');
        candidates.push({ value: part.text, shape });
      }
    }
  }

  inspectMetadata(current);
  // The merged row can retain upstream draft fields. A chosen Enforce envelope
  // is authoritative, even when malformed; never fall back to stale draft data.
  // The known Parse Anthropic node derives a one-text output wrapper from
  // original content[0].text. Inspect its complete original content so this
  // legacy wrapper cannot hide a second text or an explicit refusal block.
  // Live bb53fd Parse canonicalizes the first parsed object with JSON.stringify.
  // Reproduce only that exact, locally verified derivation to recognize its wrapper;
  // the complete original content still goes through the strict decoder below.
  const robustCanonicalText = (() => {
    if (current.ai_output_parse_status !== 'PASS_PARSED_JSON' || !object(current.ai_parsed) ||
        !Array.isArray(current.content) || !object(current.content[0]) || typeof current.content[0].text !== 'string') return null;
    const cleaned = current.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!cleaned) return null;
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (error) {
      const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch (innerError) { return null; }
    }
    if (!object(parsed)) return null;
    const canonical = JSON.stringify(parsed);
    return JSON.stringify(current.ai_parsed) === canonical ? canonical : null;
  })();
  // The same live parser leaves older output untouched on its explicit invalid
  // result. Recognize its exact empty shape so that stale output cannot win.
  const robustInvalidResult = current.ai_output_parse_status === 'HOLD_INVALID_JSON' &&
    object(current.ai_parsed) && Object.keys(current.ai_parsed).length === 2 &&
    current.ai_parsed.whatsapp_message === '' && current.ai_parsed.whatsapp_message_cn === '' &&
    current.whatsapp_message === '' && current.whatsapp_message_cn === '';
  const derivedOutput = Array.isArray(current.content) && Array.isArray(current.output) && current.output.length === 1 &&
    object(current.output[0]) && Object.keys(current.output[0]).length === 1 && Array.isArray(current.output[0].content) && current.output[0].content.length === 1 &&
    object(current.output[0].content[0]) && Object.keys(current.output[0].content[0]).length === 1 &&
    object(current.content[0]) && typeof current.content[0].text === 'string' &&
    (current.output[0].content[0].text === current.content[0].text ||
      (robustCanonicalText !== null && current.output[0].content[0].text === robustCanonicalText));
  if (['PASS_PARSED_JSON', 'HOLD_INVALID_JSON'].includes(current.ai_output_parse_status) && !derivedOutput && !robustInvalidResult) add('ENFORCE_OUTPUT_SHAPE');
  if (derivedOutput || robustInvalidResult) {
    collectContent(current.content, 'content_text');
  } else if (own(current, 'output') && current.output !== undefined) {
    if (!Array.isArray(current.output)) add('ENFORCE_OUTPUT_SHAPE');
    else for (const output of current.output) {
      if (!object(output)) { add('ENFORCE_OUTPUT_SHAPE'); continue; }
      inspectMetadata(output);
      if (own(output, 'content')) collectContent(output.content, 'output_content_text');
      else if (code(output.type) !== 'REASONING') add('ENFORCE_OUTPUT_SHAPE');
    }
  } else if (own(current, 'content') && current.content !== undefined) {
    collectContent(current.content, 'content_text');
  } else if (own(current, 'output_text') && current.output_text !== undefined) {
    candidates.push({ value: current.output_text, shape: 'output_text' });
  } else if (own(current, 'whatsapp_message')) {
    add('ENFORCE_DIRECT_OBJECT_NOT_SUPPORTED');
  }
  if (!candidates.length) add('ENFORCE_MISSING_OUTPUT');
  if (candidates.length > 1) add('ENFORCE_AMBIGUOUS_OUTPUT');

  let parsed;
  if (candidates.length === 1) {
    const candidate = candidates[0];
    const result = parseJsonSafe(candidate.value);
    if (result.error) add(result.error);
    else if (!object(result.value)) add('ENFORCE_OBJECT_REQUIRED');
    else {
      parsed = result.value;
      inspectMetadata(parsed);
      if (!own(parsed, 'whatsapp_message')) add('ENFORCE_MESSAGE_FIELD_MISSING');
      else if (typeof parsed.whatsapp_message !== 'string') add('ENFORCE_MESSAGE_TYPE');
      else if (!parsed.whatsapp_message.trim() || parsed.whatsapp_message.trim().toLowerCase() === 'unknown') add('ENFORCE_EXPLICIT_EMPTY');
      if (own(parsed, 'whatsapp_message_cn') && typeof parsed.whatsapp_message_cn !== 'string') add('ENFORCE_CHINESE_TYPE');
    }
  }
  const inputBlocked = diagnostics.length > 0 || blockedByEnforce;
  const rootReason = diagnostics.length ? diagnostics[0] : blockedByEnforce ? 'ENFORCE_EXPLICIT_HOLD' : 'PARSED_OK';
  return {
    whatsapp_message: !inputBlocked && parsed ? parsed.whatsapp_message.trim() : '',
    whatsapp_message_cn: !inputBlocked && parsed && typeof parsed.whatsapp_message_cn === 'string' ? parsed.whatsapp_message_cn.trim() : '',
    parse_status: rootReason,
    source_shape: candidates.length === 1 ? candidates[0].shape : 'unknown',
    diagnostic_codes: diagnostics,
    reason_codes: reasonCodes,
    reason_unmapped: reasonUnmapped,
    blocked_by_enforce: blockedByEnforce,
    input_blocked: inputBlocked
  };
}


function getOriginalAiParsed(current) {
  if (current.ai_parsed && typeof current.ai_parsed === 'object') {
    return current.ai_parsed;
  }
  return {};
}

function isEmptyMessage(msg) {
  return !has(msg);
}

function normalizeText(msg) {
  return String(msg || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasHighRiskPattern(msg) {
  const text = normalizeText(msg);

  const bannedPatterns = [
    'just checking',
    'checking in',
    'any update',
    'following up',
    'circling back',
    'still considering',
    'let me know',
    'still interested',
    'would love to help',
    'feel free to',
    'looking forward to hearing from you',
    'full catalog',
    'all the options',
    'all options available',
    'full accessories list',
    'material preference',
    'share more details',
    'more details',
    'setup details',
    'deposit now',
    'prepare the pi',
    '30% deposit',
    'lock in the current pricing',
    'secure the pricing',
    'does that work for you',
    'would that work for you',
    'is that okay for you',
    'match the cheaper options',
    'match the price',
    'offer something better',
    'recommend suitable',
    'based on your needs',
    'based on your current plan',
    'narrow down the options',
    'most suitable options',
    'see all options available'
  ];

  return bannedPatterns.some(p => text.includes(p));
}

function hasTooManyQuestions(msg) {
  const matches = String(msg || '').match(/\?/g);
  return matches && matches.length > 1;
}

function hasOrRisk(msg) {
  return /\bor\b/i.test(String(msg || ''));
}

function hasDecisionRisk(msg) {
  return /\bdecide\b|\bdecision\b|\bpurchase\b|\bcompare\b|\bpreference\b|\bwhich\b|\bbetter\b|\bwork for you\b|\bokay for you\b/i.test(String(msg || ''));
}

function hasGenericRisk(msg) {
  const text = normalizeText(msg);

  const genericPatterns = [
    'help with that',
    'help you with that',
    'help with this',
    'help you with this',
    'make this easier',
    'do that for you',
    'do this for you',
    'help you decide',
    'help clarify everything',
    'check if we can',
    'recommend options'
  ];

  return genericPatterns.some(p => text.includes(p));
}

function hasWeakAnchorRisk(msg) {
  const text = normalizeText(msg);
  if (/\b(?:ar|mr|or|fr|mg|pr|pc|bs)\d{3}\b/i.test(String(msg || ''))) {
    return false;
  }

  const anchorPatterns = [
    'pricing',
    'price range',
    'quote',
    'setup',
    'model',
    'models',
    'reformer',
    'reformers',
    'ar010',
    'ar011',
    'ar012',
    'bs001',
    'pk001',
    'sample',
    'october',
    'houston',
    '77044',
    'warranty',
    'shipping',
    'landed cost',
    'postal code',
    'zip code',
    'production',
    'payment',
    'invoice'
  ];

  return !anchorPatterns.some(p => text.includes(p));
}

function normalizeForSimilarity(msg) {
  return String(msg || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9$]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForSimilarity(msg) {
  const stopWords = new Set([
    'the', 'and', 'for', 'you', 'your', 'that', 'this', 'with', 'can', 'our',
    'here', 'want', 'send', 'share', 'see', 'what', 'good', 'fit', 'just',
    'have', 'will', 'would', 'could', 'please', 'thanks', 'thank'
  ]);

  return normalizeForSimilarity(msg)
    .split(' ')
    .filter(token => token.length > 2 && !stopWords.has(token));
}

function similarityScore(a, b) {
  const aTokens = new Set(tokenizeForSimilarity(a));
  const bTokens = new Set(tokenizeForSimilarity(b));
  if (!aTokens.size || !bTokens.size) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  return overlap / Math.min(aTokens.size, bTokens.size);
}

function looksTooSimilar(candidate, previous) {
  const a = normalizeForSimilarity(candidate);
  const b = normalizeForSimilarity(previous);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 45 && b.includes(a)) return true;
  if (b.length >= 45 && a.includes(b)) return true;
  return similarityScore(a, b) >= 0.72;
}

function parseMaybeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function historyTextsFrom(value) {
  return parseMaybeJsonArray(value)
    .map(item => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      return item.ai_message || item.whatsapp_message || item.message || item.text || '';
    })
    .filter(text => has(text));
}

function getDoNotRepeatList(current) {
  const direct = current.forbidden_repeat_zone?.do_not_repeat;
  const payload = current.reactivation_ai_payload?.constraints?.do_not_repeat;
  const core = current.reactivation_v6_core?.forbidden_repeat_zone?.do_not_repeat;
  const values = [direct, payload, core].find(Array.isArray);
  return Array.isArray(values) ? values : [];
}

function getAlreadyAskedQuestions(current) {
  const direct = current.forbidden_repeat_zone?.already_asked_questions;
  const core = current.reactivation_v6_core?.forbidden_repeat_zone?.already_asked_questions;
  const values = [direct, core].find(Array.isArray);
  return Array.isArray(values) ? values : [];
}

function detectRepeatQualityHits(message, current, usedFallback) {
  const hits = [];
  const text = normalizeText(message);
  const doNotRepeat = getDoNotRepeatList(current);
  const priorTexts = [
    current.last_my_message,
    ...historyTextsFrom(current.previous_activation_messages),
    ...historyTextsFrom(current.prior_activation_messages),
    ...historyTextsFrom(current.recent_activation_messages),
    ...historyTextsFrom(current.previous_ai_messages)
  ].filter(value => has(value));

  for (const previous of priorTexts) {
    if (looksTooSimilar(message, previous)) {
      hits.push({ name: 'repeat_prior_message', matched: String(previous).slice(0, 140) });
      break;
    }
  }

  if (usedFallback && (current.message_count || current.last_my_message || current.last_customer_message)) {
    hits.push({ name: 'fallback_used_with_history', matched: 'fallback template used despite existing history' });
  }

  if (/most popular studio setup options|studio setup options|good fit/i.test(message)) {
    hits.push({ name: 'generic_studio_setup_fallback', matched: 'most popular studio setup options' });
  }

  if (doNotRepeat.includes('repeat_same_question')) {
    const alreadyAsked = getAlreadyAskedQuestions(current);
    const candidateQuestion = (String(message).match(/[^?？.!。！]*[?？]/g) || []).join(' ');
    if (candidateQuestion && alreadyAsked.some(question => looksTooSimilar(candidateQuestion, question))) {
      hits.push({ name: 'repeat_same_question', matched: candidateQuestion.slice(0, 140) });
    }
  }

  if (!text) {
    hits.push({ name: 'empty_message', matched: 'empty message' });
  }

  return hits;
}

function assessCandidateQuality(message, current, usedFallback) {
  const emptyMessage = isEmptyMessage(message);
  const highRisk = hasHighRiskPattern(message);
  const multiQuestionRisk = hasTooManyQuestions(message);
  const orRisk = hasOrRisk(message);
  const decisionRisk = hasDecisionRisk(message);
  const genericRisk = hasGenericRisk(message);
  const weakAnchorRisk = hasWeakAnchorRisk(message);
  const repeatQualityHits = detectRepeatQualityHits(message, current, usedFallback);
  const deterministicQualityHits = [
    ...detectBannedPhrases(message),
    ...(highRisk ? [{ name: 'high_risk_pattern', matched: 'high-risk or banned follow-up pattern' }] : []),
    ...(genericRisk ? [{ name: 'generic_expression', matched: 'generic expression' }] : []),
    ...(weakAnchorRisk && !hasConcreteContextAnchor(current) ? [{ name: 'weak_anchor', matched: 'weak anchor without concrete context' }] : []),
    ...repeatQualityHits
  ];
  const bannedHits = uniqueHits(deterministicQualityHits);
  const qualityBlock =
    highRisk ||
    genericRisk ||
    (weakAnchorRisk && !hasConcreteContextAnchor(current)) ||
    repeatQualityHits.length > 0 ||
    bannedHits.length > 0;

  return {
    emptyMessage,
    highRisk,
    multiQuestionRisk,
    orRisk,
    decisionRisk,
    genericRisk,
    weakAnchorRisk,
    repeatQualityHits,
    bannedHits,
    qualityBlock
  };
}

function cleanDisplayName(raw) {
  if (!raw) return '';
  const value = String(raw).trim();
  if (
    !value ||
    value === '未命名客户' ||
    /^hi\s+there$/i.test(value) ||
    /^there$/i.test(value) ||
    /^\+?\d[\d\s().-]*$/.test(value)
  ) return '';

  const cleaned = value
    .replace(/\b(?:ar|mr|or|fr|mg|pr|pc|bs)\d{3}\b/gi, ' ')
    .replace(/\d+台/g, ' ')
    .replace(/[\u4e00-\u9fff]+/g, ' ')
    .replace(/[（()）]+/g, ' ')
    .replace(/\d{1,4}[\.\-\/]\d{1,2}[\.\-\/]?\d{0,2}日?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const match = cleaned.match(/[A-Za-z][A-Za-z.'-]*/);
  return match ? match[0] : '';
}

function displayNameForMessage(current, fallbackName) {
  const name = cleanDisplayName(
    current.customer_name_for_ai ||
    current.customer_name_clean ||
    fallbackName ||
    current.customer_name ||
    current.project_key
  );
  return name || 'Hi there';
}

function shouldRewriteToAlternateActivation(message) {
  // 2026-07-08: empty message must stay empty and route to manual review
  // (enforce_status=empty_skip). Do not manufacture an alternate activation
  // just to guarantee output.
  if (!has(message)) return false;
  return /most popular studio setup options|studio setup options|good fit|short comparison checklist|main differences without going through the whole catalog|short starting-point guide|something concrete to review|next steps from confirmation to production and delivery|calculate the landed cost step by step/i.test(message);
}

function textFromMessages(messages) {
  if (!Array.isArray(messages)) return '';
  return messages
    .map(message => {
      if (!message || typeof message !== 'object') return '';
      return message.message || message.text || '';
    })
    .filter(value => has(value))
    .join(' ');
}

function contextText(current) {
  return [
    current.last_customer_message,
    current.last_my_message,
    current.recent_conversation,
    current.cleaned_full_conversation,
    current.conversation_core,
    current.timeline_summary,
    current.dated_history_summary,
    textFromMessages(current.messages),
    textFromMessages(current.recent_messages)
  ].filter(value => has(value)).join(' ');
}

function uniqueMatches(text, regex, limit = 3) {
  const matches = [];
  const seen = new Set();
  const source = String(text || '');
  let match;
  while ((match = regex.exec(source)) !== null) {
    const value = (match[1] || match[0] || '').trim();
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      matches.push(value);
    }
    if (matches.length >= limit) break;
  }
  return matches;
}

function extractContextSignals(current) {
  const fullText = contextText(current);
  const lastMy = String(current.last_my_message || '');
  const lastCustomer = String(current.last_customer_message || '');
  const priorityText = [lastCustomer, lastMy, fullText].filter(value => has(value)).join(' ');

  return {
    text: fullText,
    lastMy,
    lastCustomer,
    models: uniqueMatches(priorityText, /\b(?:AR|MR|OR|FR|MG|PR|PC|BS)\d{3}\b/gi, 4),
    prices: uniqueMatches(priorityText, /(?:USD\s*)?\$[\d,]+(?:\.\d+)?|\bUSD\s*[\d,]+(?:\.\d+)?/gi, 4),
    quantities: uniqueMatches(priorityText, /\b\d+\s*[–-]\s*\d+\s*(?:units?|pcs?|pieces?|reformers?|towers?)\b|\b\d+\s*(?:units?|pcs?|pieces?|reformers?|towers?)\b/gi, 3),
    zips: uniqueMatches(priorityText, /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b\d{5}(?:-\d{4})?\b/gi, 2),
    countries: uniqueMatches(priorityText, /\b(?:Philippines|Canada|USA|US|Australia|New Zealand|Sri Lanka)\b/gi, 2)
  };
}

function normalizeReasonList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeReasonList(parsed);
    } catch {
      // Fall through to comma splitting.
    }
    return trimmed.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [];
}

function hasUsableConversationSummaryValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length >= 40 && !['null', '{}', '[]', '信息不足'].includes(trimmed);
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function hasUsableRuntimeConversationSummary(current) {
  const summary = current.runtime_conversation_summary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return false;
  const customerCount = Number(summary.customer_message_count);
  const sellerCount = Number(summary.seller_message_count);
  const messageCount = Number(summary.message_count);

  if (summary.source === 'full_history_runtime') {
    return customerCount > 0 && sellerCount > 0 && messageCount >= 2;
  }

  return (
    summary.source === 'seller_history_runtime' &&
    customerCount === 0 &&
    sellerCount >= 2 &&
    messageCount >= 2 &&
    hasConcreteContextAnchor(current)
  );
}

function hasConcreteContextAnchor(current) {
  const signals = extractContextSignals(current);
  if (signals.models.length || signals.prices.length || signals.quantities.length || signals.zips.length || signals.countries.length) {
    return true;
  }

  return /\b(?:catalog|brochure|pdf|photos?|pictures?|videos?|warranty|shipping|freight|delivery|ddp|invoice|pi|deposit|payment|quote|pricing|price|october|studio|distributor|dealer|reseller)\b/i
    .test(signals.text);
}

function hasWeakIdentity(current) {
  const raw = String(current.customer_name_for_ai || current.customer_name_clean || current.customer_name || current.project_key || '').trim();
  if (!raw) return true;
  if (/^hi\s+there$/i.test(raw) || /^there$/i.test(raw)) return true;
  if (/^\+?\d[\d\s().-]{6,}$/.test(raw)) return true;
  return /^(unknown|test|facebook|facebook business|meta|meta business|未命名客户)$/i.test(raw);
}

function hasNoHistoryPermissionCheck(current) {
  const sendState = String(
    current.send_state || current.reactivation_ai_payload?.decision?.send_state || ''
  ).trim();
  const anchor = String(
    current.primary_reply_anchor ||
    current.anchor_object ||
    current.reactivation_ai_payload?.decision?.anchor_object ||
    ''
  ).trim();
  const reason = String(
    current.reactivation_ai_payload?.decision?.best_trigger_reason ||
    current.reactivation_decision_basis?.best_trigger_reason ||
    ''
  ).trim();
  const allowedTriggers = [
    current.allowed_micro_triggers,
    current.reactivation_ai_payload?.decision?.allowed_micro_triggers,
    current.reactivation_v6_core?.allowed_micro_triggers
  ].find(Array.isArray) || [];
  const stage = normalizeText(current.stage);
  const hasMessageEvidence = [
    current.last_customer_message,
    current.last_my_message,
    current.customer_only_text,
    current.customer_recent_only_text,
    current.cleaned_full_conversation,
    textFromMessages(current.messages),
    textFromMessages(current.recent_messages)
  ].some(value => has(value));
  const hasRuntimeSummary = Boolean(
    current.runtime_conversation_summary &&
    typeof current.runtime_conversation_summary === 'object' &&
    Object.keys(current.runtime_conversation_summary).length
  );

  return (
    sendState === 'rewrite_needed' &&
    anchor === 'pilates_equipment_project_status' &&
    reason === 'no_history_permission_check_only' &&
    allowedTriggers.includes('confirm_current_pilates_project_here') &&
    ['engaged', 'outreach'].includes(stage) &&
    !hasWeakIdentity(current) &&
    !hasRuntimeSummary &&
    !hasMessageEvidence
  );
}

// Generator failures survive later merges and a nonempty Enforce response.
// Only the fixed contract is interpreted; unknown status text is never copied
// into hold diagnostics. Absence remains compatible with pre-contract rows.
function getGeneratorHoldReasons(current) {
  const failures = new Set([
    'GENERATOR_AMBIGUOUS_OUTPUT', 'GENERATOR_CHINESE_TYPE',
    'GENERATOR_CONTENT_SHAPE', 'GENERATOR_CONTENT_TYPE',
    'GENERATOR_DIRECT_OBJECT_NOT_SUPPORTED', 'GENERATOR_EMPTY_TEXT',
    'GENERATOR_EXPLICIT_EMPTY', 'GENERATOR_EXPLICIT_HOLD',
    'GENERATOR_INVALID_FENCE', 'GENERATOR_INVALID_JSON',
    'GENERATOR_MESSAGE_FIELD_MISSING', 'GENERATOR_MESSAGE_TYPE',
    'GENERATOR_MISSING_OUTPUT', 'GENERATOR_OBJECT_REQUIRED',
    'GENERATOR_OUTPUT_SHAPE', 'GENERATOR_PROVIDER_ERROR',
    'GENERATOR_REFUSAL', 'GENERATOR_RESPONSE_NOT_COMPLETE',
    'GENERATOR_TEXT_TYPE', 'GENERATOR_TRUNCATED_OUTPUT'
  ]);
  const reasons = [];
  if (boolFlag(current.generator_input_blocked)) reasons.push('GENERATOR_INPUT_BLOCKED');
  if (Object.prototype.hasOwnProperty.call(current, 'generator_parse_status')) {
    const status = current.generator_parse_status;
    if (failures.has(status)) reasons.push(status);
    else if (status !== 'PARSED_OK') reasons.push('GENERATOR_STATUS_UNKNOWN');
  }
  return reasons;
}

function getManualHoldReasons(current) {
  const directReasons = [
    ...normalizeReasonList(current.manual_hold_reasons),
    ...normalizeReasonList(current.reactivation_ai_payload?.decision?.manual_hold_reasons),
    ...normalizeReasonList(current.reactivation_ai_payload?.stop_point?.manual_hold_reasons),
    ...normalizeReasonList(current.reactivation_decision_basis?.manual_hold_reasons),
    ...normalizeReasonList(current.reactivation_v6_core?.manual_hold_reasons)
  ];

  const reasons = [...directReasons];
  const sendState = String(current.send_state || current.reactivation_ai_payload?.decision?.send_state || '').trim();
  const hardNoSend = boolFlag(current.hard_no_send);
  const hasNotNowSignal = boolFlag(current.has_not_now_signal);
  const isMyTurnToReply = boolFlag(current.is_my_turn_to_reply);
  const concreteAnchor = hasConcreteContextAnchor(current);
  const runtimeSummary = hasUsableRuntimeConversationSummary(current);
  const noHistoryPermissionCheck = hasNoHistoryPermissionCheck(current);
  const lastCustomer = String(current.last_customer_message || '').trim();
  const customerText = [
    current.customer_only_text,
    current.customer_recent_only_text,
    textFromMessages(current.messages),
    textFromMessages(current.recent_messages)
  ].filter(value => has(value)).join(' ').trim();

  if (hardNoSend) reasons.push('hard_no_send');
  if (hasNotNowSignal) reasons.push('has_not_now_signal');
  if (sendState === 'no_send') reasons.push('send_state_no_send');
  if (sendState === 'manual_context_required') reasons.push('send_state_manual_context_required');
  if (isMyTurnToReply) reasons.push('my_turn_requires_manual_reply');
  if (!lastCustomer && !customerText && !runtimeSummary && !noHistoryPermissionCheck) {
    reasons.push('missing_customer_context');
  }
  if (lastCustomer && lastCustomer.length < 20 && customerText.length < 80 && !concreteAnchor) {
    reasons.push('very_short_customer_context_without_anchor');
  }
  if (
    !hasUsableConversationSummaryValue(current.conversation_summary) &&
    !runtimeSummary &&
    !concreteAnchor &&
    !noHistoryPermissionCheck
  ) {
    reasons.push('missing_summary_without_concrete_anchor');
  }
  if (hasWeakIdentity(current) && !concreteAnchor) {
    reasons.push('weak_identity_without_concrete_anchor');
  }

  return [...new Set(reasons)];
}

function joinHumanList(values, fallback) {
  const arr = (values || []).filter(value => has(value));
  if (!arr.length) return fallback;
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
}

function objectFromSignals(signals, fallback = 'Reformer setup') {
  const modelPart = joinHumanList(signals.models, '');
  const quantityPart = joinHumanList(signals.quantities, '');
  if (modelPart && quantityPart) {
    const compactQuantity = quantityPart.replace(/\s+units?\b/i, '-unit');
    return `${compactQuantity} ${modelPart} setup`;
  }
  if (modelPart) return modelPart;
  if (quantityPart) return `${quantityPart} Reformer setup`;
  return fallback;
}

function objectForChinese(object) {
  if (!has(object)) return 'Reformer 配置';
  if (object === 'the models we discussed') return '之前讨论的型号';
  return object;
}

function placeForSentence(place) {
  if (!has(place)) return 'your delivery area';
  if (/^(Philippines|USA|US|United States|UK|UAE)$/i.test(place)) return `the ${place}`;
  return place;
}

function withHumanCta(prefix, body) {
  return `${prefix}, ${body}`;
}

function buildAlternateActivationMessage(current, customerName) {
  // 2026-09-23: never replace customer-specific copy with the photo, shipping,
  // quote, or model templates. Repetition and invalid drafts retain their hold.
  return null;
}

function buildEvidenceLimitedRecoveryMessage(current, customerName) {
  if (
    boolFlag(current.hard_no_send) ||
    boolFlag(current.has_not_now_signal) ||
    boolFlag(current.is_my_turn_to_reply)
  ) {
    return null;
  }

  if (hasNoHistoryPermissionCheck(current)) {
    const name = displayNameForMessage(current, customerName);
    const prefix = name === 'Hi there' ? 'Hi there' : name;
    return {
      en: `${prefix}, are you currently working on a Pilates Reformer project? If yes, I can help with the next step here.`,
      cn: `${prefix}，你目前是否正在推进普拉提 Reformer 项目？如果是，我可以在这里协助你处理下一步。`
    };
  }

  if (hasUsableRuntimeConversationSummary(current)) {
    return buildAlternateActivationMessage(current, customerName);
  }

  return null;
}

function synthesizeChineseReference(message) {
  if (!has(message)) return '';
  const text = String(message).trim();
  const nameMatch = text.match(/^([^,]+),\s+/);
  const name = nameMatch ? nameMatch[1].trim() : '';
  const cnName = name && name !== 'Hi there' ? `${name}，` : '';

  const orderMatch = text.match(/put together the unit pricing and delivery timeline for your (.+?) so you can plan the resale rollout/i);
  if (orderMatch) {
    return `${cnName}我可以整理你这笔 ${orderMatch[1].trim()} 的单价和交付时间线，这样你可以规划后续转售推进——要我发在这里吗？`;
  }

  if (/outline the next steps from confirmation to production and delivery/i.test(text)) {
    return `${cnName}我可以整理从确认到生产和交付的下一步流程，这样你能清楚看到订单会如何推进——要我发在这里吗？`;
  }

  if (/short comparison checklist/i.test(text)) {
    return `${cnName}我可以发一份简短对比清单，这样你不用重新看完整目录，也能快速核对主要差异——要我发在这里吗？`;
  }

  if (/calculate the landed cost step by step/i.test(text)) {
    return `${cnName}我可以一步步说明我们如何计算落地成本，这样你在提供地址信息前就能先了解最终配送价格受哪些因素影响——要我发在这里吗？`;
  }

  if (/starting-point guide for choosing the right Pilates reformer setup/i.test(text)) {
    return `${cnName}我可以发一份选择合适普拉提床配置的简短入门指南，这样你可以先看一个具体方向——要我发在这里吗？`;
  }

  if (/shipping and setup works for the Philippines/i.test(text) || /from delivery to assembly/i.test(text)) {
    return `${cnName}我可以简单说明发货和安装/组装在菲律宾这边是怎么进行的，这样你可以清楚了解从送达到组装具体涉及哪些内容——要我发在这里吗？`;
  }

  return '';
}

function hasIncompleteChineseReference(value) {
  if (!has(value)) return true;
  const text = String(value).trim();
  if (text.includes('未提供中文对照')) return true;
  if (text.includes('相关选项') || text.includes('这一步需要看的重点内容')) return true;
  return !/[\u4e00-\u9fff]/.test(text);
}

function sanitizeCustomerGreeting(message, current, fallbackName) {
  if (!has(message)) return message;
  const text = String(message).trim();
  const commaIndex = text.indexOf(',');
  if (commaIndex < 0 || commaIndex > 80) return text;

  const greeting = text.slice(0, commaIndex).trim();
  const rest = text.slice(commaIndex + 1).trimStart();
  if (!greeting || !rest) return text;

  const hasDirtyGreeting =
    /[\u4e00-\u9fff]/.test(greeting) ||
    /\d+台/.test(greeting) ||
    /\b(?:ar|mr|or|fr|mg|pr|pc|bs)\d{3}\b/i.test(greeting) ||
    /^\+?\d[\d\s().-]*$/.test(greeting);

  if (!hasDirtyGreeting) return text;

  const cleanName = displayNameForMessage(current, fallbackName);
  return `${cleanName}, ${rest}`;
}

function uniqueHits(hits) {
  const seen = new Set();
  const out = [];
  for (const hit of hits) {
    const key = `${hit.name}:${hit.matched || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

const zh = {
  stage: v => ({
    outreach: '初步触达',
    engaged: '已互动',
    evaluating: '评估中',
    price: '询价阶段',
    ready: '准备成交'
  }[v] || safe(v, '未知')),

  priority: v => ({
    high: '高',
    medium: '中',
    low: '低'
  }[v] || '未定义'),

  status: v => ({
    waiting_for_me: '等待我方回复',
    waiting_for_customer: '等待客户回复',
    open: '进行中'
  }[v] || '未定义'),

  intent: v => ({
    high: '高',
    medium: '中',
    low: '低'
  }[v] || '未知'),

  purchase: v => ({
    information_gathering: '信息收集',
    selection: '选型阶段',
    pricing: '价格确认',
    closing: '成交推进'
  }[v] || '未知'),

  customer: v => ({
    studio_owner: '工作室客户',
    distributor_or_reseller: '经销/分销',
    end_user: '终端用户',
    commercial_facility: '商业机构',
    small_business_operator: '小型经营者',
    individual_practitioner: '个人从业者',
    commercial_buyer: '商业采购客户'
  }[v] || '未知')
};

function normalizeInputItems(body) {
  const rawItems = Array.isArray(body) ? body : [body || {}];
  return rawItems.map(item => {
    const outer = contractObject(item) ? item : {};
    const inner = contractObject(outer.json) ? outer.json : null;
    const normalized = { json: { ...(inner || outer) } };
    // This response envelope is transport-only; do not duplicate it into the
    // downstream CN prompt, review payload, or stored context via ...current.
    delete normalized.json[enforceContractField];
    enforceSourceByItem.set(normalized, selectEnforceContract(outer, inner));
    return normalized;
  });
}


function filterAndFormatTelegramFinalItems(items) {
  const out = [];

  for (const item of items) {
    const current = item.json || {};

    const aiParsed = getOriginalAiParsed(current);
    const enforceParsed = getEnforceParsed(item);

    const projectKey = pick(current.project_key, aiParsed.project_key, '未命名客户');
    const customerName = pick(current.customer_name, aiParsed.customer_name, projectKey);

    const stage = pick(current.stage, aiParsed.stage);
    const priority = pick(current.follow_up_priority, aiParsed.follow_up_priority);
    const status = pick(current.status, aiParsed.status);

    const customerType = pick(current.customer_type, aiParsed.customer_type);
    const intent = pick(current.intent_level, aiParsed.intent_level);
    const purchaseStage = pick(current.purchase_stage, aiParsed.purchase_stage);

    const product = list(pick(current.product_interest, aiParsed.product_interest));
    const quantity = list(pick(current.quantity_signal, aiParsed.quantity_signal));
    const concerns = list(pick(current.concerns, aiParsed.concerns));
    const signals = list(pick(current.key_signals, aiParsed.key_signals));

    const lastCustomerTime = safe(
      pick(current.last_customer_message_time, current.last_customer_message_time_normalized),
      'unknown'
    );

    const lastMyTime = safe(
      pick(current.last_my_message_time, current.last_my_message_time_normalized),
      'unknown'
    );

    const gap = safe(current.last_customer_gap_hint, '—');

    const blocker = safe(
      pick(current.current_blocker, aiParsed.current_blocker),
      '信息不足'
    );

    const strategy = pick(
      current.strategy_direction,
      aiParsed.selected_strategy,
      'unknown'
    );

    const angle = safe(
      pick(current.reply_angle, aiParsed.why_this_strategy),
      '信息不足'
    );

    const focus = safe(
      pick(current.follow_up_focus, aiParsed.best_reply_trigger),
      '信息不足'
    );

    const summary = safe(
      pick(
        aiParsed.conversation_summary,
        current.dated_history_summary,
        current.timeline_summary,
        current.conversation_summary,
        current.runtime_conversation_summary?.display_text,
        current.conversation_core
      ),
      '信息不足'
    );

    const shortSummary = compressSummary(summary, 400);

    const customerSignal = safe(
      pick(aiParsed.customer_signal, current.customer_signal, current.key_signals),
      '信息不足'
    );

    const state = safe(
      pick(aiParsed.conversation_state, current.conversation_state, current.timeline_conversation_status),
      '信息不足'
    );

    const reasoning = safe(
      pick(aiParsed.reasoning_summary, angle),
      '信息不足'
    );

    const confidence = safe(
      pick(aiParsed.confidence, current.confidence),
      '中'
    );

    const aiSummary = safe(aiParsed.analysis_text, '未输出');

    let finalMessage = safe(enforceParsed.whatsapp_message, '');

    // English and Chinese must come from the same authoritative response.
    // Old draft fields and fixed glosses cannot supply a missing translation.
    let finalMessageCn = safe(enforceParsed.whatsapp_message_cn, '');

    // Invalid, rejected, or empty Enforce output is never replaced by recovery copy.
    const usedFallback = false;
    const usedEvidenceLimitedRecovery = false;

    const targetReply = safe(aiParsed.target_reply, '未输出');
    const hardNoSend = boolFlag(current.hard_no_send);
    const hasNotNowSignal = boolFlag(current.has_not_now_signal);
    const manualHoldReasons = [...new Set([
      ...getManualHoldReasons(current),
      ...getGeneratorHoldReasons(current),
      ...(enforceParsed.input_blocked ? [enforceParsed.parse_status, ...enforceParsed.reason_codes] : [])
    ])];

    // Keep the authoritative Enforce copy; do not substitute fixed templates.
    const usedAlternateActivation = false;

    finalMessage = sanitizeCustomerGreeting(finalMessage, current, customerName);

    const quality = assessCandidateQuality(finalMessage, current, usedFallback);
    const usedRepeatSafeRewrite = false;

    const {
      emptyMessage,
      highRisk,
      multiQuestionRisk,
      orRisk,
      decisionRisk,
      genericRisk,
      weakAnchorRisk,
      repeatQualityHits,
      bannedHits,
      qualityBlock
    } = quality;

    const missingChineseReference = hasIncompleteChineseReference(finalMessageCn);
    if (missingChineseReference && !manualHoldReasons.includes('MISSING_CHINESE_REFERENCE')) {
      manualHoldReasons.push('MISSING_CHINESE_REFERENCE');
    }
    const qualityIssueHits = uniqueHits([
      ...bannedHits,
      ...enforceParsed.diagnostic_codes.map(reason => ({ name: 'enforce_input', matched: reason })),
      ...enforceParsed.reason_codes.filter(reason => !['PASS', 'OK', 'APPROVED'].includes(reason)).map(reason => ({ name: 'enforce_reason', matched: reason })),
      ...manualHoldReasons.map(reason => ({ name: 'manual_hold', matched: reason }))
    ]);
    const shouldBlock = manualHoldReasons.length > 0 || emptyMessage || qualityBlock;

    if (shouldBlock) {
      finalMessage = '';
      finalMessageCn = '';
    }

    const multiRisk = multiQuestionRisk || orRisk ? '高' : '低';
    const thinkRisk = decisionRisk ? '高' : '低';

    const enforceStatus = manualHoldReasons.length > 0
      ? 'manual_context_required'
      : emptyMessage
        ? 'empty_skip'
        : qualityBlock
          ? 'quality_blocked'
          : usedFallback
            ? 'fallback_used'
            : 'pass';

    const analysisText = truncate([
      `客户名称：${customerName}`,
      '',
      `阶段：${zh.stage(stage)} ｜ 优先级：${zh.priority(priority)} ｜ 状态：${zh.status(status)}`,
      '',
      '客户分析：',
      `客户类型：${zh.customer(customerType)}`,
      `意向等级：${zh.intent(intent)}`,
      `采购阶段：${zh.purchase(purchaseStage)}`,
      `关注产品：${product}`,
      `数量信号：${quantity}`,
      `关注点：${concerns}`,
      `关键信号：${signals}`,
      '',
      '历史沟通回顾：',
      shortSummary,
      '',
      '关键时间节点：',
      `客户最后回复：${lastCustomerTime}`,
      `我方最后发送：${lastMyTime}`,
      '',
      '时间间隔：',
      gap,
      '',
      '当前判断：',
      `客户信号：${customerSignal}`,
      `当前状态：${state}`,
      '',
      `当前阻碍：${blocker}`,
      `策略方向：${strategy}`,
      `回复角度：${angle}`,
      `跟进焦点：${focus}`,
      '',
      '分析信心：',
      confidence,
      '',
      'AI分析摘要：',
      aiSummary,
      '',
      '推理摘要：',
      reasoning,
      '',
      'Enforce执行检查：',
      `Enforce状态：${enforceStatus}`,
      `目标回复：${targetReply}`,
      `多路径风险：${multiRisk}`,
      `思考负担风险：${thinkRisk}`,
      `高风险词拦截：${highRisk ? '是' : '否'}`,
      `泛化表达拦截：${genericRisk ? '是' : '否'}`,
      `弱锚点拦截：${weakAnchorRisk ? '是' : '否'}`,
      `重复角度拦截：${repeatQualityHits.length > 0 ? '是' : '否'}`,
      `完整中文翻译缺失：${missingChineseReference ? '是' : '否'}`,
      `人工上下文原因：${manualHoldReasons.length ? manualHoldReasons.join(', ') : '无'}`,
      '',
      '建议跟进话术（最终英文）：',
      finalMessage ? `✅ ${finalMessage}` : '⛔ 空消息，不发送',
      '',
      '建议跟进话术（中文对照）：',
      finalMessageCn ? `✅ ${finalMessageCn}` : '⛔ 未提供中文对照'
    ].join('\n'), 3500);

    const headerParts = [];
    if (manualHoldReasons.length > 0) {
      headerParts.push(`⛔ MANUAL_CONTEXT_REQUIRED ⛔\n原因: ${manualHoldReasons.join(', ')}\n不输出客户可发话术。请人工核对最新对话、身份和阶段后再决定。`);
    } else if (hardNoSend || hasNotNowSignal) {
      headerParts.push('⛔ HARD_NO_SEND ⛔\n客户曾发出"暂时不要联系"信号,默认不发,如确实要发请人工 review 客户最新消息后再决定。');
    }
    if (bannedHits.length > 0) {
      headerParts.push(`⚠️ BANNED_PHRASE_DETECTED ⚠️\nMatched: "${bannedHits.map(h => h.matched).join('" / "')}"\n请在 Telegram 审核时手动改写后再发送。`);
    } else if (missingChineseReference) {
      headerParts.push('⚠️ MISSING_COMPLETE_CN_TRANSLATION ⚠️\n缺少与本次英文对应的完整中文翻译；本条不生成可发布审核包，须成对话术补齐后重验。');
    } else if (usedFallback) {
      headerParts.push('🔄 FALLBACK 通用破冰模板\nAI 没有足够上下文，使用了通用模板。建议根据客户情况手动改写后再发送。');
    }
    const reviewHeader = headerParts.length > 0 ? headerParts.join('\n\n') + '\n\n' : '';

    const telegramMessages = !shouldBlock
      ? [
          `${reviewHeader}【${projectKey}】\n\nEnglish:\n${finalMessage}\n\n中文翻译:\n${finalMessageCn || '（未提供中文对照）'}`,
          current.project_key || '',
          finalMessage
        ]
      : [];

    out.push({
      ...current,
      ai_parsed: aiParsed,
      enforce_parsed: enforceParsed,
      enforce_parse_status: enforceParsed.parse_status,
      enforce_reason_unmapped: enforceParsed.reason_unmapped,
      project_key: projectKey,
      customer_name: customerName,
      order_group: has(current.order_group) ? String(current.order_group).trim() : '',
      analysis_text: analysisText,
      whatsapp_text: finalMessage,
      whatsapp_message: finalMessage,
      _en: finalMessage,
      whatsapp_message_cn: finalMessageCn,
      _cn: finalMessageCn,
      telegram_messages: telegramMessages,
      enforce_status: enforceStatus,
      auto_send_pass: !shouldBlock,
      banned_phrase_flagged: bannedHits.length > 0,
      banned_phrase_hits: bannedHits,
      // 2026-07-08: include manual hold reasons as structured entries so
      // blocked rows are operable (missing_summary / weak_identity /
      // missing_customer_context ...) instead of a bare empty_message.
      banned_phrase_details: JSON.stringify(qualityIssueHits),
      quality_issue_hits: qualityIssueHits,
      missing_chinese_reference: missingChineseReference,
      manual_hold_reasons: manualHoldReasons,
      used_alternate_activation: usedAlternateActivation,
      used_repeat_safe_rewrite: usedRepeatSafeRewrite,
      used_evidence_limited_recovery: usedEvidenceLimitedRecovery,
      used_fallback: usedFallback
    });
  }

  return out;
}

module.exports = async function (req, res) {
  if (req.method && req.method !== 'POST') {
    return res.status(405).json({
      error: true,
      message: 'Method not allowed'
    });
  }

  try {
    const inputItems = normalizeInputItems(req.body);
    const resultItems = filterAndFormatTelegramFinalItems(inputItems);
    return res.status(200).json(resultItems);
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err.message || 'filter-and-format-telegram-final failed'
    });
  }
};

// END_PINNED_HANDLER safe-v14-filter-and-format-telegram-final-20260923
  },
  "safe-v14-compile-enforce-prompt-20260923": function (module) {
// BEGIN_PINNED_HANDLER safe-v14-compile-enforce-prompt-20260923
const fs = require('fs');
const path = require('path');

function cleanCustomerName(raw) {
  if (!raw) return '';
  if (/^\+\d/.test(raw.trim())) return '';
  let name = raw
    .replace(/\d+台/g, '')
    .replace(/[\u4e00-\u9fff]+/g, ' ')
    .replace(/[（()）]+/g, ' ')
    .replace(/\d{1,4}[\.\-\/]\d{1,2}[\.\-\/]?\d{0,2}日?/g, '')
    .replace(/\b[A-Z]{2}\d{3}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = name.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return '';
  return words[0];
}

function safeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function safeBoolean(value) {
  if (value === true || value === 'true') return 'true';
  if (value === false || value === 'false') return 'false';
  return 'unknown';
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return 'null';
  }
}

// Frozen safe-v14-only system; shared/default prompt consumers remain unchanged.
// Effective UTF-8 SHA-256: 9bc2bbaf1e0df6f452e8b443d977deac980de9ce57b8deeae0ef34fd76ae3179
const SAFE_V14_ENFORCE_SYSTEM = "You are the Gatekeeper for a WhatsApp reactivation pipeline.\n\nYou validate the upstream Generator message.\nYou may PASS, REWRITE using a concrete grounded anchor, or return EMPTY.\n\nUpstream Generator outputs only:\n{ \"whatsapp_message\": \"...\" }\n\nVisible analysis may be absent by design. That is not an error.\nJudge using the candidate message, customer context, real conversation history, and payload.\n\n--------------------------------\nSTRICT OUTPUT\n--------------------------------\n\nOUTPUT CONTRACT FOR EVERY DECISION:\nReturn exactly one JSON object with exactly these two keys, each appearing once: \"whatsapp_message\" and \"whatsapp_message_cn\". Both values must be strings.\nPASS, REWRITE and EMPTY are internal decisions, not output labels. Do not print the decision, validation steps, reasons, analysis, headings, notes, Markdown, code fences, or any other text before or after the JSON object.\nIf any existing safety, identity, grounding, repetition, or upstream-HOLD rule requires EMPTY, return exactly {\"whatsapp_message\":\"\",\"whatsapp_message_cn\":\"\"}. This EMPTY rule takes precedence over all language and translation requirements.\nOtherwise, put only the final grounded English message in whatsapp_message and its complete Chinese translation in whatsapp_message_cn.\nUse valid JSON escaping for quotes, backslashes and control characters inside strings. Do not add keys or a second object.\n\n- whatsapp_message_cn: Translate the English message into natural Chinese. This is for internal review only, not sent to the customer.\n- whatsapp_message_cn translation rules: Keep product names in English (Reformer, Cadillac, Tower, Pilates, AR011, FR004, MG001, etc). Only translate the conversational parts into Chinese.\n- whatsapp_message_cn MUST be a FULL translation of the English message, NOT a generic template. Translate ALL specific details (prices, quantities, locations, names) into the Chinese version.\n- DO NOT use generic templates like \"我可以把相关选项整理成一条简单信息\". The Chinese version must convey the same specific information as the English version.\n- Example: EN: \"Marci, I can send you the shipping cost to Beaumont\" → CN: \"Marci，我可以把发货到 Beaumont 的运费发给你\" (✅ GOOD) NOT \"我可以把相关选项整理成一条简单信息\" (❌ BAD)\n\nDo not output analysis, notes, summaries, markdown, or extra keys.\n\nCRITICAL LANGUAGE RULE FOR NON-EMPTY, SENDABLE OUTPUT ONLY:\n- whatsapp_message must be English only, without Chinese characters.\n- whatsapp_message_cn must be a complete natural Chinese translation, with Chinese characters and all specific details preserved.\n- If the non-empty English message contains Chinese characters, rewrite it in English while preserving the grounded meaning.\n- If the English message is non-empty and the Chinese translation is empty or only a placeholder, provide the complete translation.\n- For every EMPTY decision, both fields remain exactly \"\". Never create a message or translation to fill an EMPTY result.\n\n--------------------------------\nDECISION MODEL\n--------------------------------\n\nChoose exactly one:\n\n1. PASS — candidate is already valid.\n2. REWRITE — candidate is weak but fixable. This is the default action.\n3. EMPTY — required for hard no-send, not-now, my-turn/manual reply, weak identity, missing context, missing concrete grounded anchor, or manual_context_required.\n\nWhen in doubt about safety or grounding → EMPTY. When history is sparse but still safe and there is a concrete anchor → REWRITE.\n\n--------------------------------\nSPECIAL CASE — Generator Returned Empty\n--------------------------------\n\nIf the candidate message is empty, is exactly \"[GENERATOR_RETURNED_EMPTY_NEEDS_FALLBACK]\", or the input marks upstream Generator output as blocked, invalid, or held:\n- Return { \"whatsapp_message\": \"\", \"whatsapp_message_cn\": \"\" }.\n- Do not compensate for an upstream HOLD or invent a replacement message.\n- Never pass the legacy placeholder through. An explicit empty result is not permission to bypass safety, identity, context, or grounding requirements.\n\n--------------------------------\nCORE VALIDATION\n--------------------------------\n\nInternally validate only these:\n1. correct current customer name\n2. strongest valid anchor from real history\n3. correct stop-point / blocker fit\n4. one-trigger reply logic\n5. NOT a repeat of the last \"me:\" message in conversation (see ANTI-REPETITION CHECK below)\n\nDo not require visible upstream analysis.\nDo not build long hidden reports.\n\n--------------------------------\nVALIDATION RULES\n--------------------------------\n\nName: must match customer_name_clean, project_key, or conversation. Rewrite if wrong or missing when available. Never preserve names copied from examples.\nIf the customer name is a phone number (starts with +) or empty, the message MUST start with \"Hi there,\" — never start with just \"I can\".\n\nCRITICAL NAME RULE:\n- ALWAYS use the customer_name_clean field provided in input (NEVER use project_key or raw customer_name)\n- If customer_name_clean is empty or starts with \"Hi there\", start the message with exactly \"Hi there,\"\n- NEVER include any of these in the customer name part of your message:\n  * Chinese characters (中文)\n  * Phone numbers (+1234567890)\n  * Dates (26.3.15日, 25.12.2日)\n  * Quantity (10台, 2台)\n  * Model codes (AR011, FR004)\n  * Brackets (parentheses)\n- If you see ANY of the above appearing in your draft message's name position, you MUST rewrite it.\n\nVALID examples:\n✅ \"Marea, I can...\"\n✅ \"Hi there, I can...\"\n\nINVALID examples (REWRITE if you produce these):\n❌ \"Marea澳大利亚（26.4.6日）, I can...\"\n❌ \"+18622675255, I can...\"\n❌ \"MCD菲律宾（25.12.2日）, I can...\"\n\nGrounding: if conversation history exists, the message must use one concrete anchor taken VERBATIM or near-verbatim from the current customer history. \n\nConcrete anchor test:\n- If customer said a specific model code (AR011, MR001, PR007, MG001, FR001, FR004, etc.), that EXACT code must appear in the message.\n- If customer said a specific price ($469, $360, etc.), that EXACT number must appear.\n- If customer said a specific quantity (10 units, 6 units, 20-30 units), that EXACT number must appear.\n- If customer said a specific timing (October, 10月开业, etc.), that EXACT timing must appear.\n- If customer mentioned a specific object (catalog, photos, warranty), use that EXACT word.\n\nRewrite if:\n- The message generalizes a specific customer word into a category (\"AR011\" → \"aluminum model\", \"$469\" → \"the price\")\n- The message could be sent to another customer by changing only the name + one generic noun\n- A stronger unresolved object exists in the history and the message uses something weaker\n\nStructure: message must be one short WhatsApp activation line with [Name/Hi there] + one specific grounded action + one concrete benefit. Do not force every rewrite into the same \"I can ... so you can ... want me to send that here?\" rhythm.\nRequired: one grounded action, one concrete benefit, one reply path, roughly 16-30 words, answerable in under 3 seconds, low-pressure.\n\nReject or rewrite if: wrong name, missing available name, vague anchor, generic reusable message, multiple questions or actions, weak stop-point or blocker fit, asks for readiness / preference / comparison / new information / business decision, uses \"or\", feels like customer service or generic follow-up.\n\nPRODUCT MODEL RULE:\n- ONLY use product model codes that the customer explicitly mentioned in the conversation\n- DO NOT invent product codes (e.g. AR004, AR012) that don't appear in the customer's messages\n- If you want to mention a model not in conversation, use generic terms instead (\"our standard reformer\", \"the wood model\")\n\nValid product codes (the only ones we sell): AR001, AR003, AR010, AR011, AR012, FR001, FR004, MR001-005, OR001, BR001, PR007, PC006, BS001, MG001-006\n- ANY other code is fabrication - never use it\n\nANCHOR SPECIFICITY RULE:\nThe anchor (the \"thing\" you're offering to send) must be specific, not generic.\n\n❌ BAD anchors (too vague, FORBIDDEN):\n- \"shipping delivery summary\"\n- \"catalog\" (alone, without specifying what's in it)\n- \"options\" (alone)\n- \"details\" (alone)\n- \"information\"\n- \"new model options\" (without specifying which models)\n\n✅ GOOD anchors (specific from conversation):\n- \"the $469 unit price\" (specific number from conversation)\n- \"AR011 photos and video\" (specific model from conversation)\n- \"the difference between aluminum and wood reformer\" (specific comparison from conversation)\n- \"DDP shipping cost to Vancouver\" (specific destination from conversation)\n- \"the 10-unit total cost breakdown\" (specific quantity from conversation)\n\nIf you cannot find a specific grounded anchor in the conversation or verified structured context, return EMPTY.\n\n--------------------------------\nHARD-BLOCK PATTERNS (must always trigger REWRITE)\n--------------------------------\n\nIf the candidate message contains ANY of these patterns (case-insensitive), you MUST rewrite. No exceptions. These are lazy fallbacks that do not address the customer.\n\nSimplify/summarize family (entire family is banned):\n- \"simplify my last\" / \"simplify our last\" / \"simplify the last\"\n- \"summarize my last\" / \"summarize our last\" / \"summarize the last\"\n- \"the key point from my last\" / \"the key point from our last\"\n- \"pick up where we left off\"\n- \"catch up on what we discussed\" / \"catch up on where we left off\"\n- \"my last point\" / \"our last point\" / \"our last interaction\" / \"our last chat\"\n\nVague \"updates / options\" family:\n- \"keep you updated with\" (without a specific model code or situation)\n- \"line up the new model options\" / \"the latest equipment options\" / \"our latest models\"\n- \"the latest studio-ready models\" (or any \"latest X\" without a specific reason tied to THIS customer)\n\nVague benefit family:\n- \"see what's available\"\n- \"make an informed choice\"  \n- \"explore options at your convenience\" / \"explore what's available\"\n- \"at your convenience\"\n- \"easily refer back to it later\"\n\nFake-grounding family (adding a generic category word to look specific):\n- \"the standard reformer\" (when customer never said \"standard\")\n- \"our aluminum model\" (when customer asked about specific code like AR011)\n- \"the premium option\" (when customer never discussed \"premium\")\n- Any category noun that the customer never mentioned\n\nWhen you detect any of the above, REWRITE using a TIER 1-4 action from the Generator system prompt's ACTION + BENEFIT GUIDANCE.\n\n--------------------------------\nANTI-REPETITION CHECK (must trigger REWRITE if failed)\n--------------------------------\n\nFind the last \"me:\" message in the conversation history.\nCompare the candidate message against it.\n\nREWRITE if ANY of these are true:\n1. Candidate offers the SAME anchor object (same model, same price, same document, same photos)\n2. Candidate uses the SAME action verb on the SAME topic (send photos → send photos)\n3. A customer reading both messages would learn NOTHING new from the candidate\n\nWhen rewriting for repetition, ADVANCE to the next logical step:\n- Last sent price → offer shipping / payment terms / timeline\n- Last sent photos → offer specs / comparison / sample\n- Last sent catalog → highlight picks for their use case\n- Last sent \"keep ready\" → offer a concrete new piece of info\n- No clear next step → shift to a different anchor from conversation\n- No different grounded anchor → return EMPTY; do not invent a fresh angle\n\nThis check is MANDATORY. Do not replace repetition with a generic fallback. If no different concrete grounded anchor is available, return EMPTY.\n\n--------------------------------\nREWRITE RULES\n--------------------------------\n\nWhen rewriting, follow the Generator shape, but vary the CTA naturally:\n- \"[Name], I can [specific grounded action] so you can [clear immediate concrete benefit]. Want me to send that here?\"\n- \"[Name], I can put [specific grounded object] into one clean message if helpful.\"\n- \"[Name], happy to send [specific grounded object] here so it is easier to check.\"\n- \"Hi there, I can send one short note on [specific grounded object] if that is still useful.\"\n\nAvoid canned fallback labels unless they include exact customer-specific objects:\n- \"short comparison checklist\"\n- \"short starting-point guide\"\n- \"main differences\"\n- \"something concrete to review\"\n\nKeep: current business intent, strongest available anchor, one action, one benefit, one reply path, low-pressure tone.\n\nSpecial states — return EMPTY:\n\nReturn { \"whatsapp_message\": \"\", \"whatsapp_message_cn\": \"\" } when any of these are true:\n- hard_no_send = true\n- has_not_now_signal = true\n- is_my_turn_to_reply = true\n- send_state = \"no_send\"\n- send_state = \"manual_context_required\"\n- manual_hold_reasons is non-empty\n- customer identity is weak and no concrete anchor exists\n- conversation/context is too sparse to ground a specific one-action message\n\nDo not rewrite these into \"keep notes ready\", \"care message\", \"light re-engagement\", or any other customer-facing fallback.\n\n--------------------------------\nFALLBACK\n--------------------------------\n\nUse only when the customer is safe to activate and at least one concrete anchor exists. If no concrete anchor exists, return EMPTY.\n\n--------------------------------\nEMPTY POLICY\n--------------------------------\n\nReturn EMPTY whenever safety, identity, or grounding is not sufficient.\n\nThe output { \"whatsapp_message\": \"\", \"whatsapp_message_cn\": \"\" } is REQUIRED for hard_no_send, not_now, my-turn/manual reply, manual_context_required, weak identity without anchor, or missing context.\n\nOnly produce a customer-facing message when the context is safe, specific, and grounded.\n\n--------------------------------\nOUTPUT DISCIPLINE\n--------------------------------\n\nBefore returning, internally confirm:\n- name is correct and included when available\n- anchor is concrete and grounded when history exists\n- message fits the stop point and blocker\n- message has one action and one reply path\n- message is not reusable when history exists\n- every rewrite uses a concrete grounded, non-repeated anchor; missing context or anchor requires EMPTY\n- empty used for hard_no_send, not_now, my-turn/manual reply, manual_context_required, weak identity without anchor, or missing context\n\nReturn only the single JSON object defined in OUTPUT CONTRACT FOR EVERY DECISION. Output no decision label or validation commentary. For EMPTY, output exactly {\"whatsapp_message\":\"\",\"whatsapp_message_cn\":\"\"}.";

function readSystemPrompt() {
  return SAFE_V14_ENFORCE_SYSTEM;
}

function normalizeBody(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  return body || {};
}

function normalizeItems(body) {
  const normalizedBody = normalizeBody(body);
  const rawItems = Array.isArray(normalizedBody)
    ? normalizedBody
    : Array.isArray(normalizedBody.items)
      ? normalizedBody.items
      : [normalizedBody];

  return rawItems.map(item => {
    if (item && typeof item === 'object' && !Array.isArray(item) && item.json) {
      return item;
    }

    return {
      json: item && typeof item === 'object' && !Array.isArray(item) ? item : {}
    };
  });
}

function getAllowedMicroTriggers(json) {
  const direct = json.allowed_micro_triggers;
  const payloadDecision = json.reactivation_ai_payload?.decision?.allowed_micro_triggers;
  const payloadStopPoint = json.reactivation_ai_payload?.stop_point?.allowed_micro_triggers;
  const forbiddenZone = json.forbidden_repeat_zone?.allowed_micro_triggers;

  if (Array.isArray(direct)) return direct;
  if (Array.isArray(payloadDecision)) return payloadDecision;
  if (Array.isArray(payloadStopPoint)) return payloadStopPoint;
  if (Array.isArray(forbiddenZone)) return forbiddenZone;
  return [];
}

function getAnchorObject(json) {
  return safeString(
    json.anchor_object ||
    json.reactivation_ai_payload?.decision?.anchor_object ||
    json.reactivation_ai_payload?.stop_point?.anchor_object ||
    json.reactivation_v6_core?.anchor_object ||
    json.primary_reply_anchor ||
    ''
  );
}

function buildFinalQualityUserPrompt(json) {
  const aiParsed = json.ai_parsed && typeof json.ai_parsed === 'object' ? json.ai_parsed : {};
  const candidateMessage = safeString(aiParsed.whatsapp_message || json._en || '');
  const allowedMicroTriggers = getAllowedMicroTriggers(json);
  const anchorObject = getAnchorObject(json);

  return [
    'Candidate message:',
    candidateMessage,
    '',
    'Project:',
    safeString(json.project_key),
    '',
    'Customer name:',
    safeString(
      [json.customer_name_clean, json.customer_name_for_ai, json.customer_name, json.project_key]
        .map(value => safeString(value).trim())
        .filter(value => value && !/^\+?[\d\s().-]+$/.test(value))
        .map(cleanCustomerName)
        .find(Boolean) || ''
    ),
    '',
    '--------------------------------',
    'SEND STATE',
    '--------------------------------',
    '',
    `- hard_no_send: ${safeBoolean(json.hard_no_send)}`,
    `- has_not_now_signal: ${safeBoolean(json.has_not_now_signal)}`,
    `- is_my_turn_to_reply: ${safeBoolean(json.is_my_turn_to_reply)}`,
    `- should_reactivate_now: ${safeBoolean(json.should_reactivate_now)}`,
    `- send_state: ${safeString(json.send_state)}`,
    `- status: ${safeString(json.status)}`,
    `- customer_last_message_type: ${safeString(json.customer_last_message_type)}`,
    `- reply_risk: ${safeString(json.reply_risk)}`,
    '',
    '--------------------------------',
    'PRIMARY EXECUTION FIELDS',
    '--------------------------------',
    '',
    'Parsed candidate:',
    safeString(aiParsed.whatsapp_message),
    '',
    'English candidate:',
    safeString(json._en),
    '',
    'Anchor object:',
    anchorObject,
    '',
    'Allowed micro-triggers:',
    safeJson(allowedMicroTriggers),
    '',
    'Needs enforce rewrite:',
    String(safeBoolean(json.needs_enforce_rewrite)),
    '',
    'Reactivation AI payload:',
    safeJson(json.reactivation_ai_payload || {}),
    '',
    '--------------------------------',
    'LAST STOP POINT',
    '--------------------------------',
    '',
    'Last customer message:',
    safeString(json.last_customer_message),
    '',
    'Last my message:',
    safeString(json.last_my_message),
    '',
    'Last exchange:',
    safeJson(json.last_exchange || {}),
    '',
    'Stop point analysis:',
    safeJson(json.stop_point_analysis || {}),
    '',
    'Forbidden repeat zone:',
    safeJson(json.forbidden_repeat_zone || {}),
    '',
    '--------------------------------',
    'KEY CONTEXT',
    '--------------------------------',
    '',
    'Primary reply anchor:',
    safeString(json.primary_reply_anchor),
    '',
    'Secondary context:',
    safeString(json.secondary_context),
    '',
    'Current blocker:',
    safeString(json.current_blocker),
    '',
    'Reply angle:',
    safeString(json.reply_angle),
    '',
    'Follow-up focus:',
    safeString(json.follow_up_focus),
    '',
    '--------------------------------',
    'REAL CONVERSATION',
    '--------------------------------',
    '',
    'Conversation core:',
    safeString(json.conversation_core),
    '',
    'Conversation:',
    safeString(json.conversation),
    '',
    '--------------------------------',
    'TASK',
    '--------------------------------',
    '',
    "1) If hard_no_send = true, return exactly {\"whatsapp_message\":\"\",\"whatsapp_message_cn\":\"\"}. Apply every other EMPTY condition from the system before considering PASS or REWRITE.",
    '2) Validate the candidate message against the real conversation, customer context, and payload.',
    '3) If invalid but sendable → REWRITE using the strongest anchor from real history.',
    '4) The final message must be grounded in the real conversation and must not be generic.',
    "5) Only for a non-empty, sendable English result, provide whatsapp_message_cn as its FULL Chinese translation. For an EMPTY decision, both fields must be exactly \"\"; do not add a translation or replacement message.",
    '   Translate all specific details from the English message, including names, locations, prices, quantities, model codes, and delivery/setup details.',
    '   Keep product/model names in English, but translate the conversational sentence completely.',
    '   Do not summarize, loosely paraphrase, or use a generic Chinese template.',
    '',
    '--------------------------------',
    'OUTPUT',
    '--------------------------------',
    '',
    "Return exactly one JSON object with only \"whatsapp_message\" and \"whatsapp_message_cn\", each once and each a string. Perform validation internally; output no labels, commentary, code fences, prefix or suffix. Follow the system output contract. For EMPTY, return exactly {\"whatsapp_message\":\"\",\"whatsapp_message_cn\":\"\"}; otherwise return only the final English message and its complete Chinese translation in those fields."
  ].join('\n');
}

module.exports = async function (req, res) {
  if (req.method && req.method !== 'POST') {
    return res.status(405).json({
      error: true,
      message: 'Method not allowed'
    });
  }

  try {
    const finalQualitySystemPrompt = readSystemPrompt();
    const items = normalizeItems(req.body).map(item => {
      const json = item.json || {};

      return {
        json: {
          ...json,
          final_quality_system_prompt: finalQualitySystemPrompt,
          final_quality_user_prompt: buildFinalQualityUserPrompt(json)
        }
      };
    });

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err.message || 'compile-enforce-prompt failed'
    });
  }
};

// END_PINNED_HANDLER safe-v14-compile-enforce-prompt-20260923
  },
};
