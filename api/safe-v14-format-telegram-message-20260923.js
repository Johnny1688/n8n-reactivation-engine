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
      else if (!parsed.whatsapp_message.trim() || parsed.whatsapp_message.trim().toLowerCase() === 'unknown') add('GENERATOR_EXPLICIT_EMPTY');
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

      const projectKey = firstNonEmptyString(
        data.project_key,
        aiParsed.project_key
      );

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
